#!/usr/bin/env python3
"""Pack CC0 city-kit GLBs (kayquer/kit-cidade-lowpoly) into one binary + JSON index.
Each model is merged into ONE mesh with the material colours baked into vertex colours,
so the game can draw thousands of them with a single InstancedMesh per model.
usage: pack_props.py <kit_dir> <out_prefix>"""
import struct, json, sys, glob, os
import numpy as np

def load(p):
    d = open(p, 'rb').read(); jl = struct.unpack('<I', d[12:16])[0]
    g = json.loads(d[20:20 + jl]); off = 20 + jl; bl = struct.unpack('<I', d[off:off + 4])[0]
    return g, d[off + 8:off + 8 + bl]

def acc(g, b, i):
    a = g['accessors'][i]; bv = g['bufferViews'][a['bufferView']]
    n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
    dt = {5126: np.float32, 5123: np.uint16, 5125: np.uint32, 5121: np.uint8}[a['componentType']]
    off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    arr = np.frombuffer(b, dtype=dt, count=a['count'] * n, offset=off)
    return arr.reshape(-1, n) if n > 1 else arr

def srgb(c): return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(np.maximum(c, 0), 1 / 2.4) - 0.055)

def convert(p):
    g, b = load(p); P, N, C, I = [], [], [], []; base = 0
    for m in g['meshes']:
        for pr in m['primitives']:
            pos = acc(g, b, pr['attributes']['POSITION']).astype(np.float32)
            nor = acc(g, b, pr['attributes']['NORMAL']).astype(np.float32)
            idx = acc(g, b, pr['indices']).astype(np.uint32)
            mat = g['materials'][pr['material']]['pbrMetallicRoughness'].get('baseColorFactor', [.8, .8, .8, 1])[:3]
            col = np.tile(np.clip(srgb(np.array(mat, np.float32)), 0, 1), (len(pos), 1))
            P.append(pos); N.append(nor); C.append(col); I.append(idx + base); base += len(pos)
    P = np.concatenate(P); N = np.concatenate(N); C = np.concatenate(C); I = np.concatenate(I)
    # model height / footprint for placement
    mn, mx = P.min(0), P.max(0)
    return P, N, C, I, mn, mx

if __name__ == '__main__':
    kit, out = sys.argv[1], sys.argv[2]
    blob = bytearray(); index = {}
    for p in sorted(glob.glob(kit + '/**/*.glb', recursive=True)):
        name = os.path.basename(p)[:-4]; P, N, C, I, mn, mx = convert(p)
        # quantise: positions int16 (1/1024 unit), normals int8, colours uint8 -> ~14 bytes per vertex
        q = lambda a, s, dt: np.round(a * s).astype(dt)
        rec = {'name': name, 'v': len(P), 'i': len(I), 'min': [round(float(x), 3) for x in mn], 'max': [round(float(x), 3) for x in mx], 'o': len(blob)}
        blob += q(P, 1024, np.int16).tobytes(); blob += q(N, 127, np.int8).tobytes() + b'\0' * ((-P.shape[0] * 3) % 4)
        blob += q(C, 255, np.uint8).tobytes() + b'\0' * ((-P.shape[0] * 3) % 4)
        blob += I.astype(np.uint16).tobytes() + b'\0' * ((-len(I) * 2) % 4)
        rec['bytes'] = len(blob) - rec['o']; index[name] = rec
    open(out + '.bin', 'wb').write(blob); json.dump(index, open(out + '.json', 'w'), separators=(',', ':'))
    print(len(index), 'models,', len(blob) // 1024, 'KB,', sum(r['i'] // 3 for r in index.values()), 'triangles total')
