# 報平安官方帳號 背景圖片 1080x878（先畫 2 倍再縮小，邊緣較平滑）
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import math, sys
S = 2; W, H = 1080*S, 878*S
F = '/usr/share/fonts/opentype/noto/'
title = ImageFont.truetype(F+'NotoSansCJK-Black.ttc', 150*S, index=2)
sub   = ImageFont.truetype(F+'NotoSansCJK-Bold.ttc', 40*S, index=2)

im = Image.new('RGB', (W, H))
px = ImageDraw.Draw(im)
top, bot = (255, 226, 186), (255, 248, 236)                       # 清晨天空
for y in range(H):
    t = y / H
    px.line([0, y, W, y], fill=tuple(int(top[i]*(1-t)+bot[i]*t) for i in range(3)))

# 太陽與光暈
glow = Image.new('RGBA', (W, H), (255, 200, 110, 0)); g = ImageDraw.Draw(glow)
sx, sy = W//2, 640*S
for r, a in [(330, 40), (260, 60), (200, 90)]:
    g.ellipse([sx-r*S, sy-r*S, sx+r*S, sy+r*S], fill=(255, 200, 110, a))
glow = glow.filter(ImageFilter.GaussianBlur(30*S)); im.paste(glow, (0, 0), glow)
d = ImageDraw.Draw(im)
d.ellipse([sx-150*S, sy-150*S, sx+150*S, sy+150*S], fill=(255, 176, 74))
d.ellipse([sx-120*S, sy-130*S, sx+60*S, sy+20*S], fill=(255, 196, 108))

# 兩層山丘
def hill(base, amp, freq, phase, color):
    pts = [(0, H)]
    for x in range(0, W+1, 8):
        pts.append((x, base + amp*math.sin(x/W*math.pi*freq + phase)))
    pts.append((W, H)); d.polygon(pts, fill=color)
hill(690*S, 38*S, 2.0, 0.6, (168, 212, 160))
hill(760*S, 30*S, 1.6, 2.2, (98, 166, 112))

# 小房子（亮著燈＝家裡平安）
hx, hy = 860*S, 676*S
d.rectangle([hx-62*S, hy-40*S, hx+62*S, hy+52*S], fill=(255, 250, 240))
d.polygon([(hx-80*S, hy-36*S), (hx, hy-100*S), (hx+80*S, hy-36*S)], fill=(196, 72, 56))
d.rectangle([hx-40*S, hy-12*S, hx-8*S, hy+18*S], fill=(255, 196, 80))
d.rectangle([hx+14*S, hy+2*S, hx+42*S, hy+52*S], fill=(150, 98, 70))
d.rectangle([hx+38*S, hy-88*S, hx+56*S, hy-58*S], fill=(150, 98, 70))

# 小樹
for tx, ty, s in [(170*S, 740*S, 1.0), (240*S, 752*S, .75)]:
    d.rectangle([tx-7*S*s, ty, tx+7*S*s, ty+40*S*s], fill=(120, 86, 60))
    d.ellipse([tx-44*S*s, ty-78*S*s, tx+44*S*s, ty+10*S*s], fill=(70, 140, 92))

# 兩隻小鳥
def bird(x, y, s):
    k = S*s
    d.line([(x-28*k, y-12*k), (x-14*k, y-2*k), (x, y+4*k), (x+14*k, y-2*k), (x+28*k, y-12*k)], fill=(90, 80, 70), width=int(5*k), joint='curve')
bird(250*S, 430*S, 1.0); bird(320*S, 470*S, .75)

# 標題與副標（放在上半部，避免被頭像擋住）
ink = (47, 93, 67)
d.text((W//2, 205*S), '報平安', font=title, fill=ink, anchor='mm')
d.text((W//2, 345*S), '每天一句「我很好」　可疑訊息傳給我查', font=sub, fill=(91, 102, 95), anchor='mm')

im = im.resize((1080, 878), Image.LANCZOS)
im.save(sys.argv[1] if len(sys.argv) > 1 else 'cover.png', optimize=True)
