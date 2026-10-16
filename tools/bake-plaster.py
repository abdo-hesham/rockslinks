"""Bake the plaster relief map for the atlas (FAQ + Contact).

A white sculpted relief of Europe, Africa and Asia, framed like the contact
reference: the reference camera is a slightly tilted view of a Mercator map,
fitted as a homography from Mercator degrees to reference pixels.

Inputs (downloaded once, not committed):
  tiles  AWS Terrain Tiles, terrarium encoding, zoom 5 (x 0-31, y 2-25)
         https://s3.amazonaws.com/elevation-tiles-prod/terrarium/5/{x}/{y}.png
  vec    world-atlas land-50m.json and Natural Earth ne_50m_lakes.geojson

usage: python -I bake-plaster.py TILES_DIR VEC_DIR OUT.webp [scale] [ports.json]
  scale  output pixels per reference pixel (default 2)
"""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as nd

TILES, VEC, OUT = sys.argv[1:4]
S = float(sys.argv[4]) if len(sys.argv) > 4 else 2.0

# the map frame, in reference pixels (the reference is 1672 x 941)
FX0, FY0, FX1, FY1 = -400, -250, 2100, 1200
W, H = int(round((FX1 - FX0) * S)), int(round((FY1 - FY0) * S))

# Landmarks read off the reference: lon, lat -> reference pixel. The camera is
# a slightly tilted view of a Mercator map, so a homography from Mercator
# degrees fits it (about 14 px rms); a smooth thin-plate correction on top
# takes up the rest, so coasts and the route's ports sit where the
# reference has them.
MARKS = [
    (-18.6, 64.9, 502, 155),   # Iceland
    (4.48, 51.92, 592, 249),   # Rotterdam (route P1)
    (18.65, 54.35, 674, 232),  # Gdansk (P2)
    (30.73, 46.48, 757, 299),  # Odesa (P3)
    (49.87, 40.41, 850, 359),  # Baku (P4)
    (34.84, -19.83, 723, 684), # Beira (P7)
    (-17.5, 14.7, 430, 452),   # Cap-Vert
    (20.0, -34.8, 595, 802),   # Cape Agulhas
    (49.3, -12.0, 806, 660),   # Madagascar north
    (45.2, -25.6, 770, 737),   # Madagascar south
    (33.0, -1.0, 715, 590),    # Lake Victoria
    (39.7, -4.0, 760, 605),    # Mombasa coast
    (77.5, 8.1, 1045, 540),    # Kanyakumari
    (80.7, 7.9, 1070, 542),    # Sri Lanka
    (-7.6, 33.6, 490, 375),    # Casablanca coast
    (-5.6, 36.0, 505, 335),    # Gibraltar
    (-4.8, 48.4, 535, 265),    # Brittany
    (5.5, 58.5, 603, 187),     # Norway, south-west tip
    (25.8, 71.1, 752, 118),    # North Cape
    (25.5, 65.0, 706, 150),    # head of the Gulf of Bothnia
    (-17.0, 21.0, 432, 420),   # Cap Blanc
    (-7.5, 4.4, 452, 527),     # Cape Palmas
    (8.5, 4.0, 543, 543),      # Niger delta / Douala
    (8.7, -0.6, 547, 575),     # Cap Lopez
    (12.3, -6.0, 558, 602),    # Congo mouth
    (14.5, -22.9, 552, 677),   # Walvis Bay
    (31.0, -29.9, 670, 737),   # Durban
    (27.9, -33.0, 652, 763),   # East London
    (39.3, -6.8, 752, 622),    # Dar es Salaam
    (51.3, 10.4, 827, 510),    # Ras Hafun, the Horn
    (43.4, 12.6, 776, 500),    # Bab-el-Mandeb
    (59.8, 22.5, 870, 453),    # Ras al Hadd
    (32.5, 29.9, 757, 413),    # Suez
    (69.5, 21.5, 993, 458),    # Kathiawar
    (88.5, 22.0, 1135, 455),   # Ganges delta
    (80.3, 13.1, 1087, 503),   # Chennai coast
    (95.3, 5.5, 1162, 558),    # Banda Aceh
    (105.8, -5.9, 1228, 620),  # Sumatra, south-east end
    (114.5, -8.0, 1282, 632),  # Java, east end
    (114.0, 0.5, 1295, 585),   # Borneo
    (109.7, 19.2, 1257, 477),  # Hainan
    (121.0, 23.7, 1327, 447),  # Taiwan
    (121.0, 16.0, 1340, 490),  # Luzon
    (138.0, 36.0, 1420, 395),  # Honshu
    (132.0, -1.5, 1430, 600),  # New Guinea, west
]


