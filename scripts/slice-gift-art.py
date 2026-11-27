"""Slice the owner's gift icon sheet ("Glowing Gift Icon Gallery", 1536x1024, a grid of glowing icons on a dark navy
backdrop, each with a tier badge and its name under it) into the per-gift WebP files in public/gifts/art/ and write
the typed manifest src/lib/gift-art-images.ts. With --legendary, slice the owner's Legendary diptych instead (see below).

    python scripts/slice-gift-art.py "<path to the sheet .png>" [--preview contact.png]
    python scripts/slice-gift-art.py --legendary "<path to the Legendary Rose and Golden Orchid Duo .png>" [--preview p.png]
    python scripts/slice-gift-art.py --jewelry "<path to the Legendary Diamond Jewelry Gift Box .png>" [--preview p.png]

Needs Python 3 with Pillow (WebP support), numpy and opencv-python. Deterministic: the same sheet gives the same bytes
with the same library versions. Neither original is in the repo; keep them somewhere safe. Each mode only replaces
its own gifts' files in public/gifts/art/ (the sheet: the slugs in CELLS; --legendary: the slugs in LEGENDARY;
--jewelry: JEWELRY_SLUG only).

--jewelry: the owner's "Legendary Diamond Jewelry Gift Box" (1402x1122, one full scene: the open velvet box with the
necklace and earrings, a gold bow, floating diamonds, gold orbit rings and a baked "LEGENDARY" plaque, which is kept).
It is wider than tall and is kept whole at its own aspect (no crop, no padding: an earlier version padded it to a
square with a blurred copy of itself, which read as a smudged band): 768 and 256 px wide, the height following the
source (615 / 205), with a rounded-rectangle edge that feathers only the outer 6% of each half side (JEWELRY_FADE_FROM),
so it reads as a clean card. WebP q72 (a busier picture than the diptych halves). The reveal's poster draws it
object-contain in its square box and the legendary scene's plane takes the same aspect. Output: <slug>.<hash>.webp and
<slug>-256.<hash>.webp, and the manifest src/lib/gift-jewelry-art-images.ts.

--legendary: the owner's "Legendary Rose and Golden Orchid Duo" (1774x887, two square scenes side by side: the Luxury
Red Rose on the left, the Gold Orchid on the right, each with its baked "LEGENDARY" plaque, which is kept). The seam is
found as the strongest colour step between neighbouring columns in the middle tenth of the width; each half is
cropped to the largest centred square (the whole artwork, ~887 px). The PNG's alpha is nearly opaque (~245) and falls
off only at the far edges: it is normalised by its median and the art composited over black, then the same kind of
rounded-square fade as the icons is applied (starting further out, these are full scenes). Output per gift:
<slug>.<hash>.webp (768x768, the reveal's art and the legendary 3D scene's texture) and <slug>-256.<hash>.webp, and
the manifest src/lib/gift-legendary-art-images.ts. The 768 file is slightly downscaled from the source, never upscaled.

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
# show. None = not used: row 5's second cell is a second, smaller "Trophy Frame"; row 1's first one is cleaner. Row
# 5's fourth cell is the sheet's Gold Orchid, replaced by the Legendary diptych's (--legendary).
CELLS = [
    "trophy-frame", "birthday-balloons", "teddy-bear", "fireworks", "keepsake-locket", "high-five",
    "wave", "coffee", "rose", "grad-cap", "supporter-star", "kindred-spirit",
    "aurora-frame", "frost-frame", "gold-ring-frame", "confetti", "aurora-sweep", "heartbeat-note",
    "paper-crane", "forget-me-not", "birthday-candle", "cake-slice", "gold-star", "gg-badge",
    "level-up", None, "pixel-heart", None, "midnight-crystal-frame", "lantern",
    "shared-table", "playful-kitten", "houseplant", "sunset-postcard", "shooting-star",
]
LARGE, THUMB = 384, 192
NOISE = 14.0  # colour distance from the backdrop model that is still backdrop (its residual noise)
MARGIN = 1.24  # square side = longest side of the art's body x this
FADE_FROM, FADE_TO = 0.74, 1.0  # rounded-square fade, as a fraction of the half side
FADE_POWER = 4  # superellipse exponent: 2 = circle, higher = squarer
TEXT_PAD = 5  # px around every detected badge word and name that is always replaced by plain backdrop

# --legendary: the diptych's halves, left to right, by item slug.
LEGENDARY = ["luxury-red-rose", "gold-orchid"]
LEGENDARY_LARGE, LEGENDARY_THUMB = 768, 256
LEGENDARY_FADE_FROM = 0.8
LEGENDARY_QUALITY = 76
LEGENDARY_MANIFEST = os.path.join(ROOT, "src", "lib", "gift-legendary-art-images.ts")

# --jewelry: the Diamond Jewelry Gift Box (one scene, wider than tall).
JEWELRY_SLUG = "diamond-jewelry-box"
JEWELRY_FADE_FROM = 0.94  # only the outer 6% of each half side feathers: a clean card edge, nothing of the art lost
JEWELRY_FADE_POWER = 10  # squarish rounded corners
JEWELRY_QUALITY = 72  # a busier picture than the diptych halves: a notch lower to stay in the 120 KB budget
JEWELRY_MANIFEST = os.path.join(ROOT, "src", "lib", "gift-jewelry-art-images.ts")


def remove_outputs(slugs):
    """Deletes this mode's previous files (and only those): <slug>.<hash>.webp and <slug>-<size>.<hash>.webp."""
    import re

    pattern = re.compile(r"^(%s)(-\d+)?\.[0-9a-f]{10}\.webp$" % "|".join(re.escape(s) for s in slugs))
    for old in os.listdir(OUT_DIR):
        if pattern.match(old):
            os.remove(os.path.join(OUT_DIR, old))


