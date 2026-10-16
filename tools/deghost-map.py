"""Second pass after clean-reference.py: even out the soft grey patch the
reference container and its glow left in central Africa, by giving the
broad tone there the tone of the ground around it (fine relief kept).

usage: python deghost-map.py MAP.webp OUT.webp
"""
import cv2, numpy as np, sys
from scipy import ndimage as nd
src, out = sys.argv[1], sys.argv[2]
a = cv2.imread(src).astype(np.float32)
S = a.shape[1] / 2500  # map-frame px per unit
cx, cy, R = (680 + 400) * S, (462 + 250) * S, 120 * S
x0, y0, x1, y1 = int(cx - 3 * R), int(cy - 3 * R), int(cx + 3 * R), int(cy + 3 * R)
c = a[y0:y1, x0:x1]
yy, xx = np.mgrid[y0:y1, x0:x1]
d = np.hypot(xx - cx, yy - cy) / R
inside = (d < 1.15).astype(np.float32)
w = np.clip((1.35 - d) / 0.45, 0, 1); w = w * w * (3 - 2 * w)
sig = 22 * S
ok = 1 - inside
for ch in range(3):
    low = nd.gaussian_filter(c[..., ch], sig)
    tgt = nd.gaussian_filter(c[..., ch] * ok, sig * 2.2) / (nd.gaussian_filter(ok, sig * 2.2) + 1e-4)
    c[..., ch] += (tgt - low) * w
a[y0:y1, x0:x1] = c
cv2.imwrite(out, np.clip(a, 0, 255).astype(np.uint8), [cv2.IMWRITE_WEBP_QUALITY, 86])
