"""Bake a plaster-relief world map (equirectangular) like the reference:
light grey, land raised in contour terraces, lit from the top left.

usage: python -I relief.py land-50m.json out.webp [width]
"""
import json
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

src, out = sys.argv[1], sys.argv[2]
W = int(sys.argv[3]) if len(sys.argv) > 3 else 3000
H = W // 2
LAT_TOP, LAT_BOT = 80.0, -58.0
SS = 1  # supersample factor for the mask

# ---- land mask from the topology -------------------------------------------
t = json.load(open(src))
sx, sy = t["transform"]["scale"]
tx, ty = t["transform"]["translate"]
arcs = []
for arc in t["arcs"]:
    x = y = 0
    pts = []
    for dx, dy in arc:
        x += dx
        y += dy
        pts.append((x * sx + tx, y * sy + ty))
    arcs.append(pts)


def ring(idx):
    pts = []
    for i in idx:
        a = arcs[i] if i >= 0 else arcs[~i][::-1]
        pts.extend(a if not pts else a[1:])
    return pts


def to_px(lon, lat):
    return ((lon + 180) / 360 * W, (90 - lat) / 180 * H)


mask_img = Image.new("L", (W, H), 0)
d = ImageDraw.Draw(mask_img)
for g in t["objects"]["land"]["geometries"]:
    polys = g["arcs"] if g["type"] == "MultiPolygon" else [g["arcs"]]
    for poly in polys:
        for k, r in enumerate(poly):
            # unwrap longitudes across the antimeridian, then draw the ring
            # again one world-width over so both halves land on the canvas
            raw = ring(r)
            un, off = [], 0.0
            for i, (lon, lat) in enumerate(raw):
                if i and lon + off - un[-1][0] > 180: off -= 360
                elif i and lon + off - un[-1][0] < -180: off += 360
                un.append((lon + off, lat))
            if len(un) < 3:
                continue
            for shift in (-360, 0, 360):
                d.polygon([to_px(lon + shift, lat) for lon, lat in un], fill=255 if k == 0 else 0)
land = np.asarray(mask_img) > 127

# ---- height field -----------------------------------------------------------
rng = np.random.default_rng(7)
px_per_deg = W / 360


def fbm(octaves=6, base=6):
    acc = np.zeros((H, W))
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        n = base * 2 ** o
        g = rng.random((n // 2 + 2, n + 2))
        z = ndimage.zoom(g, (H / g.shape[0], W / g.shape[1]), order=3)[:H, :W]
        acc += amp * z
        tot += amp
        amp *= 0.5
    return acc / tot


dist = ndimage.distance_transform_edt(land)
base = 1 - np.exp(-dist / (4.0 * px_per_deg))           # rises inland, plateaus
n = fbm()
n = (n - n.min()) / (n.max() - n.min())
h = 0.3 * base + 0.62 * n * np.clip(dist / (1.2 * px_per_deg), 0, 1)

# mountain ranges as ridges: (lon, lat) polylines, height, half-width in deg
RANGES = [
    ([(70, 37), (76, 35), (82, 31), (88, 28.5), (95, 29)], 1.0, 4.5),        # Himalaya
    ([(78, 34), (86, 33), (95, 33)], 0.8, 6.0),                            # Tibet
    ([(-75, 10), (-78, -2), (-76, -12), (-70, -20), (-70, -30), (-71, -42), (-73, -50)], 0.95, 2.2),  # Andes
    ([(-150, 62), (-135, 58), (-123, 50), (-115, 43), (-108, 37), (-106, 31)], 0.5, 4.5),  # Rockies
    ([(6, 45.5), (10, 46.5), (14, 47)], 0.55, 1.6),                        # Alps
    ([(-8, 31), (-2, 33), (5, 35.5)], 0.45, 1.6),                          # Atlas
    ([(37, 14), (39, 9), (38, 4)], 0.55, 3.0),                             # Ethiopian highlands
    ([(36, -2), (35, -9), (33, -15)], 0.35, 2.5),                          # East African rift
    ([(44, 39), (52, 36), (60, 34), (68, 35)], 0.5, 2.5),                  # Zagros / Hindu Kush
    ([(-45, 62), (-40, 70), (-38, 76)], 0.8, 6.0),                         # Greenland ice
    ([(28, -26), (30, -30)], 0.35, 2.5),                                    # Drakensberg
    ([(147, -37), (150, -31), (152, -26)], 0.3, 1.8),                      # Great Dividing Range
    ([(93, 50), (100, 49), (108, 50)], 0.18, 4.5),                         # Altai / Mongolia
    ([(59, 50), (59, 60), (62, 67)], 0.12, 2.5),                            # Urals
]
yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
for pts, amp, wdeg in RANGES:
    seg = np.full((H, W), np.inf, dtype=np.float32)
    P = [to_px(*p) for p in pts]
    for (x0, y0), (x1, y1) in zip(P, P[1:]):
        vx, vy = x1 - x0, y1 - y0
        L2 = vx * vx + vy * vy
        k = np.clip(((xx - x0) * vx + (yy - y0) * vy) / L2, 0, 1)
        dd = np.hypot(xx - (x0 + k * vx), yy - (y0 + k * vy))
        seg = np.minimum(seg, dd)
    wpx = wdeg * px_per_deg
    h += amp * np.exp(-(seg / wpx) ** 2) * (0.75 + 0.5 * n)

h = h * land
# terraces: contour steps, then a soft bevel on each step
LEVELS = 15
ter = np.floor(h * LEVELS) / LEVELS + 0.06 * land          # coast is one step up
ter = ndimage.gaussian_filter(ter, 1.1 * W / 3000)

# ---- light it ---------------------------------------------------------------
k = 26.0 * W / 3000
gy, gx = np.gradient(ter * k)
nx, ny, nz = -gx, -gy, np.ones_like(gx)
nl = np.sqrt(nx * nx + ny * ny + nz * nz)
L = np.array([-0.55, -0.7, 0.75])
L = L / np.linalg.norm(L)
lam = (nx * L[0] + ny * L[1] + nz * L[2]) / nl
flat = L[2]
shade = (lam - flat)                                        # 0 on flat ground

# soft cast shadow of the raised land onto lower ground / sea (light from
# the upper left, so shadows fall down and to the right)
off = int(round(8 * W / 3000))
lift = ndimage.shift(ndimage.gaussian_filter(ter, 6 * W / 3000), (off * 1.3, off), order=1, mode="nearest")
cast = np.clip((lift - ter) * 2.6, 0, 0.45)
# ambient occlusion: ground below its surroundings sits in soft shade
ao = np.clip((ndimage.gaussian_filter(ter, 10 * W / 3000) - ter) * 2.5, 0, 0.25)

paper = np.array([223, 227, 231], dtype=np.float32)       # sea
grain = (fbm(4, 120) - 0.5) * 3.0
img = paper[None, None, :] + 0 * xx[..., None]
img = img + (shade * 150)[..., None] - (cast * 80)[..., None] - (ao * 55)[..., None] + grain[..., None]
img = img + (land * 6)[..., None]                           # land a touch lighter
img = np.clip(img, 0, 255).astype(np.uint8)

y0 = int((90 - LAT_TOP) / 180 * H)
y1 = int((90 - LAT_BOT) / 180 * H)
Image.fromarray(img[y0:y1]).save(out, quality=84, method=6)
print("saved", out, W, y1 - y0)
