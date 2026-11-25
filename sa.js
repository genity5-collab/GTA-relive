import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const V = '1795616865';
const S = 6, HALFW = 3000;
const mx2x = mx => mx * S - HALFW, my2z = my => HALFW - my * S;

// ================= QUALITY (Lite by default, auto-downgrades if FPS drops) =================
const TIERS = {
  lite:   { name: 'Lite',   dpr: 1,    seg: 192, trees: 0.35, bldg: 0.6, birds: 4,  drawDist: 1500, shadows: false },
  medium: { name: 'Medium', dpr: 1,    seg: 256, trees: 0.7,  bldg: 0.85, birds: 8, drawDist: 2300, shadows: false },
  high:   { name: 'High',   dpr: Math.min(devicePixelRatio, 1.5), seg: 320, trees: 1, bldg: 1, birds: 12, drawDist: 3200, shadows: true },
};
let tierKey = localStorage.getItem('gtar_tier') || 'lite';
if (!TIERS[tierKey]) tierKey = 'lite';
let Q = TIERS[tierKey];

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'low-power', stencil: false });
renderer.setPixelRatio(Q.dpr);
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.shadowMap.enabled = false;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 3, 22000);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI / 2 - 0.04; controls.minDistance = 25; controls.maxDistance = 8500;

// ================= SKY / LIGHT =================
const skies = {
  day:    { top: 0x3f86d8, hor: 0xcfe3f5, fog: 0xc4d9ec, sun: 0xfff1d6, si: 2.6, hemi: 0.75, sea: 0x1d6a9c },
  sunset: { top: 0x37508f, hor: 0xffb27a, fog: 0xe0a078, sun: 0xff9a5a, si: 2.0, hemi: 0.5, sea: 0x6a5a78 },
  night:  { top: 0x040818, hor: 0x16204a, fog: 0x0b1432, sun: 0x8aa0ff, si: 0.45, hemi: 0.22, sea: 0x0a1c38 },
};
let mode = 'day';
const sun = new THREE.DirectionalLight(0xffffff, 2.6); scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x5a5238, 0.75); scene.add(hemi);
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { top: { value: new THREE.Color() }, hor: { value: new THREE.Color() } },
  vertexShader: 'varying vec3 p; void main(){ p = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: 'uniform vec3 top; uniform vec3 hor; varying vec3 p; void main(){ float h = clamp(normalize(p).y*1.6+0.08,0.0,1.0); gl_FragColor = vec4(mix(hor,top,pow(h,0.65)),1.0); }',
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(18000, 16, 10), skyMat); scene.add(sky);
const seaMat = new THREE.MeshStandardMaterial({ color: 0x1d6a9c, roughness: 0.35, metalness: 0.1 });
function applyTime(m) {
  mode = m; const c = skies[m];
  skyMat.uniforms.top.value.set(c.top); skyMat.uniforms.hor.value.set(c.hor);
  scene.fog = new THREE.Fog(c.fog, Q.drawDist * 1.2, Q.drawDist * 3.2);
  sun.color.set(c.sun); sun.intensity = c.si; hemi.intensity = c.hemi; seaMat.color.set(c.sea);
  const a = m === 'sunset' ? 0.22 : m === 'night' ? 0.7 : 0.95;
  sun.position.set(Math.cos(a) * 7000, Math.sin(a) * 7000, 3200);
  if (window.__bMat) window.__bMat.emissiveIntensity = m === 'night' ? 1 : m === 'sunset' ? 0.25 : 0;
  renderInfo();
}

// ================= DATA / TERRAIN =================
const loadTex = u => new Promise((res, rej) => new THREE.TextureLoader().load(u, res, undefined, rej));
const loadImg = u => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = u; });
const loadJSON = u => fetch(u).then(r => r.json());
const loadBin = k => fetch('assets/' + k + '.bin?v=' + V).then(r => r.arrayBuffer()).then(b => new Float32Array(b));
let heightData, HN = 512, terrain;
const MAXH = 420;
function hAt(wx, wz) {
  const u = (wx + HALFW) / (2 * HALFW), v = (wz + HALFW) / (2 * HALFW);
  if (u < 0 || u > 1 || v < 0 || v > 1) return 0;
  const x = u * (HN - 1), y = v * (HN - 1), x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const g = (i, j) => heightData[Math.min(HN - 1, j) * HN + Math.min(HN - 1, i)];
  return ((g(x0, y0) * (1 - fx) + g(x0 + 1, y0) * fx) * (1 - fy) + (g(x0, y0 + 1) * (1 - fx) + g(x0 + 1, y0 + 1) * fx) * fy) * MAXH;
}

