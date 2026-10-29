"""(Superseded by scripts/make_icon_eye.py, which builds the eye icon.) Build the IV Studio icons from build/icon-source.png.

    python scripts/make_icon.py

The source is a square render of the tile on black (FLUX.2 Klein 9B, made locally in ComfyUI). The
tile is found by brightness, cropped, centred on a 1024 canvas at the same size as the other IV app
icons and cut out with a rounded-square mask, so the corners are transparent. Writes build/icon.png
(1024), build/icon.ico (32-bit BMP frames for 16-128 px, PNG frame for 256 px, which Explorer needs
to show the icon) and resources/icon.png (256).
"""

import io
import struct
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
BMP_SIZES = (16, 20, 24, 32, 40, 48, 64, 128)
TILE = 944  # the tile's size on the 1024 canvas, as in the other IV icons
RADIUS = 0.2  # corner radius as a share of the tile


def bmp_frame(img):
    w, h = img.size
    px = img.convert("RGBA").transpose(Image.FLIP_TOP_BOTTOM).tobytes("raw", "BGRA")
    mask_row = ((w + 31) // 32) * 4
    header = struct.pack("<IiiHHIIiiII", 40, w, h * 2, 1, 32, 0, len(px) + mask_row * h, 0, 0, 0, 0)
    return header + px + bytes(mask_row * h)


def write_ico(img, path):
    frames = [(s, bmp_frame(img.resize((s, s), Image.LANCZOS))) for s in BMP_SIZES]
    png = io.BytesIO()
    img.resize((256, 256), Image.LANCZOS).save(png, "PNG")
    frames.append((256, png.getvalue()))
    out = struct.pack("<HHH", 0, 1, len(frames))
    offset = 6 + 16 * len(frames)
    for size, data in frames:
        dim = 0 if size >= 256 else size
        out += struct.pack("<BBBBHHII", dim, dim, 0, 0, 1, 32, len(data), offset)
        offset += len(data)
    path.write_bytes(out + b"".join(d for _, d in frames))


def main():
    src = Image.open(ROOT / "build" / "icon-source.png").convert("RGB")
    lum = np.asarray(src.convert("L"))
    ys, xs = np.where(lum > 45)  # the tile body and its rim, not the glow around it
    tile = src.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)).resize((TILE, TILE), Image.LANCZOS)

    canvas = Image.new("RGB", (1024, 1024))
    pad = (1024 - TILE) // 2
    canvas.paste(tile, (pad, pad))
    mask = Image.new("L", (4096, 4096))
    ImageDraw.Draw(mask).rounded_rectangle((pad * 4, pad * 4, (pad + TILE) * 4, (pad + TILE) * 4), radius=TILE * RADIUS * 4, fill=255)
    mask = mask.resize((1024, 1024), Image.LANCZOS).filter(ImageFilter.GaussianBlur(0.6))

    icon = canvas.copy()
    icon.putalpha(mask)
    icon.save(ROOT / "build" / "icon.png")
    write_ico(icon, ROOT / "build" / "icon.ico")
    (ROOT / "resources").mkdir(exist_ok=True)
    icon.resize((256, 256), Image.LANCZOS).save(ROOT / "resources" / "icon.png")
    print("Icons written to build/ and resources/")


if __name__ == "__main__":
    main()
