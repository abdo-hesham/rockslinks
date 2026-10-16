"""Make the atlas map from the contact reference itself: take out the route,
the checkpoints and the container, and extend the terrain past the
reference's edges into the map frame.

The reference (1672 x 941) becomes the middle of a 2500 x 1450 frame (offset
400, 250), the same frame main.js uses; the output is that frame at SCALE.

  route dashes   found by their blue (excess over the local background),
                 closed into one stroke and inpainted (Telea)
  checkpoints,   discs over each light, filled with terrain from a clean spot
  container      nearby, blended in with Poisson cloning, then the blue light
                 they threw on the ground is taken out

usage: python clean-reference.py REF.webp OUT.webp [scale]
(needs numpy, scipy, opencv; run without -I if opencv is a user install)
"""
import sys

import cv2
import numpy as np
from scipy import ndimage as nd

REF, OUT = sys.argv[1], sys.argv[2]
SCALE = float(sys.argv[3]) if len(sys.argv) > 3 else 2.0

img = cv2.imread(REF)  # BGR
H, W = img.shape[:2]
f = img.astype(np.float32)
blue_excess = (f[..., 0] - f[..., 2])
blue_excess = blue_excess - nd.median_filter(blue_excess, size=41)

# ---- where the overlays are ----------------------------------------------------
CONTAINER = (690, 452, 50, 56)  # centre x, y, radius x, y (box, ring and its light)
LIGHTS = [(592, 249), (674, 232), (757, 299), (850, 359), (621, 598), (723, 684), (900, 745)]
yy, xx = np.mgrid[0:H, 0:W]

route = (blue_excess > 9) & nd.binary_opening(blue_excess > 9, iterations=1) | (blue_excess > 20)
# close the dashes into one stroke (the white between the blue dashes goes too)
route = nd.binary_closing(route, iterations=7)
route = nd.binary_dilation(route, iterations=5)

discs = []
cx, cy, rx, ry = CONTAINER
discs.append(((cx, cy), (rx, ry)))
for x, y in LIGHTS:
    discs.append(((x, y), (21, 21)))


def disc_mask(c, r, grow=0):
    return (((xx - c[0]) / (r[0] + grow)) ** 2 + ((yy - c[1]) / (r[1] + grow)) ** 2) <= 1


holes = np.zeros((H, W), bool)
for c, r in discs:
    holes |= disc_mask(c, r)
dirty = holes | route

def clean_mean(v, sigma):
    """local mean of v over clean pixels only (normalised convolution)"""
    ok = (~dirty).astype(np.float32)
    return nd.gaussian_filter(v * ok, sigma) / (nd.gaussian_filter(ok, sigma) + 1e-4)


# ---- first, the blue light the lights and the box threw on the ground -----------
# each pixel keeps its own detail but takes the colour, and near the box the
# broad brightness, of the clean ground around it
near = np.zeros((H, W), np.float32)
for i, (c, r) in enumerate(discs):
    grow = 2.4 if i == 0 else 2.0
    d = np.sqrt(((xx - c[0]) / (r[0] * grow)) ** 2 + ((yy - c[1]) / (r[1] * grow)) ** 2)
    near = np.maximum(near, np.clip(1.5 - d, 0, 1))
near = np.maximum(near, nd.gaussian_filter(route.astype(np.float32), 3) * 1.6).clip(0, 1)
f = img.astype(np.float32)
lum = f.mean(-1)
chroma = f - lum[..., None]
target = np.stack([clean_mean(chroma[..., i], 25) for i in range(3)], -1)
f = lum[..., None] + chroma * (1 - near[..., None]) + target * near[..., None]
# the box's glow also brightened the ground: take the broad excess out
c, r = discs[0]
d = np.sqrt(((xx - c[0]) / (r[0] * 2.4)) ** 2 + ((yy - c[1]) / (r[1] * 2.4)) ** 2)
w = np.clip(1.5 - d, 0, 1)
low = nd.gaussian_filter(lum, 10)
excess = np.clip(low - clean_mean(lum, 45), 0, None)
f -= (excess * w * 0.6)[..., None]
out = np.clip(f, 0, 255).astype(np.uint8)