// ================= CHUNKED INSTANCING (only near chunks are drawn) =================
const CH = 12, CS = (HALFW * 2) / CH;           // 12x12 chunks of 500 world units
const chunkOf = (wx, wz) => [Math.min(CH - 1, Math.max(0, Math.floor((wx + HALFW) / CS))), Math.min(CH - 1, Math.max(0, Math.floor((wz + HALFW) / CS)))];
const chunks = [];                               // {cx, cz, center, groups:[mesh...]}
const world = new THREE.Group(); scene.add(world);

function merge(parts) {
  const pos = [], nor = [], colr = [], idx = []; let off = 0;
  parts.forEach(([g, mat, c]) => {
    const gg = g.clone().applyMatrix4(mat); const p = gg.attributes.position, n = gg.attributes.normal; const cc = new THREE.Color(c);
    for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); nor.push(n.getX(i), n.getY(i), n.getZ(i)); const shade = 0.78 + 0.35 * Math.min(1, Math.max(0, p.getY(i) / 24)); colr.push(cc.r * shade, cc.g * shade, cc.b * shade); }
    if (gg.index) for (let i = 0; i < gg.index.count; i++) idx.push(gg.index.getX(i) + off); else for (let i = 0; i < p.count; i++) idx.push(i + off);
    off += p.count;
  });
  const o = new THREE.BufferGeometry();
  o.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); o.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); o.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3)); o.setIndex(idx); return o;
}
const M = (x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, rz)), new THREE.Vector3(sx, sy, sz));
// very low poly trees (about 20 to 50 triangles each) so 100k of them stay cheap
const speciesGeo = [
  merge([[new THREE.CylinderGeometry(0.6, 0.9, 7, 5), M(0, 3.5, 0), 0x5e4126], [new THREE.ConeGeometry(5.4, 11, 6), M(0, 11, 0), 0x1d5f35], [new THREE.ConeGeometry(4, 9, 6), M(0, 17, 0), 0x25703f]]),        // pine
  merge([[new THREE.CylinderGeometry(0.8, 1.2, 7, 5), M(0, 3.5, 0), 0x66482a], [new THREE.IcosahedronGeometry(6, 0), M(0, 11.5, 0, 1, 0.85, 1), 0x3e8a38], [new THREE.IcosahedronGeometry(4, 0), M(3.5, 9.5, 1.5), 0x4a9c42]]),   // broadleaf
  merge([[new THREE.CylinderGeometry(0.45, 0.8, 14, 5), M(0, 7, 0, 1, 1, 1, 0, 0.1), 0x8e7248], [new THREE.ConeGeometry(5.5, 3.2, 6), M(0.9, 14.5, 0), 0x3a9a55]]),                                                    // palm
  merge([[new THREE.CylinderGeometry(0.9, 1.1, 6, 5), M(0, 3, 0), 0x5f8f4f], [new THREE.CylinderGeometry(0.55, 0.6, 3, 5), M(1.8, 4.6, 0, 1, 1, 1, 0, -0.9), 0x5f8f4f]]),                                           // cactus
];
const treeMat = new THREE.MeshLambertMaterial({ vertexColors: true });
const unit = new THREE.BoxGeometry(1, 1, 1); unit.translate(0, 0.5, 0);
const houseRoof = new THREE.ConeGeometry(0.74, 0.5, 4); houseRoof.rotateY(Math.PI / 4); houseRoof.translate(0, 0.5 + 0.25, 0);

