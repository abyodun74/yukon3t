"""Slice the owner's gift icon sheet ("Glowing Gift Icon Gallery", 1536x1024, a grid of glowing icons on a dark navy
backdrop, each with a tier badge and its name under it) into the per-gift WebP files in public/gifts/art/ and write
the typed manifest src/lib/gift-art-images.ts.

    python scripts/slice-gift-art.py "<path to the sheet .png>" [--preview contact.png]

Needs Python 3 with Pillow (WebP support), numpy and opencv-python. Deterministic: the same sheet gives the same bytes
with the same library versions. The sheet itself is not in the repo; keep the original somewhere safe.

How it works (no fixed pixel positions):
- The backdrop is modelled as a smooth degree-4 polynomial fitted to the pixels close to it.
- Each cell is found from its text: the tier word (a short white line inside the pill) right above the gift's name (a
  taller white line). Rows are clustered by the name's height on the sheet, cells sorted left to right, and the cell's
  art is everything above its pill, between the midpoints to its neighbours and below the row above's names.
- The art is NOT cut out to transparency. A clean matte isn't possible for every icon (the graduation cap's top is the
  backdrop's own colour), so every icon keeps its dark backdrop, re-based onto one navy (the sheet's light falls off
  towards the bottom), and fades out towards the square's edges (a rounded-square fade), which blends on the app's dark
  gift stage. The badge and name are replaced by plain backdrop, the bottom few rows above the badge are feathered.
- Output per gift: <slug>.<hash>.webp (384x384) and <slug>-192.<hash>.webp (192x192). The source art is only about
  110-220 px per icon, so the 384 file is up to ~2x interpolated: no detail beyond the sheet's.
"""

import argparse
import hashlib
import os
import sys

import cv2
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, "public", "gifts", "art")
MANIFEST = os.path.join(ROOT, "src", "lib", "gift-art-images.ts")

# The sheet's cells in reading order (row by row, left to right), named by the gift item slug (= its assetKey) they
# show. None = not used: row 5's second cell is a second, smaller "Trophy Frame"; row 1's first one is cleaner.
CELLS = [
    "trophy-frame", "birthday-balloons", "teddy-bear", "fireworks", "keepsake-locket", "high-five",
    "wave", "coffee", "rose", "grad-cap", "supporter-star", "kindred-spirit",
    "aurora-frame", "frost-frame", "gold-ring-frame", "confetti", "aurora-sweep", "heartbeat-note",
    "paper-crane", "forget-me-not", "birthday-candle", "cake-slice", "gold-star", "gg-badge",
    "level-up", None, "pixel-heart", "gold-orchid", "midnight-crystal-frame", "lantern",
    "shared-table", "playful-kitten", "houseplant", "sunset-postcard", "shooting-star",
]
LARGE, THUMB = 384, 192
NOISE = 14.0  # colour distance from the backdrop model that is still backdrop (its residual noise)
MARGIN = 1.24  # square side = longest side of the art's body x this
FADE_FROM, FADE_TO = 0.74, 1.0  # rounded-square fade, as a fraction of the half side
FADE_POWER = 4  # superellipse exponent: 2 = circle, higher = squarer
TEXT_PAD = 5  # px around every detected badge word and name that is always replaced by plain backdrop


def background_model(im):
    h, w, _ = im.shape
    ys, xs = np.mgrid[0:h, 0:w]
    u, v = xs / w * 2 - 1, ys / h * 2 - 1
    basis = np.stack([u**i * v**j for i in range(5) for j in range(5 - i)], -1)
    mask = im.mean(-1) < 45
    bg = np.zeros_like(im)
    for _ in range(4):
        sel = mask[::4, ::4].ravel()
        a = basis[::4, ::4].reshape(-1, basis.shape[-1])[sel]
        for c in range(3):
            coef, *_ = np.linalg.lstsq(a, im[::4, ::4, c].ravel()[sel], rcond=None)
            bg[..., c] = basis @ coef
        mask = np.sqrt(((im - bg) ** 2).sum(-1)) < NOISE
    return bg