def edge_fade(size, fade_from):
    """Rounded-square (superellipse) alpha fade, 1 inside `fade_from` of the half side, smoothstepped to 0 at the edge."""
    t = (np.arange(size) + 0.5) / size * 2 - 1
    norm = (np.abs(t)[None, :] ** FADE_POWER + np.abs(t)[:, None] ** FADE_POWER) ** (1 / FADE_POWER)
    f = np.clip((FADE_TO - norm) / (FADE_TO - fade_from), 0, 1)
    return f * f * (3 - 2 * f)


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
        alpha = edge_fade(size, FADE_FROM)
        rgba = np.dstack([np.clip(scaled, 0, 255), alpha * 255])
        images[size] = Image.fromarray(np.round(rgba).astype(np.uint8), "RGBA")
    return images, side


def save(img, stem, quality=85):
    import io

    buf = io.BytesIO()
    img.save(buf, "WEBP", quality=quality, alpha_quality=90, method=6, exact=False)
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


LEGENDARY_MANIFEST_HEAD = '''// GENERATED by scripts/slice-gift-art.py --legendary from the owner's "Legendary Rose and Golden Orchid Duo"; do not
// edit by hand, re-run the script (see CLAUDE.md, "Art pipeline"). Each entry is a gift item's assetKey (= its slug) and
// its two square WebP files in public/gifts/art/ (content-hashed names, cached as immutable): the whole scene on its
// dark backdrop (the baked "LEGENDARY" plaque included), fading out towards the edges. The large file is also the
// texture of the legendary 3D scene (src/components/gift-scene-legendary.tsx).

import type { GiftArtImage } from "@/lib/gift-art-images";

export const GIFT_LEGENDARY_ART_IMAGES = {
'''