function windowTex(lit) {
  const c = document.createElement('canvas'); c.width = 64; c.height = 128; const x = c.getContext('2d');
  x.fillStyle = '#a9b3bd'; x.fillRect(0, 0, 64, 128);
  for (let r = 0; r < 16; r++) for (let k = 0; k < 5; k++) { x.fillStyle = lit ? (Math.random() < 0.5 ? '#ffe2a0' : '#26303c') : '#4d6781'; x.fillRect(5 + k * 12, 3 + r * 8, 8, 5); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 2; return t;
}
const bMat = new THREE.MeshLambertMaterial({ map: windowTex(false), emissive: 0xffd890, emissiveMap: windowTex(true), emissiveIntensity: 0 });
window.__bMat = bMat;
bMat.onBeforeCompile = sh => {
  sh.vertexShader = sh.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>
    #ifdef USE_INSTANCING
      vec3 isc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
      vec3 nn = abs(normal);
      float horiz = nn.x > 0.5 ? isc.z : isc.x;
      vMapUv = uv * (nn.y > 0.5 ? vec2(1.0) : vec2(max(1.0, floor(horiz / 5.0)) * 0.4, max(1.0, floor(isc.y / 4.0)) / 16.0));
      #ifdef USE_EMISSIVEMAP
        vEmissiveMapUv = vMapUv;
      #endif
    #endif`);
};
const roofMat = new THREE.MeshLambertMaterial({ color: 0x5b646d });
const hRoofMat = new THREE.MeshLambertMaterial({ color: 0x9c4a3a });
const palette = [[0xc4ccd4, 0xa9b6c5, 0xdbe1e7, 0x93a5b8], [0xd8cab3, 0xc6b9a1, 0xe2d7c4, 0xb9aa91], [0xf0e2c9, 0xe6cabf, 0xd3e0c8, 0xe1d6ee, 0xf3d9a8], [0x9ba4ac, 0xaeb4ba, 0x8c9298]];

function buildChunks(TR, BD, brAnchors) {
  const tbuck = new Map(), bbuck = new Map();
  const push = (m, k, v) => { let a = m.get(k); if (!a) m.set(k, a = []); a.push(v); };
  for (let i = 0; i < TR.length; i += 4) { if (Math.random() > Q.trees) continue; const [a, b] = chunkOf(mx2x(TR[i]), my2z(TR[i + 1])); push(tbuck, a + ',' + b, i); }
  for (let i = 0; i < BD.length; i += 7) { if (BD[i + 6] >= 2 && Math.random() > Q.bldg) continue; const [a, b] = chunkOf(mx2x(BD[i]), my2z(BD[i + 1])); push(bbuck, a + ',' + b, i); }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), pv = new THREE.Vector3(), sv = new THREE.Vector3(), col = new THREE.Color();
  const keys = new Set([...tbuck.keys(), ...bbuck.keys()]);
  keys.forEach(key => {
    const [a, b] = key.split(',').map(Number); const ch = { cx: a, cz: b, center: new THREE.Vector3(-HALFW + (a + .5) * CS, 0, -HALFW + (b + .5) * CS), meshes: [] };
    // trees
    const tl = tbuck.get(key) || []; const byT = [[], [], [], []]; tl.forEach(o => byT[TR[o + 3]].push(o));
    byT.forEach((list, t) => {
      if (!list.length) return; const im = new THREE.InstancedMesh(speciesGeo[t], treeMat, list.length);
      list.forEach((o, k) => { const wx = mx2x(TR[o]), wz = my2z(TR[o + 1]), sc = TR[o + 2] * 1.1; q.setFromAxisAngle(up, (o * 12.9898 % 6.28)); pv.set(wx, Math.max(hAt(wx, wz), 0) - 0.4, wz); sv.set(sc, sc * (0.9 + (o % 7) * 0.04), sc); m4.compose(pv, q, sv); im.setMatrixAt(k, m4); });
      im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.userData.tree = true; ch.meshes.push(im);
    });
    // buildings
    const bl = bbuck.get(key) || []; const byK = [[], [], [], []]; bl.forEach(o => byK[BD[o + 6]].push(o));
    byK.forEach((list, kd) => {
      if (!list.length) return; const im = new THREE.InstancedMesh(unit, bMat, list.length); const pal = palette[kd];
      const roofs = kd === 2 ? new THREE.InstancedMesh(houseRoof, hRoofMat, list.length) : null; const caps = kd <= 1 ? new THREE.InstancedMesh(unit, roofMat, list.length) : null;
      list.forEach((o, k) => {
        const wx = mx2x(BD[o]), wz = my2z(BD[o + 1]), w = BD[o + 2], d = BD[o + 3], h = BD[o + 4], rot = BD[o + 5], y = Math.max(hAt(wx, wz), 0);
        q.setFromAxisAngle(up, rot); pv.set(wx, y - 1, wz); sv.set(w, h + 1, d); m4.compose(pv, q, sv); im.setMatrixAt(k, m4); im.setColorAt(k, col.setHex(pal[(o * 7) % pal.length]));
        if (roofs) { sv.set(w * 1.1, h * 0.8 + 3, d * 1.1); pv.set(wx, y + h - 0.5, wz); m4.compose(pv, q, sv); roofs.setMatrixAt(k, m4); }
        if (caps) { sv.set(w * 0.5, 2.5 + (o % 3), d * 0.5); pv.set(wx, y + h, wz); m4.compose(pv, q, sv); caps.setMatrixAt(k, m4); }
      });
      [im, roofs, caps].forEach(x => { if (x) { x.instanceMatrix.needsUpdate = true; x.computeBoundingSphere(); ch.meshes.push(x); } });
    });
    ch.meshes.forEach(m => { m.visible = false; m.frustumCulled = true; world.add(m); }); chunks.push(ch);
  });
}
function updateChunks() {
  const cp = camera.position, lim = Q.drawDist + CS * 0.75, lim2 = lim * lim;
  for (const ch of chunks) {
    const dx = ch.center.x - cp.x, dz = ch.center.z - cp.z, vis = dx * dx + dz * dz < lim2;
    const near = dx * dx + dz * dz < (lim * 0.62) ** 2;
    for (const m of ch.meshes) m.visible = m.userData.tree ? near : vis;
  }
}


