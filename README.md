# 報平安

長輩每天按一下「我很好」，家人的 LINE 就會收到通知；超過設定時間還沒按，自動提醒家人打電話關心。

銀髮族系列：成語算術・放大鏡・早安卡片・齊聲祝福・報平安

## 檔案
- `index.html` — 單檔 PWA（ES5，iOS WebView 相容）
- `sw.js`、`manifest.json`、`icon-192.png`、`icon-512.png`
- `safe-module.js` — 併入 arcar Worker 的後端模組（`/safe` 路由、LINE webhook、Cron）

## arcar 接法
1. 建立 KV namespace，綁定為 `SAFE_KV`
2. fetch：`if (url.pathname.startsWith('/safe')) return handleSafe(request, env);`
3. LINE webhook：`if (await safeLineEvent(ev, env)) continue;`
4. scheduled：`ctx.waitUntil(safeCron(env));`
5. LINE token 讀 `LINE_CHANNEL_ACCESS_TOKEN` 或 `LINE_TOKEN`

## 家人 LINE 指令
- `平安 123456` 加入
- `取消平安 123456` 退出
- `平安狀態` 查詢今天狀況
