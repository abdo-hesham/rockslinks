"""Bake the cloud bank and edge haze that sit over the atlas map in the
contact framing, laid out like the contact reference: a cumulus bank along
the bottom right, a column of cloud down the right edge, and a pale haze
over the far left (the Americas) and the top.

The clouds are lifted from the reference itself (REF.webp, 1672 x 941):
inside the bank they are taken whole, toward its edge only the bright cloud
is kept so the map shows through, and past the reference's right and bottom
edges they are mirrored so a wide screen never meets a cut. The haze is
drawn. Output is an RGBA webp in reference pixels at scale 1; the layer's
origin is at reference (X0, Y0).

usage: python -I bake-clouds.py REF.webp OUT.webp [seed] [--clouds-only]
  --clouds-only  no haze and no veil: for laying the reference's own clouds
                 back over the route when the map underneath is the
                 reference itself
"""
import sys

import numpy as np
from PIL import Image
from scipy import ndimage as nd

REF, OUT = sys.argv[1], sys.argv[2]
S = 1.0
ONLY = "--clouds-only" in sys.argv
args = [a for a in sys.argv[3:] if not a.startswith("--")]
rng = np.random.default_rng(int(args[0]) if args else 7)

# the layer covers the reference frame plus a margin, in reference pixels
X0, Y0, X1, Y1 = -120, -80, 1800, 1020
W, H = int((X1 - X0) * S), int((Y1 - Y0) * S)
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
rx = X0 + xx / S
ry = Y0 + yy / S


def ss(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def interp(pts, v):
    a = np.array(pts, float)
    return np.interp(v, a[:, 0], a[:, 1])


# ---- coverage: where the reference has cloud ---------------------------------
# bottom bank: the top edge of the bank by x, and its left end
top = interp([(780, 820), (830, 680), (860, 600), (930, 570), (990, 600), (1050, 615), (1110, 600),
              (1190, 640), (1290, 668), (1390, 655), (1500, 645), (1600, 630), (1800, 610)], rx)
left = interp([(560, 860), (640, 840), (700, 830), (800, 822), (941, 812), (1100, 805)], ry)
bank = ss(top - 20, top + 70, ry) * ss(left - 30, left + 60, rx)
# right column: its left edge by y
cleft = interp([(-100, 1150), (40, 1230), (120, 1300), (220, 1350), (330, 1410), (430, 1450),
                (530, 1500), (640, 1560), (760, 1600)], ry)
col = ss(cleft - 40, cleft + 90, rx)
cover = np.maximum(bank, col)

# ---- the reference's own clouds ---------------------------------------------
ref = np.asarray(Image.open(REF).convert("RGB"), np.float32)
RH, RW = ref.shape[:2]
# take the reference's route and checkpoint glow out of the clouds: find the
# blue, then fill it from the cloud around it (normalised convolution)
blue = (ref[..., 2] - ref[..., 0] > 30) | ((ref[..., 2] - ref[..., 0] > 18) & (ref.mean(-1) < 200))
blue[:, :780] = False
blue[:690] = False
blue[800:] = False  # the route runs out at about (900, 745)
blue[:, 1000:] = False
blue = nd.binary_dilation(blue, iterations=4)
keep = (~blue).astype(np.float32)
for _ in range(3):
    num = np.stack([nd.gaussian_filter(ref[..., c] * keep, 6) for c in range(3)], -1)
    den = nd.gaussian_filter(keep, 6)[..., None] + 1e-6
    ref = np.where(blue[..., None] & (den > 0.05), num / den, ref)
# sample it over the whole layer, mirrored past its edges
ix = np.clip(rx, 0, None)
ix = np.where(ix > RW - 1, 2 * (RW - 1) - ix, ix).clip(0, RW - 1)
iy = np.clip(ry, 0, None)
iy = np.where(iy > RH - 1, 2 * (RH - 1) - iy, iy).clip(0, RH - 1)
col_rgb = np.stack([nd.map_coordinates(ref[..., c], [iy, ix], order=1) for c in range(3)], -1)
lum = col_rgb.mean(-1)
# opaque deep in the bank; toward its edge keep what is brighter than the sea
core = ss(0.6, 0.9, cover)
bright = ss(223, 236, nd.gaussian_filter(lum, 2.0))
alpha = np.maximum(core, ss(0.05, 0.35, cover) * bright)
alpha = nd.gaussian_filter(alpha, 1.2)

# soft veil around the bank so it sits in the air, not on the map
veil = nd.gaussian_filter(alpha, 20 * S) * (0 if ONLY else 0.25)

# ---- edge haze: the far left, the top, the bottom left ---------------------------
haze = np.maximum.reduce([
    ss(500, 90, rx) * 0.93,
    ss(170, -40, ry) * 0.55 * ss(300, 900, rx) + ss(150, -60, ry) * 0.4,
    ss(820, 980, ry) * ss(640, 300, rx) * 0.75,
    ss(1080, 1300, rx) * ss(330, 60, ry) * 0.55,
])
c_haze = np.array([233, 239, 246], np.float32)
c_veil = np.array([244, 247, 251], np.float32)

# composite (premultiplied, then unpremultiplied for the file)
A_h = haze * (0 if ONLY else 1)
A_v = veil * (1 - A_h)
A_c = alpha
pre = (c_haze * A_h[..., None])
pre = pre * (1 - A_v[..., None]) + c_veil * A_v[..., None]
A_hv = A_h + A_v * (1 - A_h)
pre = pre * (1 - A_c[..., None]) + col_rgb * A_c[..., None]
A = A_c + A_hv * (1 - A_c)
out = np.zeros((H, W, 4), np.uint8)
out[..., :3] = np.clip(pre / np.maximum(A[..., None], 1e-4), 0, 255)
out[..., 3] = np.clip(A * 255, 0, 255)
Image.fromarray(out, "RGBA").save(OUT, quality=82, method=6)
print("saved", OUT, out.shape)