// ================= ROADS: terrain-following ribbons, merged per chunk (1 draw call per chunk) =================
// widths in world units (1 map unit = 6 world units). street ~9, main ~14, freeway ~26.
const ROAD_W = [9, 14, 26];
const roadMat = new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
function buildRoads(roads) {
  const buckets = new Map();
  const put = (key, arr) => { let b = buckets.get(key); if (!b) buckets.set(key, b = { pos: [], col: [], idx: [] }); return b; };
  const C_ASPH = [[0.20, 0.20, 0.21], [0.17, 0.17, 0.18], [0.14, 0.14, 0.15]];
  const C_WALK = [0.62, 0.61, 0.58], C_LINE = [0.92, 0.92, 0.88], C_YEL = [0.9, 0.72, 0.15], C_RAIL = [0.55, 0.56, 0.58];
  // smooth a polyline with Catmull-Rom style subdivision so curves aren't jagged, then resample ~every 14 world units
  function resample(pts) {
    const out = []; const n = pts.length;
    for (let i = 0; i < n - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n - 1, i + 2)];
      const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]); const steps = Math.max(1, Math.round(len / 14));
      for (let s = 0; s < steps; s++) {
        const t = s / steps, t2 = t * t, t3 = t2 * t;
        out.push([0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
                  0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)]);
      }
    }
    out.push(pts[n - 1]); return out;
  }
  function strip(b, P, off0, off1, lift, c) {      // a ribbon between lateral offsets off0..off1 along the path
    const base = b.pos.length / 3;
    for (let i = 0; i < P.length; i++) {
      const a = P[Math.max(0, i - 1)], d = P[Math.min(P.length - 1, i + 1)];
      let tx = d[0] - a[0], tz = d[1] - a[1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l; const nx = -tz, nz = tx;
      for (const o of [off0, off1]) { const x = P[i][0] + nx * o, z = P[i][1] + nz * o; b.pos.push(x, Math.max(hAt(x, z), 0) + lift + P[i][2], z); b.col.push(c[0], c[1], c[2]); }
    }
    for (let i = 0; i < P.length - 1; i++) { const k = base + i * 2; b.idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  }
  let tris = 0;
  roads.forEach(r => {
    const raw = []; for (let i = 0; i < r.p.length; i += 2) raw.push([mx2x(r.p[i]), my2z(r.p[i + 1])]);
    if (raw.length < 2) return;
    const P = resample(raw); const cls = r.c, W = ROAD_W[cls] / 2;
    // freeway deck: lift over dips so it reads as an embankment/bridge (height = how far the road sits below its smoothed neighbours)
    for (const p of P) p[2] = 0;
    if (cls === 2) for (let i = 0; i < P.length; i++) { let m = -1e9; for (let j = Math.max(0, i - 4); j <= Math.min(P.length - 1, i + 4); j++) m = Math.max(m, hAt(P[j][0], P[j][1])); P[i][2] = Math.max(0, Math.min(14, m - hAt(P[i][0], P[i][1]))) ; }
    // split into per-chunk runs so culling works
    let run = [], runKey = null;
    const flush = () => { if (run.length > 1) { const b = put(runKey); const lift = 0.35;
        strip(b, run, -W, W, lift, C_ASPH[cls]);                               // asphalt
        strip(b, run, -W, -W + 0.7, lift + 0.12, C_LINE); strip(b, run, W - 0.7, W, lift + 0.12, C_LINE);   // edge lines
        if (cls >= 1) strip(b, run, -0.35, 0.35, lift + 0.14, cls === 2 ? C_LINE : C_YEL);                   // centre line (yellow on mains)
        if (cls === 0) { strip(b, run, -W - 2.2, -W, lift + 0.05, C_WALK); strip(b, run, W, W + 2.2, lift + 0.05, C_WALK); }   // sidewalks on streets
        if (cls === 2) { strip(b, run, -W - 0.9, -W, lift + 0.5, C_RAIL); strip(b, run, W, W + 0.9, lift + 0.5, C_RAIL); }    // freeway barriers
        tris += run.length * 2 * (cls === 0 ? 4 : cls === 1 ? 4 : 5); }
      run = []; };
    P.forEach((pt, i) => { const [a, bq] = chunkOf(pt[0], pt[1]); const k = a + ',' + bq; if (runKey !== null && k !== runKey) { const last = run[run.length - 1]; run.push([pt[0], pt[1], pt[2] || 0]); flush(); run = [[last[0], last[1], last[2]]]; } runKey = k; run.push([pt[0], pt[1], pt[2] || 0]); });
    flush();
  });
  buckets.forEach((b, key) => {
    const [a, bq] = key.split(',').map(Number);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3)); g.setIndex(b.idx); g.computeVertexNormals(); g.computeBoundingSphere();
    const m = new THREE.Mesh(g, roadMat); m.visible = false; m.userData.road = true; world.add(m);
    let ch = chunks.find(c => c.cx === a && c.cz === bq);
    if (!ch) { ch = { cx: a, cz: bq, center: new THREE.Vector3(-HALFW + (a + .5) * CS, 0, -HALFW + (bq + .5) * CS), meshes: [] }; chunks.push(ch); }
    ch.meshes.push(m);
  });
  window.__roadStats = { chunks: buckets.size, approxTris: tris };
}