def merc(lat):
    return np.degrees(np.log(np.tan(np.pi / 4 + np.radians(np.clip(lat, -85, 85)) / 2)))


def fit():
    from scipy.optimize import least_squares
    from scipy.interpolate import RBFInterpolator
    A = np.array(MARKS, float)
    X, Y, u, v = A[:, 0], merc(A[:, 1]), A[:, 2], A[:, 3]

    def hom(p, X, Y):
        w = p[6] * X + p[7] * Y + 1
        return (p[0] * X + p[1] * Y + p[2]) / w, (p[3] * X + p[4] * Y + p[5]) / w

    p = least_squares(lambda p: np.r_[hom(p, X, Y)[0] - u, hom(p, X, Y)[1] - v],
                      [6, 0, 590, 0, -6, 600, 0, 0]).x
    hx, hy = hom(p, X, Y)
    rbf = RBFInterpolator(np.c_[hx, hy], np.c_[u - hx, v - hy],
                          kernel="thin_plate_spline", smoothing=8.0)
    return p, rbf


HP, RBF = fit()
# the correction must stay a gentle, fold-free stretch
_g = np.mgrid[150:1000:10, 350:1150:10].astype(float)
_p = np.c_[_g[1].ravel(), _g[0].ravel()]
_d = RBF(_p).reshape(_g.shape[1], _g.shape[2], 2)
_jx = 1 + np.gradient(_d[..., 0], 10, axis=1)
_jy = 1 + np.gradient(_d[..., 1], 10, axis=0)
print("warp stretch x %.2f-%.2f  y %.2f-%.2f" % (_jx.min(), _jx.max(), _jy.min(), _jy.max()), flush=True)
HM = np.array([HP[0:3], HP[3:6], [HP[6], HP[7], 1.0]])
HI = np.linalg.inv(HM)


def fwd(lon, lat):
    """lon/lat -> reference pixel"""
    v = HM @ np.vstack([lon, merc(lat), np.ones_like(lon)])
    q = np.c_[v[0] / v[2], v[1] / v[2]]
    return q + RBF(q)


def to_out(lon, lat):
    """lon/lat -> output pixel (x, y)"""
    q = fwd(np.asarray(lon, float), np.asarray(lat, float))
    return (q[:, 0] - FX0) * S, (q[:, 1] - FY0) * S


def unwarp(rx, ry):
    """reference pixels -> homography pixels (inverse of the correction),
    on a coarse grid and interpolated"""
    st = 6
    gy, gx = np.mgrid[FY0 - 40:FY1 + 40 + st:st, FX0 - 40:FX1 + 40 + st:st].astype(float)
    p = np.c_[gx.ravel(), gy.ravel()]
    q = p.copy()
    for _ in range(6):
        q = p - RBF(q)
    dxg = (q[:, 0] - p[:, 0]).reshape(gx.shape)
    dyg = (q[:, 1] - p[:, 1]).reshape(gx.shape)
    ci = (ry - (FY0 - 40)) / st
    cj = (rx - (FX0 - 40)) / st
    ddx = nd.map_coordinates(dxg, [ci.ravel(), cj.ravel()], order=1).reshape(rx.shape)
    ddy = nd.map_coordinates(dyg, [ci.ravel(), cj.ravel()], order=1).reshape(rx.shape)
    return rx + ddx, ry + ddy


def log(*a):
    print(*a, flush=True)