# ---- fill the discs from clean terrain nearby (Poisson) -------------------------
OFFSETS = [(-140, 0), (-150, 30), (-120, -30), (-130, 0), (0, 90), (-60, 60), (60, 60), (0, -90), (-90, -40), (90, 0), (-45, 0), (0, 45), (45, 0), (0, -45)]
for c, r in discs:
    for dx, dy in OFFSETS:
        src = np.roll(np.roll(dirty, -dy, 0), -dx, 1)  # dirtiness at the source spot
        sx, sy = c[0] + dx, c[1] + dy
        if not (r[0] + 6 < sx < W - r[0] - 6 and r[1] + 6 < sy < H - r[1] - 6):
            continue
        dm = disc_mask(c, r, 6)
        if (src & dm).sum() > 0.01 * dm.sum():
            continue
        x0, x1 = int(sx - r[0] - 4), int(sx + r[0] + 5)
        y0, y1 = int(sy - r[1] - 4), int(sy + r[1] + 5)
        patch = out[y0:y1, x0:x1].copy()
        pm = (disc_mask((sx, sy), r, 2)[y0:y1, x0:x1] * 255).astype(np.uint8)
        out = cv2.seamlessClone(patch, out, pm, (int(c[0]), int(c[1])), cv2.NORMAL_CLONE)
        break
    else:
        print("no clean source for", c)

# ---- the route: inpaint, then lend it the grain of the ground beside it -----------
rest = route & ~holes
smooth = cv2.inpaint(out, rest.astype(np.uint8) * 255, 4, cv2.INPAINT_TELEA).astype(np.float32)
grain = np.zeros_like(smooth)
got = np.zeros((H, W), np.float32)
for dx, dy in ((22, 0), (-22, 0), (0, 22), (0, -22)):
    sh = np.roll(np.roll(out.astype(np.float32), dy, 0), dx, 1)
    ok = ~np.roll(np.roll(dirty, dy, 0), dx, 1)
    hf = sh - cv2.GaussianBlur(sh, (0, 0), 3)
    take = ok & rest & (got < 0.5)
    grain[take] = hf[take]
    got[take] = 1
soft = nd.gaussian_filter(rest.astype(np.float32), 1.2)[..., None]
out = np.clip(out * (1 - soft) + (smooth + grain) * soft, 0, 255).astype(np.uint8)
cv2.imwrite(OUT.replace(".webp", "-ref.png"), out)

# ---- into the map frame: scale up, extend the edges into haze -------------------------
FX, FY, FW, FH = 400, 250, 2500, 1450
big = cv2.resize(out, (int(W * SCALE), int(H * SCALE)), interpolation=cv2.INTER_LANCZOS4)
blur = cv2.GaussianBlur(big, (0, 0), 1.0)
big = cv2.addWeighted(big, 1.35, blur, -0.35, 0)  # keep the upscale crisp
px, py = int(FX * SCALE), int(FY * SCALE)
TW, TH = int(FW * SCALE), int(FH * SCALE)
frame = cv2.copyMakeBorder(big, py, TH - py - big.shape[0], px, TW - px - big.shape[1], cv2.BORDER_REFLECT)
# outside the reference: soften the mirror and fade it into the page's haze
inside = np.zeros((TH, TW), np.float32)
inside[py:py + big.shape[0], px:px + big.shape[1]] = 1
dist = nd.distance_transform_edt(inside < 0.5) / SCALE  # reference px outside the edge
soft = cv2.GaussianBlur(frame, (0, 0), 6 * SCALE)
k = np.clip(dist / 40, 0, 1)[..., None]
frame = frame * (1 - k) + soft * k
haze = np.array([246, 240, 234], np.float32)  # BGR of #eaf0f6
h = np.clip((dist - 30) / 220, 0, 1)[..., None]
frame = frame * (1 - h) + haze * h
cv2.imwrite(OUT, np.clip(frame, 0, 255).astype(np.uint8), [cv2.IMWRITE_WEBP_QUALITY, 88])
print("saved", OUT, frame.shape)
