# Closed version of IV Studio's title-bar eye mark (iv-mark.png), for Incognito. It is built from the mark's
# own pixels: the real outer almond outline, kept below its middle (the shut lid), raised to sit across the
# eye's middle, with lashes drawn at the outline's own stroke width. The iris is left out.
import sys
from collections import deque
import numpy as np
from PIL import Image, ImageDraw

src, out = sys.argv[1], sys.argv[2]
S = 4  # work at 4x for clean edges
mark = Image.open(src).convert('RGBA')
w, h = mark.size
big = mark.resize((w * S, h * S), Image.LANCZOS)
a = np.asarray(big)[:, :, 3] > 128
H, W = a.shape

# the outer outline: the connected shape that reaches the mark's left edge
seen = np.zeros_like(a)
start = next((y, x) for x in range(W) for y in range(H) if a[y, x])
q = deque([start]); seen[start] = True
while q:
    y, x = q.popleft()
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        ny, nx = y + dy, x + dx
        if 0 <= ny < H and 0 <= nx < W and a[ny, nx] and not seen[ny, nx]:
            seen[ny, nx] = True; q.append((ny, nx))
outline = seen

# its stroke width, measured at the bottom middle
col = outline[:, W // 2]
ys = np.where(col)[0]
bottom = ys[ys > H // 2]
stroke = int(bottom.max() - bottom.min() + 1)

# keep the lower half of the outline (the lid, curved like a smile), then lift it so the curve's ends sit at
# the eye's middle and its lowest point a little below
mid = H // 2
lid = outline.copy()
lid[:mid] = False
lift = int((H - mid) * 0.42)
canvas = np.zeros_like(lid)
canvas[: H - lift] = lid[lift:]

img = Image.fromarray((canvas * 255).astype(np.uint8), 'L')
d = ImageDraw.Draw(img)
# lashes: short strokes hanging off the lid, pointing outward from the curve
xs = np.where(canvas.any(0))[0]
x0, x1 = xs.min(), xs.max()
for t in (0.22, 0.36, 0.5, 0.64, 0.78):
    x = int(x0 + (x1 - x0) * t)
    yb = np.where(canvas[:, x])[0].max()  # outer (lower) edge of the lid at x
    # the lid's slope here, to point each lash away from the curve
    xl, xr = max(x - 6 * S, x0), min(x + 6 * S, x1)
    yl, yr = np.where(canvas[:, xl])[0].max(), np.where(canvas[:, xr])[0].max()
    nx, ny = -(yr - yl), (xr - xl)
    n = np.hypot(nx, ny); nx, ny = nx / n, ny / n
    L = stroke * 2.6
    d.line([(x, yb - stroke * 0.4), (x + nx * L, yb + ny * L)], fill=255, width=stroke)
alpha = img.resize((w, h), Image.LANCZOS)
res = Image.new('RGBA', (w, h), (255, 255, 255, 0))
res.putalpha(alpha)
res.save(out)
print('stroke', stroke / S, 'px at 1x; saved', out)
