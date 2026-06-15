#!/usr/bin/env python3
"""Generate Elector brand assets (logo, OG image, PWA + app icons).

Pure-PIL so it runs anywhere. Brand palette mirrors src/App.css:
  brand #f59022 / deep #d9740f / yellow #ffc23d / bg #eef1f5 / text #1a1e27
Run:  python3 scripts/gen-brand-assets.py
"""
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BRAND_DIR = os.path.join(ROOT, "public", "assets", "brand")
PUBLIC = os.path.join(ROOT, "public")
os.makedirs(BRAND_DIR, exist_ok=True)

BRAND = (245, 144, 34)
DEEP = (217, 116, 15)
YELLOW = (255, 194, 61)
BG = (238, 241, 245)
WARM = (255, 248, 239)
TEXT = (26, 30, 39)
MUTED = (92, 102, 117)
WHITE = (255, 255, 255)

FB = "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"
FR = "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"

def font(path, size):
    return ImageFont.truetype(path, size)

def text_size(draw, s, f, tracking=0):
    if not tracking:
        b = draw.textbbox((0, 0), s, font=f)
        return b[2] - b[0], b[3] - b[1], b[1]
    w = 0
    for ch in s:
        b = draw.textbbox((0, 0), ch, font=f)
        w += (b[2] - b[0]) + tracking
    b = draw.textbbox((0, 0), s, font=f)
    return w - tracking, b[3] - b[1], b[1]

def draw_tracked(draw, x, y, s, f, fill, tracking=0, colors=None):
    """Draw string char-by-char with letter tracking. colors: dict idx->fill."""
    cx = x
    for i, ch in enumerate(s):
        c = colors.get(i, fill) if colors else fill
        draw.text((cx, y), ch, font=f, fill=c)
        b = draw.textbbox((0, 0), ch, font=f)
        cx += (b[2] - b[0]) + tracking
    return cx

def wordmark(size_px, accent=YELLOW, base=BRAND, pad=0.18):
    """Transparent 'Elector' wordmark image scaled to height ~ size_px."""
    f = font(FB, size_px)
    tmp = Image.new("RGBA", (10, 10))
    d = ImageDraw.Draw(tmp)
    word = "Elector"
    tracking = max(1, size_px // 40)
    w, h, top = text_size(d, word, f, tracking)
    padx = int(size_px * pad)
    pady = int(size_px * pad)
    img = Image.new("RGBA", (w + 2 * padx, size_px + 2 * pady), (0, 0, 0, 0))
    dr = ImageDraw.Draw(img)
    # accent the 'o' (index 5 in 'Elector')
    colors = {5: accent}
    draw_tracked(dr, padx, pady - top + (size_px - h) // 2, word, f, base, tracking, colors)
    return img

# ---------- 1. Logo (transparent) ----------
logo = wordmark(160)
logo.save(os.path.join(BRAND_DIR, "elector_logo.png"))
print("wrote elector_logo.png", logo.size)

# ---------- 2. OG image 1200x630 ----------
W, H = 1200, 630
og = Image.new("RGB", (W, H), BG)
# vertical warm gradient
top_c, bot_c = WARM, BG
for y in range(H):
    t = y / H
    r = int(top_c[0] + (bot_c[0] - top_c[0]) * t)
    g = int(top_c[1] + (bot_c[1] - top_c[1]) * t)
    b = int(top_c[2] + (bot_c[2] - top_c[2]) * t)
    ImageDraw.Draw(og).line([(0, y), (W, y)], fill=(r, g, b))
od = ImageDraw.Draw(og)
# faint big "270" watermark, lower-right
f270 = font(FB, 360)
s270 = "270"
b = od.textbbox((0, 0), s270, font=f270)
wm = Image.new("RGBA", (W, H), (0, 0, 0, 0))
ImageDraw.Draw(wm).text((W - (b[2]-b[0]) - 40, H - (b[3]-b[1]) - 140), s270,
                        font=f270, fill=(245, 144, 34, 28))
og = Image.alpha_composite(og.convert("RGBA"), wm).convert("RGB")
od = ImageDraw.Draw(og)
# accent pill bar above wordmark
od.rounded_rectangle([80, 150, 152, 162], radius=6, fill=BRAND)
# wordmark
wlogo = wordmark(150)
# scale wordmark to a known height
og.paste(wlogo, (62, 196), wlogo)
# tagline
ft = font(FB, 46)
od.text((80, 372), "Win the Electoral College", font=ft, fill=TEXT)
fsub = font(FR, 30)
od.text((80, 438), "Campaign, build coalitions, and race to 270.", font=fsub, fill=MUTED)
fsub2 = font(FB, 24)
od.text((80, 492), "Solo  ·  vs Bots  ·  Online Multiplayer", font=fsub2, fill=DEEP)
og.save(os.path.join(BRAND_DIR, "og-image.png"))
print("wrote og-image.png", og.size)

# ---------- 3. App / PWA icons ----------
def icon(size, full_bleed=True, safe=0.62):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # diagonal orange gradient background
    grad = Image.new("RGB", (size, size))
    gd = ImageDraw.Draw(grad)
    c0, c1 = YELLOW, DEEP
    for y in range(size):
        t = y / size
        r = int(c0[0] + (c1[0] - c0[0]) * t)
        g = int(c0[1] + (c1[1] - c0[1]) * t)
        b = int(c0[2] + (c1[2] - c0[2]) * t)
        gd.line([(0, y), (size, y)], fill=(r, g, b))
    if full_bleed:
        img.paste(grad, (0, 0))
    else:
        m = Image.new("L", (size, size), 0)
        rad = int(size * 0.22)
        ImageDraw.Draw(m).rounded_rectangle([0, 0, size, size], radius=rad, fill=255)
        img.paste(grad, (0, 0), m)
    d = ImageDraw.Draw(img)
    # white "E" mark, centered, within safe zone
    fe = font(FB, int(size * safe))
    s = "E"
    b = d.textbbox((0, 0), s, font=fe)
    w_, h_ = b[2] - b[0], b[3] - b[1]
    d.text(((size - w_) / 2 - b[0], (size - h_) / 2 - b[1]), s, font=fe, fill=WHITE)
    return img

# master 1024 (no transparency for iOS) -> flatten on brand
master = icon(1024, full_bleed=True)
master_rgb = Image.new("RGB", (1024, 1024), DEEP)
master_rgb.paste(master, (0, 0), master)
master_rgb.save(os.path.join(BRAND_DIR, "icon-1024.png"))
print("wrote icon-1024.png (iOS master, opaque)")

for sz in (512, 192, 180, 32, 16):
    ic = icon(sz, full_bleed=True)
    ic.save(os.path.join(PUBLIC, f"icon-{sz}.png"))
print("wrote icon-512/192/180/32/16.png")

# maskable 512 with extra padding (safe zone)
mask = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
bg512 = icon(512, full_bleed=True)
mask.paste(bg512, (0, 0))
mask.save(os.path.join(PUBLIC, "icon-maskable-512.png"))
print("wrote icon-maskable-512.png")
print("DONE")
