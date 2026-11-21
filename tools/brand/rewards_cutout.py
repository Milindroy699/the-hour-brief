"""Cut the reward art (Nano Banana sheets on white paper, brand/rewards/source/) into transparent WebP assets.

  /opt/miniconda3/bin/python3 tools/brand/rewards_cutout.py

Background removal: flood from the image border through pixels that look like the paper (bright and nearly colourless),
so white areas enclosed by a badge's gold rim survive while the paper and its soft contact shadows go. Items are then the
connected clusters of what is left (small parts near an item, like a flame's sparkles, join it); clusters that look
like the printed labels ("PERFECT", "offline") are dropped. Output: brand/rewards/<group>/<name>.webp (+ a contact sheet).
"""
import os, sys
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as ndi

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC = os.path.join(ROOT, 'brand', 'rewards', 'source')
OUT = os.path.join(ROOT, 'brand', 'rewards')


def alpha_mask(img, bright=188, chroma=26, shadow=False):
    a = np.asarray(img.convert('RGB')).astype(np.int16)
    mx, mn = a.max(2), a.min(2)
    paperish = (mn > bright) & ((mx - mn) < chroma)          # the paper, its texture and the light grey contact shadows
    if shadow:                                                # also the darker grey drop shadows (coloured art only: gold rims, enamel)
        paperish |= (mn > 95) & ((mx - mn) < 20)
    lab, _ = ndi.label(paperish)
    border = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    bg = np.isin(lab, border[border > 0])
    fg = ~bg
    fg = ndi.binary_opening(fg, iterations=1)                 # specks of texture
    fg = ndi.binary_fill_holes(fg) if False else fg
    soft = Image.fromarray((fg * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8))
    return fg, soft


def clusters(fg, join=14, min_area=900):
    """Items: connected parts, with parts within `join` px of each other merged (sparkles around a flame)."""
    grown = ndi.binary_dilation(fg, iterations=join)
    lab, n = ndi.label(grown)
    out = []
    for i, sl in enumerate(ndi.find_objects(lab), 1):
        part = fg[sl] & (lab[sl] == i)
        area = int(part.sum())
        if area < min_area:
            continue
        ys, xs = np.nonzero(part)
        y0, y1, x0, x1 = ys.min() + sl[0].start, ys.max() + sl[0].start, xs.min() + sl[1].start, xs.max() + sl[1].start
        out.append(dict(box=(x0, y0, x1 + 1, y1 + 1), area=area, cx=(x0 + x1) / 2, cy=(y0 + y1) / 2, w=x1 - x0, h=y1 - y0, label=i))
    return out, lab


def is_text(c, img_h):
    return c['w'] > 2.4 * c['h'] and c['h'] < img_h * 0.09     # a short wide strip: a printed label


