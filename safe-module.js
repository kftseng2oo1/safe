// =====================================================================
// 報平安 safe-checkin — arcar Worker 模組
// 需要：KV binding  SAFE_KV
//       Secret      沿用 arcar 既有的 LINE_CHANNEL_TOKEN
// 接法：
//   fetch：   if (url.pathname.startsWith('/safe')) return handleSafe(request, env);
//   webhook： for (const ev of body.events) { if (await safeLineEvent(ev, env)) continue; ...原本的處理 }
//   scheduled：ctx.waitUntil(safeCron(env));   // arcar 每分鐘跑，內部自己每 5 分鐘檢查一次
// =====================================================================

const SAFE_TZ_MS = 8 * 3600 * 1000;          // Asia/Taipei，無日光節約
const SAFE_MAX_MEMBERS = 10;
const SAFE_SECOND_ALERT_MIN = 120;            // 過期限多久發第二次提醒

function safeNow() {
  const d = new Date(Date.now() + SAFE_TZ_MS);
  const iso = d.toISOString();
  return { date: iso.slice(0, 10), hm: iso.slice(11, 16), mins: d.getUTCHours() * 60 + d.getUTCMinutes() };
}
function safeYesterday(date) {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
function safeMins(hm) {
  const m = /^(\d{2}):(\d{2})$/.exec(hm || '');
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : 600;
}
function safeJson(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    },
  });
}
function safeLineToken(env) { return env.LINE_CHANNEL_TOKEN || env.LINE_CHANNEL_ACCESS_TOKEN || env.LINE_TOKEN; }

async function safePush(env, userIds, text) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (!ids.length) return;
  const one = ids.length === 1;
  await fetch('https://api.line.me/v2/bot/message/' + (one ? 'push' : 'multicast'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + safeLineToken(env) },
    body: JSON.stringify({ to: one ? ids[0] : ids, messages: [{ type: 'text', text }] }),
  });
}
async function safeReply(env, replyToken, text) {
  await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + safeLineToken(env) },
    body: JSON.stringify({ replyToken, messages: [{ type: 'text', text }] }),
  });
}
async function safeProfileName(env, userId) {
  try {
    const r = await fetch('https://api.line.me/v2/bot/profile/' + userId, {
      headers: { Authorization: 'Bearer ' + safeLineToken(env) },
    });
    if (r.ok) return (await r.json()).displayName || '家人';
  } catch (e) {}
  return '家人';
}

async function safeGet(env, code) {
  const s = await env.SAFE_KV.get('circle:' + code);
  return s ? JSON.parse(s) : null;
}
async function safePut(env, c) { await env.SAFE_KV.put('circle:' + c.code, JSON.stringify(c)); }
async function safeIndex(env) { return JSON.parse((await env.SAFE_KV.get('safe:index')) || '[]'); }

function safeRandomCode() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return String(100000 + (a[0] % 900000));
}
function safeRandomToken() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return [...a].map(b => b.toString(16).padStart(2, '0')).join('');
}
function safeView(c) {
  const n = safeNow();
  return {
    ok: true,
    name: c.name,
    deadline: c.deadline,
    members: c.members.map(m => m.name),
    lastDate: c.lastDate,
    lastTime: c.lastTime,
    streak: c.lastDate === n.date || c.lastDate === safeYesterday(n.date) ? c.streak : 0,
    today: n.date,
    checkedToday: c.lastDate === n.date,
  };
}
function safeCleanName(s) { return String(s || '').trim().slice(0, 10) || '家人'; }
function safeCleanDeadline(s) {
  const m = safeMins(s);
  return /^\d{2}:\d{2}$/.test(s || '') && m >= 360 && m <= 1200 ? s : '10:00';   // 06:00–20:00
}

// ---------------- HTTP ----------------
export async function handleSafe(request, env) {
  if (request.method === 'OPTIONS') return safeJson({ ok: true });
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/safe/, '') || '/';
  let body = {};
  if (request.method === 'POST') { try { body = await request.json(); } catch (e) {} }

  if (path === '/create') {
    let code = '';
    for (let i = 0; i < 8; i++) {
      const t = safeRandomCode();
      if (!(await env.SAFE_KV.get('circle:' + t))) { code = t; break; }
    }
    if (!code) return safeJson({ ok: false, error: 'busy' }, 503);
    const c = {
      code, token: safeRandomToken(), name: safeCleanName(body.name), deadline: safeCleanDeadline(body.deadline),
      members: [], lastDate: null, lastTime: null, streak: 0, alerted: null, alerted2: null, helpAt: 0, createdAt: Date.now(),
    };
    await safePut(env, c);
    const idx = await safeIndex(env);
    idx.push(code);
    await env.SAFE_KV.put('safe:index', JSON.stringify(idx));
    return safeJson({ ok: true, code, token: c.token, ...safeView(c) });
  }

  const c = await safeGet(env, String(body.code || ''));
  if (!c || c.token !== body.token) return safeJson({ ok: false, error: 'auth' }, 403);
  const ids = c.members.map(m => m.userId);

  if (path === '/status') return safeJson(safeView(c));

  if (path === '/update') {
    if (body.name !== undefined) c.name = safeCleanName(body.name);
    if (body.deadline !== undefined) c.deadline = safeCleanDeadline(body.deadline);
    await safePut(env, c);
    return safeJson(safeView(c));
  }

  if (path === '/checkin') {
    const n = safeNow();
    if (c.lastDate === n.date) return safeJson({ ...safeView(c), already: true });   // 長輩重複按，不重複吵家人
    c.streak = c.lastDate === safeYesterday(n.date) ? (c.streak || 0) + 1 : 1;
    const late = c.alerted === n.date;
    c.lastDate = n.date;
    c.lastTime = n.hm;
    await safePut(env, c);
    const text = late
      ? `✅ ${c.name} 剛剛 ${n.hm} 報平安了，可以放心了。`
      : `🌤️ ${c.name} 今天 ${n.hm} 報平安：我很好！` + (c.streak > 1 ? `\n已連續 ${c.streak} 天 🌱` : '');
    await safePush(env, ids, text);
    return safeJson(safeView(c));
  }

  if (path === '/help') {
    if (Date.now() - (c.helpAt || 0) < 3 * 60 * 1000) return safeJson({ ...safeView(c), throttled: true });
    c.helpAt = Date.now();
    await safePut(env, c);
    await safePush(env, ids, `🆘 ${c.name} 按了「我需要幫忙」（${safeNow().hm}）\n請盡快打電話給${c.name}！`);
    return safeJson(safeView(c));
  }

  return safeJson({ ok: false, error: 'not_found' }, 404);
}