JEWELRY_MANIFEST_HEAD = '''// GENERATED by scripts/slice-gift-art.py --jewelry from the owner's "Legendary Diamond Jewelry Gift Box"; do not edit
// by hand, re-run the script (see CLAUDE.md, "Art pipeline"). The gift item's assetKey (= its slug) and its two
// WebP files in public/gifts/art/ (content-hashed names, cached as immutable): the whole scene at its own aspect
// (wider than tall), the baked "LEGENDARY" plaque included, with a narrow rounded-rectangle feather at the edge.
// The large file is also the texture of its legendary 3D scene (src/components/gift-scene-legendary.tsx).

import type { GiftArtImage } from "@/lib/gift-art-images";

export const GIFT_JEWELRY_ART_IMAGES = {
'''


def edge_fade_rect(width, height, fade_from):
    """Rounded-rectangle alpha fade for a non-square picture: 1 inside `fade_from` of each half side, a narrow smooth
    feather to 0 at the edge, corners rounded by a squarish superellipse."""
    tx = (np.arange(width) + 0.5) / width * 2 - 1
    ty = (np.arange(height) + 0.5) / height * 2 - 1
    power = JEWELRY_FADE_POWER
    norm = (np.abs(tx)[None, :] ** power + np.abs(ty)[:, None] ** power) ** (1 / power)
    f = np.clip((FADE_TO - norm) / (FADE_TO - fade_from), 0, 1)
    return f * f * (3 - 2 * f)