def sample():
    # ---- elevation: terrarium mosaic sampled through the inverse homography -----
    log("dem", W, H)
    TY0, TY1, TS = 2, 26, 256
    dem = np.zeros(((TY1 - TY0) * TS, 32 * TS), np.float32)
    for x in range(32):
        for y in range(TY0, TY1):
            a = np.asarray(Image.open(f"{TILES}/{x}_{y}.png").convert("RGB"), np.float32)
            dem[(y - TY0) * TS:(y - TY0 + 1) * TS, x * TS:(x + 1) * TS] = a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768
    dem = nd.gaussian_filter(dem, 0.9)

    jj, ii = np.meshgrid(np.arange(W, dtype=np.float32), np.arange(H, dtype=np.float32))
    rx = FX0 + (jj + 0.5) / S
    ry = FY0 + (ii + 0.5) / S
    del jj, ii
    rx, ry = unwarp(rx, ry)
    w = HI[2, 0] * rx + HI[2, 1] * ry + HI[2, 2]
    lon = (HI[0, 0] * rx + HI[0, 1] * ry + HI[0, 2]) / w
    mdeg = (HI[1, 0] * rx + HI[1, 1] * ry + HI[1, 2]) / w
    del rx, ry, w
    gx = ((lon + 180) % 360) / 360 * 32 * TS
    gy = (1 - np.radians(mdeg) / np.pi) / 2 * 32 * TS - TY0 * TS
    elev = nd.map_coordinates(dem, [gy.ravel(), gx.ravel()], order=1, mode="nearest").reshape(H, W)
    del dem, gx, gy, mdeg

    # ---- land and lakes from the vectors, drawn 2x for clean coasts -------------
    log("mask")
    SS = 2


    def draw_rings(rings, img):
        d = ImageDraw.Draw(img)
        for raw, fill in rings:
            un, off = [], 0.0
            for i, (lo, la) in enumerate(raw):
                if i and lo + off - un[-1][0] > 180: off -= 360
                elif i and lo + off - un[-1][0] < -180: off += 360
                un.append((lo + off, la))
            if len(un) < 3:
                continue
            a = np.array(un)
            for shift in (-360, 0, 360):
                lo = a[:, 0] + shift
                # whole copies only, and nothing near the poles: far from the
                # frame the projective camera wraps around
                if lo.min() < -200 or lo.max() > 200 or a[:, 1].min() < -70:
                    continue
                x, y = to_out(lo, a[:, 1])
                if x.max() < -50 or x.min() > W + 50 or y.max() < -50 or y.min() > H + 50:
                    continue
                d.polygon(list(zip(x * SS, y * SS)), fill=fill)


    t = json.load(open(f"{VEC}/land-50m.json", encoding="utf-8"))
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


    rings = []
    for g in t["objects"]["land"]["geometries"]:
        polys = g["arcs"] if g["type"] == "MultiPolygon" else [g["arcs"]]
        for poly in polys:
            for k, r in enumerate(poly):
                rings.append((ring(r), 255 if k == 0 else 0))
    lk = json.load(open(f"{VEC}/lakes.geojson", encoding="utf-8"))
    for f in lk["features"]:
        if f["properties"].get("scalerank", 9) > 1:  # only the great lakes
            continue
        g = f["geometry"]
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        for poly in polys:
            rings.append((poly[0], 0))

    mimg = Image.new("L", (W * SS, H * SS), 0)
    draw_rings(rings, mimg)
    land = np.asarray(mimg.resize((W, H), Image.BOX), np.float32) / 255
    del mimg
    return elev, land


# set BAKE_CACHE to a .npz path to reuse the sampled elevation and mask
CACHE = os.environ.get("BAKE_CACHE")
if CACHE and os.path.exists(CACHE):
    _c = np.load(CACHE)
    elev, land = _c["elev"], _c["land"]
else:
    elev, land = sample()
    if CACHE:
        np.savez(CACHE, elev=elev, land=land)

# ---- the height field --------------------------------------------------------
log("height")
px = 1.0 / S  # one output pixel in reference pixels
e = np.clip(elev, 0, 7000)
# log elevation: lowlands keep texture, ranges do not swamp the rest.
# Smoothed well past the data's own detail: the reference is a soft cast,
# broad forms and gentle ridges, no fine grain.
r = np.log1p(e / 220.0) / np.log1p(7000 / 220.0)
r = nd.gaussian_filter(r, 0.9 * S)
# contour terraces, the layered plaster look: flat treads, soft risers
L = 10.0
f = r * L
k = np.floor(f)
fr = f - k
ter = (k + np.clip((fr - 0.82) / 0.18, 0, 1)) / L
ter = nd.gaussian_filter(ter, 0.55 * S)
# fill the small lakes the coastline data carves out (Finland, Canada):
# the reference keeps only the great ones
water = land < 0.95
lab, n = nd.label(water)
size = nd.sum(water, lab, np.arange(1, n + 1))
small = np.isin(lab, np.nonzero(size < 700 * S * S)[0] + 1)
land = np.where(small, 1.0, land).astype(np.float32)
del water, lab, small
landc = nd.gaussian_filter(land, 0.4 * S)
slab = 5.5  # the raised continent edge, in reference pixels
Z = landc * (slab + ter * 9.0 + nd.gaussian_filter(e / 1000.0, 1.3 * S) ** 0.75 * 2.4)
Z = Z.astype(np.float32)
del e, f, k, fr