// ================= BIRDS (few, cheap, only update when near the camera) =================
let birds, flock = [], birdMatH = new THREE.Matrix4();
function buildBirds(anchors) {
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 1.2, -0.2, 0, -0.6, 0.2, 0, -0.6, 0, 0, 0.2, -2.6, 0.2, -0.2, 0, 0, -0.5, 0, 0, 0.2, 0, 0, -0.5, 2.6, 0.2, -0.2], 3));
  const mat = new THREE.MeshBasicMaterial({ color: 0xf4f4f4, side: THREE.DoubleSide }); const uTime = { value: 0 }; window.__uTime = uTime;
  mat.onBeforeCompile = sh => { sh.uniforms.uTime = uTime; sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace('#include <begin_vertex>', 'vec3 transformed = vec3(position); transformed.y += abs(position.x) * 0.5 * sin(uTime * 8.0 + float(gl_InstanceID) * 1.37);'); };
  const per = Q.birds, n = anchors.length / 3; birds = new THREE.InstancedMesh(g, mat, n * per); birds.frustumCulled = false; scene.add(birds);
  for (let f = 0; f < n; f++) { const cx = mx2x(anchors[f * 3]), cz = my2z(anchors[f * 3 + 1]); for (let b = 0; b < per; b++) flock.push({ cx, cz, r: 90 + Math.random() * 220, a: Math.random() * 6.28, sp: (0.2 + Math.random() * 0.3) * (Math.random() < .5 ? 1 : -1), y: 120 + Math.random() * 120, ph: Math.random() * 6 }); }
}
const q2 = new THREE.Quaternion(), up2 = new THREE.Vector3(0, 1, 0), pv2 = new THREE.Vector3(), sv2 = new THREE.Vector3(1.8, 1.8, 1.8);
let birdAcc = 0;
function updateBirds(t, dt) {
  if (!birds) return; window.__uTime.value = t; birdAcc += dt; if (birdAcc < 1 / 24) return; const step = birdAcc; birdAcc = 0;
  const cp = camera.position, lim = (Q.drawDist * 1.4) ** 2;
  for (let i = 0; i < flock.length; i++) {
    const b = flock[i]; b.a += b.sp * step * 0.55; const x = b.cx + Math.cos(b.a) * b.r, z = b.cz + Math.sin(b.a) * b.r;
    const dx = x - cp.x, dz = z - cp.z; if (dx * dx + dz * dz > lim) { birdMatH.makeScale(0, 0, 0); birds.setMatrixAt(i, birdMatH); continue; }
    q2.setFromAxisAngle(up2, -b.a + (b.sp > 0 ? 0 : Math.PI)); pv2.set(x, Math.max(hAt(x, z), 0) + b.y + Math.sin(t * .7 + b.ph) * 6, z); birdMatH.compose(pv2, q2, sv2); birds.setMatrixAt(i, birdMatH);
  }
  birds.instanceMatrix.needsUpdate = true;
}

