#!/usr/bin/env python3
"""Genera le icone PWA (richiede Pillow e un TTF di Orbitron nella cartella tools/ oppure ORBITRON_TTF)."""
import os, sys, math
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'icons')
FONT = os.environ.get('ORBITRON_TTF') or os.path.join(HERE, 'Orbitron-Black.ttf')
os.makedirs(OUT, exist_ok=True)

def lerp(a, b, t): return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

def draw_icon(size=1024, maskable=False):
    S = size
    img = Image.new('RGB', (S, S), (11, 10, 16))
    px = img.load()
    # cielo al tramonto
    top, mid, hor = (24, 12, 42), (150, 40, 80), (255, 140, 40)
    hz = int(S * 0.58)
    for y in range(S):
        if y < hz:
            t = y / hz
            c = lerp(top, mid, t * 0.9) if t < 0.7 else lerp(lerp(top, mid, 0.63), hor, (t - 0.7) / 0.3)
        else:
            c = (14, 12, 20)
        for x in range(S): px[x, y] = c
    d = ImageDraw.Draw(img, 'RGBA')
    # sole
    cx, cy, r = S // 2, hz, int(S * 0.2)
    glow = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([cx - r * 2, cy - r * 2, cx + r * 2, cy + r * 2], fill=(255, 140, 40, 120))
    glow = glow.filter(ImageFilter.GaussianBlur(S * 0.05))
    img.paste(glow, (0, 0), glow)
    d = ImageDraw.Draw(img, 'RGBA')
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 214, 120, 255))
    # skyline
    import random
    rnd = random.Random(5)
    x = 0
    while x < S:
        w = rnd.randint(int(S * 0.04), int(S * 0.09)); h = rnd.randint(int(S * 0.05), int(S * 0.2))
        d.rectangle([x, hz - h, x + w, hz], fill=(20, 14, 28, 255))
        for wy in range(hz - h + 8, hz - 6, int(S * 0.025)):
            for wx in range(x + 6, x + w - 6, int(S * 0.02)):
                if rnd.random() < 0.35: d.rectangle([wx, wy, wx + int(S * 0.008), wy + int(S * 0.012)], fill=(255, 200, 110, 230))
        x += w + rnd.randint(0, 6)
    # strada in prospettiva
    vx, vy = S // 2, hz
    d.polygon([(vx - S * 0.02, vy), (vx + S * 0.02, vy), (S * 1.05, S), (-S * 0.05, S)], fill=(34, 32, 40, 255))
    d.polygon([(vx - S * 0.02, vy), (vx - S * 0.012, vy), (S * 0.06, S), (-S * 0.05, S)], fill=(240, 240, 235, 255))
    d.polygon([(vx + S * 0.012, vy), (vx + S * 0.02, vy), (S * 1.05, S), (S * 0.94, S)], fill=(240, 240, 235, 255))
    for i in range(7):
        t0 = (i / 7) ** 1.7; t1 = ((i + 0.55) / 7) ** 1.7
        y0 = vy + (S - vy) * t0; y1 = vy + (S - vy) * t1
        w0 = 0.004 + 0.02 * t0; w1 = 0.004 + 0.02 * t1
        d.polygon([(vx - S * w0, y0), (vx + S * w0, y0), (vx + S * w1, y1), (vx - S * w1, y1)], fill=(255, 190, 40, 255))
    # testo
    scale = 0.8 if maskable else 1.0
    f1 = ImageFont.truetype(FONT, int(S * 0.19 * scale))
    f2 = ImageFont.truetype(FONT, int(S * 0.145 * scale))
    def skew_text(txt, font, y, fill, glow_col):
        w = int(S * 1.1); h = int(font.size * 1.6)
        layer = Image.new('RGBA', (w, h), (0, 0, 0, 0))
        ld = ImageDraw.Draw(layer)
        bb = ld.textbbox((0, 0), txt, font=font)
        tx = (w - (bb[2] - bb[0])) // 2 - bb[0]
        ld.text((tx + 6, 10 + 6), txt, font=font, fill=(0, 0, 0, 200))
        ld.text((tx, 10), txt, font=font, fill=fill)
        layer = layer.transform(layer.size, Image.AFFINE, (1, 0.22, -0.22 * h * 0.5, 0, 1, 0), resample=Image.BICUBIC)
        gl = layer.filter(ImageFilter.GaussianBlur(S * 0.012))
        gl = Image.composite(Image.new('RGBA', layer.size, glow_col), Image.new('RGBA', layer.size, (0, 0, 0, 0)), gl.split()[3])
        base = Image.new('RGBA', (S, S), (0, 0, 0, 0))
        off = ((S - w) // 2, int(y))
        base.paste(gl, off, gl); base.paste(layer, off, layer)
        return base
    ty = S * (0.15 if not maskable else 0.2)
    t1 = skew_text('REDLINE', f1, ty, (255, 255, 255, 255), (255, 120, 20, 255))
    t2 = skew_text('RIVALS', f2, ty + S * 0.2 * scale, (255, 170, 60, 255), (255, 60, 20, 255))
    img = Image.alpha_composite(img.convert('RGBA'), t1)
    img = Image.alpha_composite(img, t2)
    return img.convert('RGB')

def main():
    big = draw_icon(1024)
    for name, size in (('icon-512.png', 512), ('icon-192.png', 192), ('apple-touch-icon.png', 180), ('icon-32.png', 32)):
        big.resize((size, size), Image.LANCZOS).save(os.path.join(OUT, name), optimize=True)
    mk = draw_icon(1024, maskable=True)
    mk.resize((512, 512), Image.LANCZOS).save(os.path.join(OUT, 'icon-maskable-512.png'), optimize=True)
    print('icone generate in', os.path.abspath(OUT))

if __name__ == '__main__':
    main()