# ---- lighting -----------------------------------------------------------------
log("light")
gyz, gxz = np.gradient(Z, px)  # slope per reference pixel
nx, ny, nz = -gxz, -gyz, np.ones_like(Z)
nl = np.sqrt(nx * nx + ny * ny + 1)
nx /= nl; ny /= nl; nz /= nl
del gxz, gyz, nl

EL = 32
AZ = -118  # screen angle of the light: up and to the left
shade = np.zeros_like(Z)
for da, wgt in ((-22, 0.25), (0, 0.5), (22, 0.25)):  # a broad soft source
    a = np.radians(AZ + da)
    el = np.radians(EL)
    lx, ly, lz = np.cos(el) * np.cos(a), np.cos(el) * np.sin(a), np.sin(el)
    shade += wgt * np.clip(nx * lx + ny * ly + nz * lz, 0, 1)
flat = np.sin(np.radians(EL))
sky = 0.5 + 0.5 * nz  # sky fill: steep faces see less of it
del nx, ny, nz

# cast shadows: march toward the light; anything higher than the light ray
# between here and the source shades this cell
log("shadow")
cast = np.zeros_like(Z)
a = np.radians(AZ)
dx, dy = np.cos(a), np.sin(a)
tanl = np.tan(np.radians(26))
for step in range(1, 26):
    d = step * 1.2 * S  # output pixels
    ox, oy = int(round(dx * d)), int(round(dy * d))
    src = np.roll(np.roll(Z, -oy, 0), -ox, 1)  # the cell d pixels toward the light
    np.maximum(cast, src - Z - d / S * tanl, out=cast)
cast = np.clip(cast / 2.5, 0, 1)
cast = nd.gaussian_filter(cast, 1.6 * S)

# ambient occlusion from the blurred height
ao = 0
for rr, wgt in ((3, 0.35), (8, 0.4), (26, 0.25)):
    ao = ao + wgt * np.clip(nd.gaussian_filter(Z, rr * S) - Z, 0, None)
ao = np.clip(ao / 1.6, 0, 1)

# ---- the tilt: the south faces of the slab show as a thin wall ---------------
wall_h = 3.2 * S
lm = (landc > 0.5).astype(np.float32)
down = nd.shift(lm, (wall_h, 0), order=1, mode="constant")
wall = np.clip(down - lm, 0, 1)
wall = nd.gaussian_filter(wall, 0.35 * S)
wallgrad = nd.gaussian_filter(lm, 1.2 * S)  # lighter just under the rim

# ---- colour ---------------------------------------------------------------------
log("colour")
lit = shade / flat  # 1 on flat ground
c_land_hi = np.array([250, 252, 253], np.float32)
c_land_lo = np.array([118, 133, 152], np.float32)
c_sea = np.array([211, 221, 233], np.float32)
c_wall = np.array([170, 182, 197], np.float32)

tone = 0.81 + 0.36 * np.tanh((lit - 1) * 1.7) + 0.06 * (sky - 1)
tone = tone - 0.22 * ao - 0.32 * cast
tone = np.clip(tone, 0, 1)
landcol = c_land_lo + (c_land_hi - c_land_lo) * tone[..., None]

# sea: flat and pale; the slab casts a soft shadow onto it toward the lower right
off = int(round(3.5 * S))
slabshadow = nd.gaussian_filter(np.roll(np.roll(lm, off, 0), int(round(1.5 * S)), 1), 2.6 * S)
near = nd.gaussian_filter(lm, 14 * S)
seat = 1 - 0.2 * slabshadow - 0.04 * near
seacol = c_sea * seat[..., None]

img = seacol * (1 - landc[..., None]) + landcol * landc[..., None]
wc = c_wall * (0.92 + 0.12 * wallgrad[..., None])
img = img * (1 - wall[..., None]) + wc * wall[..., None]
img = np.clip(img, 0, 255).astype(np.uint8)
Image.fromarray(img).save(OUT, quality=88, method=6)
log("saved", OUT, img.shape)

# ---- where the ports land, in map-frame (reference) pixels -------------------
if len(sys.argv) > 5:
    ports = json.load(open(sys.argv[5], encoding="utf-8"))
    res = {}
    for name, (lo, la) in ports.items():
        q = fwd(np.array([lo]), np.array([la]))[0]
        res[name] = [round(q[0] - FX0, 1), round(q[1] - FY0, 1)]
    print(json.dumps(res))
