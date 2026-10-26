"""Draw the Rockslink icon set from assets/favicon.svg (the white R mark on
navy), rendered large with PyMuPDF and scaled down for clean edges.

  favicon.ico            16, 32, 48 px (site root, for browsers and search)
  assets/icon-192.png    web app manifest
  assets/icon-512.png    web app manifest
  assets/apple-touch-icon.png   180 px, square (iOS rounds the corners)

usage: python -I tools/make-icons.py   (from the project root)
"""
from pathlib import Path

import fitz
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
BIG = 2048                  # render size before scaling down


def master():
    """the favicon SVG as a BIG x BIG RGB image"""
    doc = fitz.open(stream=(ROOT / "assets/favicon.svg").read_bytes(), filetype="svg")
    page = doc[0]
    k = BIG / page.rect.width
    pix = page.get_pixmap(matrix=fitz.Matrix(k, k), alpha=False)
    return Image.frombytes("RGB", (pix.width, pix.height), pix.samples).resize((BIG, BIG), Image.LANCZOS)


def main():
    im = master()
    icon = lambda size: im.resize((size, size), Image.LANCZOS)
    icon(48).save(ROOT / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48)])
    icon(192).save(ROOT / "assets/icon-192.png", optimize=True)
    icon(512).save(ROOT / "assets/icon-512.png", optimize=True)
    icon(180).save(ROOT / "assets/apple-touch-icon.png", optimize=True)
    print("icons written")


if __name__ == "__main__":
    main()
