# Builds the Android 12+ system splash assets from the iOS splash artwork (same icon, glow, wordmark and tagline).
# Usage: python3 tools/brand/android-splash.py mobile/ios/App/App/Assets.xcassets/Splash.imageset/Default@1x~universal~anyany-dark.png mobile/android/app/src/main/res /tmp/preview.png
import sys, numpy as np
from PIL import Image, ImageFilter
SRC, RES, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
im = Image.open(SRC).convert('RGB')
a = np.asarray(im).astype(np.float32)
BG = np.array([0x0f, 0x0e, 0x22], np.float32)            # splash_background: the artwork's tone around the icon/text

# 1. Icon: Android shows a 288dp canvas, masked to a 192dp circle (radius = canvas/3). Crop around the icon tile with
#    enough room that the tile (and its glow) fit the circle; fade the glow out before the mask edge.
cx, cy, C = 1366, 1129, 1290
crop = a[cy - C // 2: cy + C // 2, cx - C // 2: cx + C // 2]
yy, xx = np.mgrid[0:C, 0:C] - (C - 1) / 2
r = np.hypot(xx, yy) / (C / 3)                            # 1.0 = the circle Android keeps
alpha = np.clip((0.97 - r) / (0.97 - 0.74), 0, 1)
alpha = alpha * alpha * (3 - 2 * alpha)                   # smoothstep
icon = Image.fromarray(np.dstack([crop, alpha * 255]).astype(np.uint8), 'RGBA')

# 2. Brand image (wordmark + tagline), 200x80dp: lift the text off its gradient into a transparent PNG.
x0, x1, y0, y1 = 822, 1902, 1519, 1951                    # 1080 x 432 = 2.5:1 around the text
reg = a[y0:y1, x0:x1]
lum = reg.max(axis=2)
textmask = lum > 60
# Background estimate: blur of the non-text pixels only (normalized convolution).
m = (~textmask).astype(np.float32)
def blur(arr, rad):                                       # 8-bit is plenty for a smooth background estimate
    return np.asarray(Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), 'L').filter(ImageFilter.GaussianBlur(rad))).astype(np.float32)
mb = np.maximum(blur(m * 255, 30), 1)
bgc = np.dstack([blur(reg[..., k] * m, 30) / mb * 255 for k in range(3)])
# Text colour near each pixel = the brightest pixel within a few px (anti-aliased edges take their glyph's colour).
big = Image.fromarray(reg.astype(np.uint8)).filter(ImageFilter.MaxFilter(7))
fg = np.asarray(big).astype(np.float32)
num = reg.max(axis=2) - bgc.max(axis=2)
den = fg.max(axis=2) - bgc.max(axis=2)
alpha_t = np.where(den > 25, np.clip(num / np.maximum(den, 1), 0, 1), 0)
alpha_t[:50] = 0                                          # the icon's faint reflection sits just above the wordmark
brand = Image.fromarray(np.dstack([fg, alpha_t * 255]).astype(np.uint8), 'RGBA')

for name, scale in [('mdpi', 1), ('hdpi', 1.5), ('xhdpi', 2), ('xxhdpi', 3), ('xxxhdpi', 4)]:
    d = f'{RES}/drawable-{name}'
    icon.resize((round(288 * scale),) * 2, Image.LANCZOS).save(f'{d}/splash_icon.png', optimize=True)
    brand.resize((round(200 * scale), round(80 * scale)), Image.LANCZOS).save(f'{d}/splash_branding.png', optimize=True)

# Preview: a 412x915dp phone at 2x, laid out the way Android 12 draws it (icon centred, brand image 60dp off the bottom).
W, H = 824, 1830
pv = Image.new('RGBA', (W, H), tuple(int(v) for v in BG) + (255,))
ic = icon.resize((576, 576), Image.LANCZOS); pv.alpha_composite(ic, ((W - 576) // 2, (H - 576) // 2))
br = brand.resize((400, 160), Image.LANCZOS); pv.alpha_composite(br, ((W - 400) // 2, H - 160 - 120))
pv.convert('RGB').save(OUT)
print('ok')
