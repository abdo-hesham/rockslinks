"""Draw the Rockslink icon set from the mark in assets/favicon.svg (two
interlocking links, white on navy), supersampled for clean edges.

  favicon.ico            16, 32, 48 px (site root, for browsers and search)
  assets/icon-192.png    web app manifest
  assets/icon-512.png    web app manifest
  assets/apple-touch-icon.png   180 px, square (iOS rounds the corners)

usage: python -I tools/make-icons.py   (from the project root)
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
NAVY = (23, 34, 47, 255)    # #17222f, as the SVG
WHITE = (255, 255, 255, 255)
SS = 8                      # supersampling


def icon(size, rounded=True):
    """the SVG's 40 x 40 design at `size` px"""
    big = size * SS
    k = big / 40
    im = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if rounded:
        d.rounded_rectangle([0, 0, big - 1, big - 1], radius=9 * k, fill=NAVY)
    else:
        d.rectangle([0, 0, big - 1, big - 1], fill=NAVY)
    # two pill outlines, stroke 3 centred on the SVG's rect edges
    w = 3 * k
    for x in (5, 17):
        d.rounded_rectangle([(x - 1.5) * k, (13 - 1.5) * k, (x + 18 + 1.5) * k, (27 + 1.5) * k], radius=(7 + 1.5) * k, outline=WHITE, width=round(w))
    return im.resize((size, size), Image.LANCZOS)


def main():
    icon(48).save(ROOT / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    icon(192).save(ROOT / "assets/icon-192.png", optimize=True)
    icon(512).save(ROOT / "assets/icon-512.png", optimize=True)
    icon(180, rounded=False).convert("RGB").save(ROOT / "assets/apple-touch-icon.png", optimize=True)
    print("icons written")


if __name__ == "__main__":
    main()