// ---------------- LINE webhook ----------------
// 家人傳：「平安 123456」加入、「取消平安 123456」退出、「平安狀態」查詢
export async function safeLineEvent(event, env) {
  if (!event || event.type !== 'message' || !event.message || event.message.type !== 'text') return false;
  const text = event.message.text.trim().replace(/\s+/g, ' ');
  const uid = event.source && event.source.userId;
  if (!uid) return false;

  let m = /^平安 ?(\d{6})$/.exec(text);
  if (m) {
    const c = await safeGet(env, m[1]);
    if (!c) { await safeReply(env, event.replyToken, '找不到這個代碼，請再確認一次 6 位數字 🙏'); return true; }
    if (c.members.some(x => x.userId === uid)) {
      await safeReply(env, event.replyToken, `你已經在「${c.name}」的報平安通知裡了 😊`);
      return true;
    }
    if (c.members.length >= SAFE_MAX_MEMBERS) { await safeReply(env, event.replyToken, '這個群組人數已滿（10 人）。'); return true; }
    const name = await safeProfileName(env, uid);
    const others = c.members.map(x => x.userId);
    c.members.push({ userId: uid, name });
    await safePut(env, c);
    await safeReply(env, event.replyToken,
      `已加入「${c.name}」的報平安通知 ✅\n每天${c.name}報平安時你會收到訊息；若到 ${c.deadline} 還沒報，也會提醒你。\n\n查詢：傳「平安狀態」\n退出：傳「取消平安 ${c.code}」`);
    await safePush(env, others, `👋 ${name} 也加入了「${c.name}」的報平安通知。`);
    return true;
  }

  m = /^取消平安 ?(\d{6})$/.exec(text);
  if (m) {
    const c = await safeGet(env, m[1]);
    if (c && c.members.some(x => x.userId === uid)) {
      c.members = c.members.filter(x => x.userId !== uid);
      await safePut(env, c);
      await safeReply(env, event.replyToken, `已退出「${c.name}」的報平安通知。`);
    } else {
      await safeReply(env, event.replyToken, '你不在這個報平安群組裡。');
    }
    return true;
  }

  if (text === '平安狀態') {
    const n = safeNow();
    const lines = [];
    for (const code of await safeIndex(env)) {
      const c = await safeGet(env, code);
      if (!c || !c.members.some(x => x.userId === uid)) continue;
      lines.push(c.lastDate === n.date
        ? `✅ ${c.name}：今天 ${c.lastTime} 已報平安`
        : `⏳ ${c.name}：今天還沒報（期限 ${c.deadline}）`);
    }
    await safeReply(env, event.replyToken, lines.length ? lines.join('\n') : '你還沒有加入任何報平安群組。\n請傳「平安 + 6 位數代碼」加入。');
    return true;
  }
  return false;
}

// ---------------- Cron ----------------
export async function safeCron(env) {
  const n = safeNow();
  if (n.mins % 5 !== 0) return;   // arcar 每分鐘觸發，這裡每 5 分鐘查一次，省 KV 讀取
  for (const code of await safeIndex(env)) {
    const c = await safeGet(env, code);
    if (!c || !c.members.length || c.lastDate === n.date) continue;
    const dl = safeMins(c.deadline);
    const ids = c.members.map(x => x.userId);
    if (n.mins >= dl && c.alerted !== n.date) {
      c.alerted = n.date;
      await safePut(env, c);
      await safePush(env, ids, `⚠️ 今天到 ${c.deadline} 還沒收到${c.name}的平安回報。\n可能只是忘了按，方便的話打個電話關心一下 📞`);
    } else if (n.mins >= dl + SAFE_SECOND_ALERT_MIN && c.alerted === n.date && c.alerted2 !== n.date) {
      c.alerted2 = n.date;
      await safePut(env, c);
      await safePush(env, ids, `❗ ${c.name}到現在（${n.hm}）都還沒報平安，也可能聯絡不上。\n請務必打電話確認，或請鄰近的親友去看看。`);
    }
  }
}