// ================= LABELS =================
const tags = [], tagLayer = document.getElementById('tags');
function addTag(text, color, wx, wz, lift) { const el = document.createElement('div'); el.className = 'tag'; el.textContent = text; el.style.color = color; tagLayer.appendChild(el); tags.push({ el, p: new THREE.Vector3(wx, Math.max(hAt(wx, wz), 0) + lift, wz) }); }
const districts = [['Los Santos', 800, 255, 900], ['San Fierro', 165, 500, 900], ['Las Venturas', 835, 715, 900], ['Mount Chiliad', 395, 835, 800], ['Bone County', 300, 905, 1400], ['Red County', 790, 420, 1400], ['Flint County', 285, 305, 1400], ['Tierra Robada', 120, 740, 1400]];

// ================= MAIN =================
async function main() {
  const [aerial, detail, hImg, airports, buildings, homes, schools, TR, BD, BR, ROADS] = await Promise.all([
    loadTex('assets/sa_aerial_2k.jpg?v=' + V), loadTex('assets/detail.jpg?v=' + V), loadImg('assets/sa_height.png?v=' + V),
    loadJSON('assets/airports.json'), loadJSON('assets/buildings.json'), loadJSON('assets/homes.json'), loadJSON('assets/schools.json'),
    loadBin('trees'), loadBin('buildings'), loadBin('birds'), loadJSON('assets/roads.json?v=' + V),
  ]);
  aerial.colorSpace = THREE.SRGBColorSpace; aerial.anisotropy = 4; detail.wrapS = detail.wrapT = THREE.RepeatWrapping; detail.colorSpace = THREE.SRGBColorSpace;
  const c = document.createElement('canvas'); c.width = c.height = HN; const cx = c.getContext('2d'); cx.drawImage(hImg, 0, 0, HN, HN);
  const px = cx.getImageData(0, 0, HN, HN).data; heightData = new Float32Array(HN * HN); for (let i = 0; i < HN * HN; i++) heightData[i] = px[i * 4] / 255;

  // terrain: realistic colour grade + tiled detail texture multiplied in the shader (gives close-up grain without a huge texture)
  const geo = new THREE.PlaneGeometry(HALFW * 2, HALFW * 2, Q.seg, Q.seg); geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, hAt(p.getX(i), p.getZ(i)) - 2); geo.computeVertexNormals();
  const tm = new THREE.MeshLambertMaterial({ map: aerial });
  tm.onBeforeCompile = sh => {
    sh.uniforms.detailMap = { value: detail };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vWorldUv;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvWorldUv = position.xz * 0.045;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D detailMap; varying vec2 vWorldUv;').replace('#include <map_fragment>', `#include <map_fragment>
      vec3 dn = texture2D(detailMap, vWorldUv).rgb;
      vec3 dn2 = texture2D(detailMap, vWorldUv * 0.23).rgb;
      float lumv = dot(diffuseColor.rgb, vec3(0.299,0.587,0.114));
      diffuseColor.rgb = mix(vec3(lumv), diffuseColor.rgb, 0.82);                 // pull the cartoon saturation down
      diffuseColor.rgb *= vec3(1.02, 1.0, 0.94) * (0.7 + 0.6 * dn * dn2.r * 1.5);   // natural grain + warm sun grade`);
  };
  terrain = new THREE.Mesh(geo, tm); scene.add(terrain);
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000).rotateX(-Math.PI / 2), seaMat); sea.position.y = -1; scene.add(sea);

  // labels & pins (cheap): only real named POIs
  const legend = document.getElementById('legend'); legend.innerHTML = '<b>Regions</b> <small>(click to fly)</small>';
  districts.forEach(d => { const el = document.createElement('div'); el.textContent = d[0]; el.onclick = () => flyTo(mx2x(d[1]), my2z(d[2]), d[3]); legend.appendChild(el); addTag(d[0].toUpperCase(), '#ffe27a', mx2x(d[1]), my2z(d[2]), 240); });
  const pt = f => f.geometry.type === 'Point' ? f.geometry.coordinates : f.geometry.coordinates[0].reduce((a, q) => [a[0] + q[0] / f.geometry.coordinates[0].length, a[1] + q[1] / f.geometry.coordinates[0].length], [0, 0]);
  const seen = new Set();
  [[airports, '#8fd6ff'], [buildings, '#ffb0b0'], [schools, '#ffd2a0'], [homes, '#b6ffb0']].forEach(([data, tcol], gi) => data.forEach(f => {
    const [mx, my] = pt(f), name = f.properties.name || ''; const key = name + Math.round(mx / 20) + Math.round(my / 20); if (seen.has(key)) return; seen.add(key);
    if (name && name !== 'Safehouse') addTag(name, tcol, mx2x(mx), my2z(my), 70);
  }));

  buildChunks(TR, BD, BR); buildRoads(ROADS); buildBirds(BR);
  const stats = { chunks: chunks.length, trees: TR.length / 4, buildings: BD.length / 7 }; window.__stats = stats;
  document.getElementById('load').remove(); applyTime('day');
  camera.position.set(-1500, 2300, 3600); controls.target.set(0, 0, 0); presets['1'](); updateChunks(); frame();
}

