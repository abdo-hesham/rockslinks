"""Bake the dot mask for the Services map light (main.js, initMapLight).

The Services background is a raster: a dotted world map in pale blue-grey on
a hazy white sky. The dots are darker than the haze around them, so the mask
is the local darkness: a grey closing (max filter, wider than a dot) of the
luminance minus the luminance itself, normalised and gated so cloud shading
and grain do not count as dots. Saved grey (the shader takes the spill onto
neighbouring dots from a few taps around each pixel).

usage: python -I bake-dotmask.py BG.webp OUT.webp
"""
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as nd

BG, OUT = sys.argv[1], sys.argv[2]
img = np.asarray(Image.open(BG).convert("RGB")).astype(np.float32)
lum = img @ np.array([0.299, 0.587, 0.114], np.float32)
blue = img[..., 2] - img[..., 0]  # the dots are bluer than the haze

# the haze around each dot: brightest value nearby, then smoothed
haze = nd.gaussian_filter(nd.grey_closing(lum, size=(11, 11)), 1.5)
dark = np.clip(haze - lum, 0, None)


def ss(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


# a dot is clearly darker than its haze and bluer than it is grey; soft
# cloud shading is broad, so it barely registers in the local darkness
m = ss(6, 26, dark) * ss(14, 30, blue)
m = nd.gaussian_filter(m, 0.6)

# grey only: lossy webp keeps luma at full resolution (the shader spreads it)
out = np.clip(m * 255, 0, 255).astype(np.uint8)
Image.fromarray(out, "L").convert("RGB").save(OUT, quality=82, method=6)
print("saved", OUT, out.shape, "coverage", float((m > 0.5).mean()))