def save(img, soft, fg, lab, c, path, size, pad=0.06, circle=False):
    x0, y0, x1, y1 = c['box']
    keep = (lab == c['label']) & fg
    alpha = np.minimum(np.asarray(soft), (ndi.binary_dilation(keep, iterations=2) * 255).astype(np.uint8))
    if circle:                                                # round medallions: a clean disc instead of the traced edge
        H, W = fg.shape
        cy, cx, r = (y0 + y1) / 2, (x0 + x1) / 2, max(x1 - x0, y1 - y0) / 2 - 1.5
        yy, xx = np.mgrid[0:H, 0:W]
        d = np.sqrt((yy - cy) ** 2 + (xx - cx) ** 2)
        alpha = (np.clip(r - d + 0.5, 0, 1) * 255).astype(np.uint8)
    rgba = np.dstack([np.asarray(img.convert('RGB')), alpha])
    crop = Image.fromarray(rgba[y0:y1, x0:x1], 'RGBA')
    side = int(max(crop.size) * (1 + 2 * pad))
    canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    canvas.paste(crop, ((side - crop.size[0]) // 2, (side - crop.size[1]) // 2))
    canvas = canvas.resize((size, size), Image.LANCZOS)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    canvas.save(path, 'WEBP', quality=88, method=6)
    return canvas


def sheet(name, group, names, size=256, order='rows', join=14, min_area=900, keep_text=False, shadow=False, circle=False):
    img = Image.open(os.path.join(SRC, name))
    fg, soft = alpha_mask(img, shadow=shadow)
    items, lab = clusters(fg, join=join, min_area=min_area)
    items = [c for c in items if keep_text or not is_text(c, img.size[1])]
    if order == 'rows':                                        # reading order: rows (by centre, with tolerance), then left to right
        items.sort(key=lambda c: (round(c['cy'] / (img.size[1] * 0.12)), c['cx']))
    elif order == 'cols':                                      # columns, top to bottom
        items.sort(key=lambda c: (round(c['cx'] / (img.size[0] * 0.12)), c['cy']))
    else:
        items.sort(key=lambda c: c['cx'])
    made = []
    for c, n in zip(items, names):
        if n is None:
            continue
        made.append((n, save(img, soft, fg, lab, c, os.path.join(OUT, group, n + '.webp'), size, circle=circle)))
    print(f'{name}: {len(items)} items found, {len(made)} saved -> {group}/', [n for n, _ in made])
    if len(items) != len(names):
        print(f'  ! expected {len(names)} items, found {len(items)}: {[c["box"] for c in items]}')
    return made


if __name__ == '__main__':
    made = []
    # The eight badges the app has, plus the spare medallion (used for locked badges), matte enamel set
    made += sheet('achievement-badges-2.jpg', 'badges', ['first', 'perfect', 'streak3', 'streak7', 'streak30', 'regular', 'sharp', 'champion', 'locked'], join=4, shadow=True, circle=True)
    # The four new badges, same set: left column headphones / bubbles / bubbles, right column early bird / century / century-orbit
    made += sheet('medallion-badges-1.jpg', 'badges', ['listener', 'voices', None, 'earlybird', 'century-alt', 'century'], order='cols', join=4, shadow=True, circle=True)
    # Quiz result medals: Perfect (gold), Sharp (silver), Solid (bronze), Keep going (seedling)
    img = Image.open(os.path.join(SRC, 'award-objects-1.jpg')); fg, soft = alpha_mask(img)
    lab = np.ones(fg.shape, dtype=np.int32)
    for n, (x0, x1) in [('perfect', (140, 480)), ('sharp', (495, 745)), ('solid', (770, 1022)), ('keepgoing', (1040, 1280))]:
        col = np.zeros_like(fg); col[:540, x0:x1] = fg[:540, x0:x1]
        ys, xs = np.nonzero(col)
        c = dict(box=(xs.min(), ys.min(), xs.max() + 1, ys.max() + 1), label=1)
        made.append((n, save(img, soft, col, lab, c, os.path.join(OUT, 'medals', n + '.webp'), 320)))
    print('award-objects-1.jpg: 4 medals by column')
    # Streak flame stages
    made += sheet('streak-flames-1.jpg', 'flames', ['spark', 'flame', 'blaze', 'inferno', 'legend'], size=256, order='x', join=12, min_area=400, shadow=True)
    # Empty states and the sign-in scene
    # (left, top, side) of a square around each scene, in source pixels (896 x 1200), clear of the printed labels
    for f, n, box in [('bookmark-ribbon-floating.jpg', 'saved-empty', (78, 300, 740)), ('no-league-yet.jpg', 'no-league', (118, 420, 660)),
                      ('offline.jpg', 'offline', (208, 230, 480)), ('quiz-done.jpg', 'quiz-done', (88, 230, 720)), ('sign-in.jpg', 'sign-in', (48, 300, 800))]:
        img = Image.open(os.path.join(SRC, f)).convert('RGB')
        x, y, side = box
        im = img.crop((x, y, x + side, y + side)).resize((480, 480), Image.LANCZOS)
        os.makedirs(os.path.join(OUT, 'scenes'), exist_ok=True)
        im.save(os.path.join(OUT, 'scenes', n + '.webp'), 'WEBP', quality=86, method=6)
        made.append((n, im.convert('RGBA')))
    print('scenes: 5 square crops')
    # Icons (hourglass, newspaper, bell, globe)
    made += sheet('news-app-icons.jpg', 'icons', ['hourglass', 'brief', 'reminder', 'world'], size=256, join=20)
    # Confetti pieces: every piece from both sheets, small
    img_names = []
    for f, tag in [('confetti-pieces-1.jpg', 'a'), ('confetti-pieces-2.jpg', 'b')]:
        img = Image.open(os.path.join(SRC, f)); fg, soft = alpha_mask(img)
        items, lab = clusters(fg, join=2, min_area=60)
        items.sort(key=lambda c: (round(c['cy'] / 60), c['cx']))
        for k, c in enumerate(items):
            n = f'{tag}{k:02d}'
            save(img, soft, fg, lab, c, os.path.join(OUT, 'confetti', n + '.webp'), 64, pad=0.1)
            img_names.append(n)
        print(f'{f}: {len(items)} confetti pieces')
    # contact sheet on a checkerboard-free mid grey and on dark, to eyeball the cut-outs
    tiles = [im for _, im in made]
    cols = 8; s = 128
    rows = (len(tiles) + cols - 1) // cols
    for bgname, bg in [('light', (250, 249, 253, 255)), ('dark', (18, 19, 22, 255))]:
        cs = Image.new('RGBA', (cols * s, rows * s), bg)
        for i, t in enumerate(tiles):
            cs.alpha_composite(t.resize((s, s)), ((i % cols) * s, (i // cols) * s))
        cs.convert('RGB').save(os.path.join(OUT, f'_contact-{bgname}.png'))
    print('contact sheets written')