// ================= CAMERA =================
let anim = null, autoRot = false, labelsOn = true, dirty = true;
function flyTo(tx, tz, dist, hh) { const ty = Math.max(hAt(tx, tz), 0); anim = { t: 0, fp: camera.position.clone(), ft: controls.target.clone(), tp: new THREE.Vector3(tx - dist * 0.25, ty + (hh ?? dist * 0.6), tz + dist * 0.85), tt: new THREE.Vector3(tx, ty, tz) }; autoRot = false; dirty = true; }
const presets = { '1': () => flyTo(0, 0, 6200, 4200), '2': () => flyTo(mx2x(800), my2z(255), 700), '3': () => flyTo(mx2x(165), my2z(500), 700), '4': () => flyTo(mx2x(835), my2z(715), 700) };
addEventListener('keydown', e => {
  const k = e.key.toLowerCase(); dirty = true;
  if (presets[k]) presets[k]();
  if (k === 't') applyTime({ day: 'sunset', sunset: 'night', night: 'day' }[mode]);
  if (k === 'r') autoRot = !autoRot;
  if (k === 'l') { labelsOn = !labelsOn; tagLayer.style.display = labelsOn ? '' : 'none'; }
  if (k === 'q') { const o = ['lite', 'medium', 'high']; localStorage.setItem('gtar_tier', o[(o.indexOf(tierKey) + 1) % 3]); location.reload(); }
});
controls.addEventListener('change', () => { dirty = true; });
const infoEl = document.getElementById('info');
const regionAt = (x, z) => { const mx = (x + HALFW) / S, my = (HALFW - z) / S; let best = null, bd = 1e9; for (const d of districts.slice(0, 3)) { const dd = Math.hypot(mx - d[1], my - d[2]); if (dd < bd) { bd = dd; best = d[0]; } } return bd < 130 ? best : (mx < 0 || mx > 1000 || my < 0 || my > 1000 ? 'Open sea' : 'Countryside'); };
let lastInfo = '';
function renderInfo() { const s = regionAt(controls.target.x, controls.target.z) + ' | ' + ({ day: 'Day', sunset: 'Sunset', night: 'Night' })[mode] + ' | ' + Q.name + ' (Q to change)' + (fpsShown ? ' | ' + fpsShown + ' fps' : ''); if (s !== lastInfo) { infoEl.textContent = s; lastInfo = s; } }