def find_rows(im):
    """Rows of (pill text box, name box), each sorted left to right. Boxes are (x, y, w, h)."""
    lo, hi = im.min(-1), im.max(-1)
    white = ((lo >= 165) & (hi - lo <= 60)).astype(np.uint8)
    white = cv2.dilate(white, np.ones((1, 9), np.uint8))
    _, _, stats, _ = cv2.connectedComponentsWithStats(white, 8)
    comps = [tuple(int(v) for v in s[:4]) for s in stats[1:]]
    pills = [c for c in comps if 5 <= c[3] <= 11 and 25 <= c[2] <= 100]
    names = [c for c in comps if 9 <= c[3] <= 18 and 30 <= c[2] <= 180]
    pairs = []
    for name in names:
        centre = name[0] + name[2] / 2
        best = None
        for p in pills:
            gap = name[1] - (p[1] + p[3])
            if abs(p[0] + p[2] / 2 - centre) <= 20 and 4 <= gap <= 18 and (best is None or gap < best[0]):
                best = (gap, p)
        if best:
            pairs.append((best[1], name))
    # A pill's own word can pass as a "name" under something white in the art above it: drop those.
    as_pill = {p for p, _ in pairs}
    pairs = sorted(((p, n) for p, n in pairs if n not in as_pill), key=lambda pn: pn[1][1])
    rows, row = [], []
    for pn in pairs:
        if row and pn[1][1] - row[-1][1][1] > 40:
            rows.append(row)
            row = []
        row.append(pn)
    rows.append(row)
    return [sorted(r, key=lambda pn: pn[0][0] + pn[0][2] / 2) for r in rows]


def cell_regions(rows, width):
    cells, prev = [], []
    for row in rows:
        centres = [p[0] + p[2] / 2 for p, _ in row]
        out = []
        for i, (p, name) in enumerate(row):
            x0 = 0 if i == 0 else int((centres[i - 1] + centres[i]) / 2)
            x1 = width if i == len(row) - 1 else int((centres[i] + centres[i + 1]) / 2)
            above = [c for c in prev if c["x0"] < x1 and c["x1"] > x0]
            y0 = max([c["name_bottom"] + 2 for c in above], default=0)
            # The pill's coloured body starts about 5 px above its word.
            out.append({"x0": x0, "x1": x1, "y0": y0, "y1": p[1] - 7, "name_bottom": name[1] + name[3], "text": [p, name]})
        cells.extend(out)
        prev = out
    return cells


def body_box(im, bg, cell):
    """Bounding box (x, y, w, h, sheet coordinates) of the art's bright body, glow mostly excluded."""
    x0, x1, y0, y1 = cell["x0"], cell["x1"], cell["y0"], cell["y1"]
    diff = np.maximum(im[y0:y1, x0:x1] - bg[y0:y1, x0:x1], 0)
    strong = (np.sqrt((diff**2).sum(-1)) > 70).astype(np.uint8)
    strong = cv2.morphologyEx(strong, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9)))
    n, labels, stats, _ = cv2.connectedComponentsWithStats(strong, 8)
    if n < 2:
        sys.exit(f"no art found in cell {cell}")
    biggest = stats[1:, 4].max()
    keep = [i for i in range(1, n) if stats[i, 4] >= 0.04 * biggest]
    ys, xs = np.nonzero(np.isin(labels, keep))
    return x0 + xs.min(), y0 + ys.min(), xs.max() - xs.min() + 1, ys.max() - ys.min() + 1


def render(rebased, target, cell, box, text_mask):
    h, w, _ = rebased.shape
    bx, by, bw, bh = box
    side = int(round(max(bw, bh) * MARGIN))
    cx, cy = bx + bw / 2, by + bh / 2
    sx, sy = int(round(cx - side / 2)), int(round(cy - side / 2))
    # Weight 1 inside the cell's art area, 0 outside (badge, name, neighbours), feathered; outside is plain backdrop.
    inside = np.zeros((h, w), np.float64)
    inside[cell["y0"]:cell["y1"], cell["x0"]:cell["x1"]] = 1
    inside = cv2.GaussianBlur(inside, (0, 0), 2.5)
    inside[cell["y1"]:, :] = 0
    inside *= 1 - text_mask
    canvas = np.empty((side, side, 3))
    canvas[:] = target
    weight = np.zeros((side, side, 1))
    ax0, ay0, ax1, ay1 = max(sx, 0), max(sy, 0), min(sx + side, w), min(sy + side, h)
    canvas[ay0 - sy: ay1 - sy, ax0 - sx: ax1 - sx] = rebased[ay0:ay1, ax0:ax1]
    weight[ay0 - sy: ay1 - sy, ax0 - sx: ax1 - sx, 0] = inside[ay0:ay1, ax0:ax1]
    rgb = canvas * weight + target * (1 - weight)
    images = {}
    for size in (LARGE, THUMB):
        scaled = cv2.resize(rgb, (size, size), interpolation=cv2.INTER_LANCZOS4 if size > side else cv2.INTER_AREA)
        t = (np.arange(size) + 0.5) / size * 2 - 1
        norm = (np.abs(t)[None, :] ** FADE_POWER + np.abs(t)[:, None] ** FADE_POWER) ** (1 / FADE_POWER)
        f = np.clip((FADE_TO - norm) / (FADE_TO - FADE_FROM), 0, 1)
        alpha = f * f * (3 - 2 * f)
        rgba = np.dstack([np.clip(scaled, 0, 255), alpha * 255])
        images[size] = Image.fromarray(np.round(rgba).astype(np.uint8), "RGBA")
    return images, side


