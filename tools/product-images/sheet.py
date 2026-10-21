import json, sys, os
from PIL import Image, ImageDraw, ImageFont
d = json.load(open("cands.json"))
slugs = sys.argv[2:]; out = sys.argv[1]
T = 150; LW = 200
try: font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 15); sfont = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 12)
except Exception: font = sfont = ImageFont.load_default()
W = LW + 12 * (T + 4); H = len(slugs) * (T + 6)
im = Image.new("RGB", (W, H), "white"); dr = ImageDraw.Draw(im)
for r, s in enumerate(slugs):
    y = r * (T + 6)
    words, line, lines = s.split("-"), "", []
    for w in words:
        if len(line + w) > 22: lines.append(line); line = ""
        line += w + " "
    lines.append(line)
    for k, l in enumerate(lines[:7]): dr.text((4, y + 4 + k * 16), l, fill="black", font=sfont)
    for i in range(len(d.get(s, []))):
        p = f"thumbs/{s}/{i}.jpg"
        if not os.path.exists(p): continue
        t = Image.open(p).convert("RGB"); t.thumbnail((T, T))
        x = LW + i * (T + 4)
        im.paste(t, (x + (T - t.width) // 2, y + (T - t.height) // 2))
        dr.rectangle([x, y, x + 22, y + 18], fill="yellow"); dr.text((x + 3, y + 1), str(i), fill="black", font=font)
im.save(out, quality=80)
