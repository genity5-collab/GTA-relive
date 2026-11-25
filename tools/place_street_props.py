#!/usr/bin/env python3
"""Place street furniture and parked cars along the traced roads.
Output assets/street.bin: float32 records [mapx, mapy, rot, type] (type indexes STREET_TYPES in sa.js).
Rules: props sit on the sidewalk strip, never inside a building footprint, never on another road's asphalt."""
import numpy as np, json
from scipy.spatial import cKDTree
rng = np.random.default_rng(7)
roads = json.load(open('assets/roads.json'))
B = np.fromfile('assets/buildings.bin', dtype=np.float32).reshape(-1, 7)
HW = {0: 4.5, 1: 7, 2: 13}; U = 6.0   # world units per map unit
# dense centreline samples with heading and class
pts, hdg, cls = [], [], []
for r in roads:
    p = np.array(r['p']).reshape(-1, 2)
    for a, b in zip(p[:-1], p[1:]):
        d = np.hypot(*(b - a)); n = max(1, int(d / 0.15))
        for t in np.linspace(0, 1, n, endpoint=False): pts.append(a + (b - a) * t); hdg.append(np.arctan2(b[1] - a[1], b[0] - a[0])); cls.append(r['c'])
pts = np.array(pts); hdg = np.array(hdg); cls = np.array(cls); tree = cKDTree(pts)
btree = cKDTree(B[:, :2]); bmax = np.hypot(B[:, 2], B[:, 3]).max() / 2 / U

def in_building(mx, my):
    for i in btree.query_ball_point([mx, my], bmax + 0.1):
        cx, cy, w, d, h, rot, k = B[i]
        c, s = np.cos(rot), np.sin(rot); dx, dz = (mx - cx) * U, -(my - cy) * U       # map y is flipped to world z
        lx, lz = dx * c - dz * s, dx * s + dz * c
        if abs(lx) < w / 2 + 1.0 and abs(lz) < d / 2 + 1.0: return True
    return False

TYPES = ['poste_luz', 'hidrante', 'banco_praca', 'lixeira', 'placa_pare', 'ponto_onibus', 'carro', 'taxi', 'caminhao', 'onibus']
out = []; stats = {t: 0 for t in TYPES}
# walk each road, drop props at intervals
for r in roads:
    p = np.array(r['p']).reshape(-1, 2); c = r['c']
    if c == 2: continue                                                              # freeways: no sidewalk furniture
    acc = rng.uniform(0, 30)
    for a, b in zip(p[:-1], p[1:]):
        seg = np.hypot(*(b - a)) * U
        if seg < 0.5: continue
        ang = np.arctan2(b[1] - a[1], b[0] - a[0]); tx, ty = np.cos(ang), np.sin(ang); nx, ny = -ty, tx
        pos = acc
        while pos < seg:
            t = pos / seg; cx, cy = a + (b - a) * t
            roll = rng.random(); side = rng.choice([-1, 1])
            if c == 0:   # street with sidewalks
                if roll < 0.55: typ = 'poste_luz'
                elif roll < 0.68: typ = 'hidrante'
                elif roll < 0.78: typ = 'banco_praca'
                elif roll < 0.88: typ = 'lixeira'
                elif roll < 0.93: typ = 'ponto_onibus'
                else: typ = 'placa_pare'
                off = (HW[0] + 1.3) * side; step = rng.uniform(26, 48)
            else:        # main road: lamps on the verge plus parked and moving traffic
                if roll < 0.5: typ = 'poste_luz'
                elif roll < 0.8: typ = rng.choice(['carro', 'carro', 'taxi', 'caminhao', 'onibus'])
                else: typ = 'hidrante'
                off = (HW[1] + 1.5) * side if typ in ('poste_luz', 'hidrante') else rng.choice([-1, 1]) * rng.uniform(2.2, 4.2)
                step = rng.uniform(30, 60)
            mx, my = cx + nx * off / U * 1.0, cy + ny * off / U * 1.0
            # reject if a building is here, or if it would sit on a different road's asphalt
            ok = not in_building(mx, my)
            if ok and typ not in ('carro', 'taxi', 'caminhao', 'onibus'):
                dd, kk = tree.query([mx, my])
                if dd * U < HW[int(cls[kk])] + 0.4 and abs(off) > 0: ok = False if kk is not None and np.hypot(*(pts[kk] - np.array([cx, cy]))) * U > 2 else ok
            if ok:
                rot = -ang + (np.pi / 2 if typ in ('banco_praca', 'placa_pare') and side > 0 else (-np.pi / 2 if typ in ('banco_praca', 'placa_pare') else 0))
                if typ in ('carro', 'taxi', 'caminhao', 'onibus'): rot = -ang + (0 if off > 0 else np.pi) + np.pi
                out.append((mx, my, rot, TYPES.index(typ))); stats[typ] += 1
            pos += step
        acc = pos - seg
A = np.array(out, dtype=np.float32); A.tofile('assets/street.bin')
json.dump(TYPES, open('assets/street_types.json', 'w'))
print(len(A), 'props', stats, '|', A.nbytes // 1024, 'KB')
