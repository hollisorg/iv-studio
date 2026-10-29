"""Icon options from Infinite Variance's eye artwork (src/renderer/src/assets/eye.webp).

    python scripts/make_icon_eye.py            # writes build/icon-options/ (A, B, C + a size sheet)
    python scripts/make_icon_eye.py B          # makes option B the app icon (build/icon.png, .ico, resources/icon.png)

A  close crop: the eye fills the tile, swirls at the edges
B  wider crop: more of the swirling art around a smaller eye
C  the eye alone on the dark ink tile, with a soft glow (clearest at taskbar sizes)
Every option gets the rounded tile and the thin coral rim the other IV app icons have.
"""
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
ART = ROOT / "src" / "renderer" / "src" / "assets" / "eye.webp"
OUT = ROOT / "build" / "icon-options"
SIZE = 1024
TILE = 944
RADIUS = 0.2
EYE = (692, 372)  # the eye's centre in eye.webp (1400x737)
INK = (16, 12, 14)


def tile_mask(scale=4):
    pad = (SIZE - TILE) // 2
    m = Image.new("L", (SIZE * scale, SIZE * scale))
    ImageDraw.Draw(m).rounded_rectangle((pad * scale, pad * scale, (pad + TILE) * scale, (pad + TILE) * scale), radius=TILE * RADIUS * scale, fill=255)
    return m.resize((SIZE, SIZE), Image.LANCZOS)


def crop_square(art, side):
    x, y = EYE
    side = min(side, art.height)
    left = max(0, min(art.width - side, x - side // 2))
    top = max(0, min(art.height - side, y - side // 2))
    return art.crop((left, top, left + side, top + side))


def framed(content):
    """Puts content (TILE x TILE) on the rounded tile with a coral rim and transparent corners."""
    pad = (SIZE - TILE) // 2
    canvas = Image.new("RGB", (SIZE, SIZE), INK)
    canvas.paste(content.convert("RGB").resize((TILE, TILE), Image.LANCZOS), (pad, pad))
    mask = tile_mask()
    # rim: a thin bright line just inside the edge, coral to pink like the other IV icons
    inner = mask.filter(ImageFilter.MinFilter(9))
    rim = ImageChops.subtract(mask, inner).filter(ImageFilter.GaussianBlur(1.2))
    grad = Image.linear_gradient("L").resize((SIZE, SIZE)).rotate(45)
    coral = Image.composite(Image.new("RGB", (SIZE, SIZE), (244, 72, 89)), Image.new("RGB", (SIZE, SIZE), (241, 157, 172)), grad)
    canvas = Image.composite(coral, canvas, rim)
    canvas.putalpha(mask)
    return canvas


def option_c(art):
    """The eye alone, cut out with a soft oval, glowing on the ink tile."""
    eye = crop_square(art, 420)
    w = eye.width
    oval = Image.new("L", (w * 4, w * 4))
    ImageDraw.Draw(oval).ellipse((w * 4 * 0.03, w * 4 * 0.24, w * 4 * 0.97, w * 4 * 0.76), fill=255)
    oval = oval.resize((w, w), Image.LANCZOS).filter(ImageFilter.GaussianBlur(w * 0.05))
    base = Image.new("RGB", (w, w), INK)
    glow = Image.new("L", (w, w))
    ImageDraw.Draw(glow).ellipse((w * 0.08, w * 0.22, w * 0.92, w * 0.78), fill=150)
    glow = glow.filter(ImageFilter.GaussianBlur(w * 0.09))
    base = Image.composite(Image.new("RGB", (w, w), (120, 22, 38)), base, glow)
    return Image.composite(eye.convert("RGB"), base, oval)


def options(art):
    return {"A": framed(crop_square(art, 470)), "B": framed(crop_square(art, 737)), "C": framed(option_c(art))}


def size_sheet(opts):
    """Each option at 256, 64, 32 and 16 px on the dark and on a light background."""
    sizes = [256, 64, 32, 16]
    cell = 280
    sheet = Image.new("RGB", (cell * len(sizes) * 2, cell * len(opts)), (40, 40, 40))
    for r, (name, icon) in enumerate(opts.items()):
        for half, bg in enumerate([(16, 12, 14), (236, 236, 236)]):
            for c, s in enumerate(sizes):
                x0 = (half * len(sizes) + c) * cell
                tile = Image.new("RGB", (cell, cell), bg)
                small = icon.resize((s, s), Image.LANCZOS)
                tile.paste(small, ((cell - s) // 2, (cell - s) // 2), small)
                sheet.paste(tile, (x0, r * cell))
        ImageDraw.Draw(sheet).text((8, r * cell + 6), name, fill=(255, 210, 60))
    return sheet


def install(icon):
    import io
    import struct

    icon.save(ROOT / "build" / "icon.png")
    frames = []
    for s in (16, 20, 24, 32, 40, 48, 64, 128):
        img = icon.resize((s, s), Image.LANCZOS)
        px = img.convert("RGBA").transpose(Image.FLIP_TOP_BOTTOM).tobytes("raw", "BGRA")
        mask_row = ((s + 31) // 32) * 4
        header = struct.pack("<IiiHHIIiiII", 40, s, s * 2, 1, 32, 0, len(px) + mask_row * s, 0, 0, 0, 0)
        frames.append((s, header + px + bytes(mask_row * s)))
    png = io.BytesIO()
    icon.resize((256, 256), Image.LANCZOS).save(png, "PNG")
    frames.append((256, png.getvalue()))
    out = struct.pack("<HHH", 0, 1, len(frames))
    offset = 6 + 16 * len(frames)
    for s, data in frames:
        d = 0 if s >= 256 else s
        out += struct.pack("<BBBBHHII", d, d, 0, 0, 1, 32, len(data), offset)
        offset += len(data)
    (ROOT / "build" / "icon.ico").write_bytes(out + b"".join(d for _, d in frames))
    icon.resize((256, 256), Image.LANCZOS).save(ROOT / "resources" / "icon.png")


def main():
    art = Image.open(ART).convert("RGB")
    opts = options(art)
    if len(sys.argv) > 1:
        install(opts[sys.argv[1].upper()])
        print(f"Option {sys.argv[1].upper()} is now the app icon.")
        return
    OUT.mkdir(parents=True, exist_ok=True)
    for name, icon in opts.items():
        icon.save(OUT / f"option_{name}.png")
    size_sheet(opts).save(OUT / "sizes.png")
    print(f"Options written to {OUT}")


if __name__ == "__main__":
    main()