def save(img, stem):
    import io

    buf = io.BytesIO()
    img.save(buf, "WEBP", quality=85, alpha_quality=90, method=6, exact=False)
    data = buf.getvalue()
    name = f"{stem}.{hashlib.sha256(data).hexdigest()[:10]}.webp"
    with open(os.path.join(OUT_DIR, name), "wb") as fh:
        fh.write(data)
    return name, len(data)


MANIFEST_HEAD = '''// GENERATED by scripts/slice-gift-art.py from the owner's gift icon sheet ("Glowing Gift Icon Gallery"); do not edit by
// hand, re-run the script (see CLAUDE.md, "Art pipeline"). Each entry is a gift item's assetKey (= its slug) and its two
// square WebP files in public/gifts/art/ (content-hashed names, so they are cached as immutable). The icons keep the
// sheet's dark navy backdrop and fade out towards the edges (no transparent cut-out: see the script's header).

export type GiftArtImage = {
  /** The large picture (square). */
  src: string;
  width: number;
  height: number;
  /** The small picture (square), for art drawn small. */
  thumbSrc: string;
  thumbWidth: number;
  thumbHeight: number;
};

export const GIFT_ART_IMAGES = {
'''


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("sheet", help="path to the original sheet (PNG)")
    ap.add_argument("--preview", help="also write a contact sheet of the results (dark and light backdrop) here")
    args = ap.parse_args()

    im = np.asarray(Image.open(args.sheet).convert("RGB")).astype(np.float64)
    bg = background_model(im)
    target = bg.reshape(-1, 3).mean(0)
    rebased = im - bg + target
    rows = find_rows(im)
    cells = cell_regions(rows, im.shape[1])
    if len(cells) != len(CELLS):
        sys.exit(f"found {len(cells)} cells ({[len(r) for r in rows]} per row), expected {len(CELLS)}")

    # Every badge word and name on the sheet (padded, softened): a wide square can reach the row above's names.
    text_mask = np.zeros(im.shape[:2], np.float64)
    for cell in cells:
        for x, y, w, h in cell["text"]:
            text_mask[max(y - TEXT_PAD, 0): y + h + TEXT_PAD, max(x - TEXT_PAD, 0): x + w + TEXT_PAD] = 1
    text_mask = np.clip(cv2.GaussianBlur(text_mask, (0, 0), 1.5) * 1.5, 0, 1)

    os.makedirs(OUT_DIR, exist_ok=True)
    for old in os.listdir(OUT_DIR):
        if old.endswith(".webp"):
            os.remove(os.path.join(OUT_DIR, old))

    lines, results = [], []
    for slug, cell in zip(CELLS, cells):
        if slug is None:
            continue
        box = body_box(im, bg, cell)
        images, side = render(rebased, target, cell, box, text_mask)
        large, large_bytes = save(images[LARGE], slug)
        thumb, thumb_bytes = save(images[THUMB], f"{slug}-{THUMB}")
        results.append((slug, box, side, large_bytes, thumb_bytes, images[LARGE]))
        lines.append(
            f'  "{slug}": {{ src: "/gifts/art/{large}", width: {LARGE}, height: {LARGE}, '
            f'thumbSrc: "/gifts/art/{thumb}", thumbWidth: {THUMB}, thumbHeight: {THUMB} }},'
        )
    lines.sort()
    with open(MANIFEST, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(MANIFEST_HEAD + "\n".join(lines) + "\n} as const satisfies Readonly<Record<string, GiftArtImage>>;\n")

    for slug, box, side, lb, tb, _ in results:
        print(f"{slug:24} body {box[2]:3}x{box[3]:<3} square {side:3}px  {lb / 1024:5.1f} KB + {tb / 1024:4.1f} KB")
    print(f"{len(results)} gifts, {sum(r[3] + r[4] for r in results) / 1024:.0f} KB total")

    if args.preview:
        tile, cols = 160, 6
        sheet = Image.new("RGB", (cols * tile * 2, ((len(results) + cols - 1) // cols) * tile), (40, 40, 40))
        for i, (*_, img) in enumerate(results):
            small = img.resize((tile, tile), Image.LANCZOS)
            for j, colour in enumerate([(14, 17, 19), (246, 244, 240)]):
                back = Image.new("RGBA", (tile, tile), colour + (255,))
                back.alpha_composite(small)
                sheet.paste(back.convert("RGB"), ((i % cols) * tile * 2 + j * tile, (i // cols) * tile))
        sheet.save(args.preview)


if __name__ == "__main__":
    main()