def slice_jewelry(path, preview):
    rgb = np.asarray(Image.open(path).convert("RGB")).astype(np.float64)
    h, w, _ = rgb.shape
    if h >= w:
        sys.exit("expected a picture wider than tall")
    print(f"source {w}x{h}, kept whole at its own aspect")
    os.makedirs(OUT_DIR, exist_ok=True)
    remove_outputs([JEWELRY_SLUG])
    out, dims = {}, {}
    for width in (LEGENDARY_LARGE, LEGENDARY_THUMB):
        height = int(round(width * h / w))
        scaled = cv2.resize(rgb, (width, height), interpolation=cv2.INTER_AREA)
        rgba = np.dstack([np.clip(scaled, 0, 255), edge_fade_rect(width, height, JEWELRY_FADE_FROM) * 255])
        out[width] = Image.fromarray(np.round(rgba).astype(np.uint8), "RGBA")
        dims[width] = height
    large, large_bytes = save(out[LEGENDARY_LARGE], JEWELRY_SLUG, quality=JEWELRY_QUALITY)
    thumb, thumb_bytes = save(out[LEGENDARY_THUMB], f"{JEWELRY_SLUG}-{LEGENDARY_THUMB}", quality=JEWELRY_QUALITY)
    print(f"{JEWELRY_SLUG:24} {large_bytes / 1024:5.1f} KB + {thumb_bytes / 1024:4.1f} KB")
    line = (
        f'  "{JEWELRY_SLUG}": {{ src: "/gifts/art/{large}", width: {LEGENDARY_LARGE}, height: {dims[LEGENDARY_LARGE]}, '
        f'thumbSrc: "/gifts/art/{thumb}", thumbWidth: {LEGENDARY_THUMB}, thumbHeight: {dims[LEGENDARY_THUMB]} }},'
    )
    with open(JEWELRY_MANIFEST, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(JEWELRY_MANIFEST_HEAD + line + "\n} as const satisfies Readonly<Record<string, GiftArtImage>>;\n")
    if preview:
        write_preview(preview, [out[LEGENDARY_LARGE]])


def write_preview(path, images):
    tile, cols = 160, 6
    sheet = Image.new("RGB", (cols * tile * 2, ((len(images) + cols - 1) // cols) * tile), (40, 40, 40))
    for i, img in enumerate(images):
        small = img.resize((tile, tile), Image.LANCZOS)
        for j, colour in enumerate([(14, 17, 19), (246, 244, 240)]):
            back = Image.new("RGBA", (tile, tile), colour + (255,))
            back.alpha_composite(small)
            sheet.paste(back.convert("RGB"), ((i % cols) * tile * 2 + j * tile, (i // cols) * tile))
    sheet.save(path)


def slice_sheet(path, preview):
    im = np.asarray(Image.open(path).convert("RGB")).astype(np.float64)
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
    remove_outputs([slug for slug in CELLS if slug])

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
    if preview:
        write_preview(preview, [r[5] for r in results])


def find_seam(rgb):
    """The column where the right half starts: the strongest step between neighbouring columns near the middle."""
    w = rgb.shape[1]
    step = np.abs(np.diff(rgb, axis=1)).mean(axis=(0, 2))
    lo, hi = int(w * 0.45), int(w * 0.55)
    return lo + int(np.argmax(step[lo:hi])) + 1


def slice_legendary(path, preview):
    src = np.asarray(Image.open(path).convert("RGBA")).astype(np.float64)
    rgb, alpha = src[..., :3], src[..., 3]
    alpha = np.clip(alpha / max(np.median(alpha), 1), 0, 1)
    rgb = rgb * alpha[..., None]
    h, w, _ = rgb.shape
    seam = find_seam(rgb)
    halves = [(0, seam), (seam, w)]
    print(f"source {w}x{h}, seam at column {seam}")

    os.makedirs(OUT_DIR, exist_ok=True)
    remove_outputs(LEGENDARY)
    lines, previews = [], []
    for slug, (x0, x1) in zip(LEGENDARY, halves):
        side = min(h, x1 - x0)
        sx, sy = x0 + (x1 - x0 - side) // 2, (h - side) // 2
        crop = rgb[sy: sy + side, sx: sx + side]
        out = {}
        for size in (LEGENDARY_LARGE, LEGENDARY_THUMB):
            if size > side:
                sys.exit(f"{slug}: the half is only {side}px, smaller than {size}px")
            scaled = cv2.resize(crop, (size, size), interpolation=cv2.INTER_AREA)
            rgba = np.dstack([np.clip(scaled, 0, 255), edge_fade(size, LEGENDARY_FADE_FROM) * 255])
            out[size] = Image.fromarray(np.round(rgba).astype(np.uint8), "RGBA")
        large, large_bytes = save(out[LEGENDARY_LARGE], slug, quality=LEGENDARY_QUALITY)
        thumb, thumb_bytes = save(out[LEGENDARY_THUMB], f"{slug}-{LEGENDARY_THUMB}", quality=LEGENDARY_QUALITY)
        print(f"{slug:24} crop {side}px at ({sx},{sy})  {large_bytes / 1024:5.1f} KB + {thumb_bytes / 1024:4.1f} KB")
        previews.append(out[LEGENDARY_LARGE])
        lines.append(
            f'  "{slug}": {{ src: "/gifts/art/{large}", width: {LEGENDARY_LARGE}, height: {LEGENDARY_LARGE}, '
            f'thumbSrc: "/gifts/art/{thumb}", thumbWidth: {LEGENDARY_THUMB}, thumbHeight: {LEGENDARY_THUMB} }},'
        )
    lines.sort()
    with open(LEGENDARY_MANIFEST, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(
            LEGENDARY_MANIFEST_HEAD + "\n".join(lines) + "\n} as const satisfies Readonly<Record<string, GiftArtImage>>;\n"
        )
    if preview:
        write_preview(preview, previews)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("sheet", nargs="?", help="path to the original icon sheet (PNG)")
    ap.add_argument("--legendary", metavar="DUO", help="path to the original Legendary diptych (PNG) instead of the sheet")
    ap.add_argument("--jewelry", metavar="BOX", help="path to the original Diamond Jewelry Gift Box (PNG) instead of the sheet")
    ap.add_argument("--preview", help="also write a contact sheet of the results (dark and light backdrop) here")
    args = ap.parse_args()
    if sum(bool(x) for x in (args.sheet, args.legendary, args.jewelry)) != 1:
        ap.error("give exactly one of: the sheet, --legendary DUO, --jewelry BOX")
    if args.jewelry:
        slice_jewelry(args.jewelry, args.preview)
    elif args.legendary:
        slice_legendary(args.legendary, args.preview)
    else:
        slice_sheet(args.sheet, args.preview)


if __name__ == "__main__":
    main()