// ================= LOOP: adaptive quality, idle = no GPU work, hidden tab = paused =================
const v = new THREE.Vector3(), clock = new THREE.Clock(); let fpsShown = 0, frames = 0, fpsT = 0, slow = 0, lastDraw = 0, idleFrames = 0;
function frame() {
  requestAnimationFrame(frame);
  if (document.hidden) { clock.getDelta(); return; }
  const dt = Math.min(clock.getDelta(), 0.1);
  let moving = false;
  if (anim) { anim.t = Math.min(1, anim.t + dt * 0.55); const k = 1 - Math.pow(1 - anim.t, 3); camera.position.lerpVectors(anim.fp, anim.tp, k); controls.target.lerpVectors(anim.ft, anim.tt, k); if (anim.t >= 1) anim = null; moving = true; }
  if (autoRot) { const o = camera.position.clone().sub(controls.target); o.applyAxisAngle(new THREE.Vector3(0, 1, 0), dt * 0.1); camera.position.copy(controls.target).add(o); moving = true; }
  const upd = controls.update(); if (upd) moving = true;
  const hasBirds = birds && !!flock.length;
  // render only if something changed (or birds need to animate near the camera); otherwise sleep the GPU
  if (!(dirty || moving || hasBirds)) { idleFrames++; return; }
  const now = performance.now(); if (!moving && !dirty && now - lastDraw < 1000 / 24) return;      // idle + birds: 24 fps cap
  lastDraw = now; dirty = false;
  const gh = Math.max(hAt(camera.position.x, camera.position.z), 0) + 20; if (camera.position.y < gh) camera.position.y = gh;
  updateChunks(); updateBirds(now / 1000, dt);
  if (labelsOn) for (const t of tags) { v.copy(t.p).project(camera); const vis = v.z < 1 && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05 && camera.position.distanceTo(t.p) < 7500; if (vis !== t.on) { t.el.style.display = vis ? '' : 'none'; t.on = vis; } if (vis) t.el.style.transform = 'translate(' + ((v.x + 1) / 2 * innerWidth) + 'px,' + ((1 - v.y) / 2 * innerHeight) + 'px) translate(-50%,-100%)'; }
  renderer.render(scene, camera);
  frames++; fpsT += dt; if (fpsT >= 1) { fpsShown = Math.round(frames / fpsT); if (moving) { if (fpsShown < 24) slow++; else slow = Math.max(0, slow - 1); if (slow >= 3 && tierKey !== 'lite') { const o = ['lite', 'medium', 'high']; localStorage.setItem('gtar_tier', o[Math.max(0, o.indexOf(tierKey) - 1)]); location.reload(); } } frames = 0; fpsT = 0; renderInfo(); }
}
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); dirty = true; });
main().catch(e => { document.getElementById('load').innerHTML = 'Failed to load: ' + e.message; console.error(e); });
