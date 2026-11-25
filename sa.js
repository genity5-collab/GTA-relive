import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// World: the real San Andreas map image is 1000x1000 map units (SanMap coords, y up from bottom).
// We map it to a 6000 x 6000 world. world x = mx*6 - 3000 ; world z = 3000 - my*6.
const S = 6, HALFW = 3000;
const mx2x = mx => mx * S - HALFW;
const my2z = my => HALFW - my * S;

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 5, 40000);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI / 2 - 0.03;
controls.minDistance = 40;
controls.maxDistance = 9000;

// ---- sky / light ----
const skies = {
  day:    { bg: 0x9fd0ff, fog: 0xbfdcff, sun: 0xffffff, si: 2.2, hemi: 1.0, sea: 0x2b7fb8 },
  sunset: { bg: 0xff9a5a, fog: 0xf0a878, sun: 0xffb070, si: 1.9, hemi: 0.7, sea: 0x8a5a6a },
  night:  { bg: 0x070c24, fog: 0x0a1230, sun: 0x7a90ff, si: 0.6, hemi: 0.3, sea: 0x0b2244 },
};
let mode = 'day';
const sun = new THREE.DirectionalLight(0xffffff, 2.2);
scene.add(sun);
const hemi = new THREE.HemisphereLight(0xdfeeff, 0x4a4a3a, 1.0);
scene.add(hemi);
const seaMat = new THREE.MeshStandardMaterial({ color: 0x2b7fb8, roughness: 0.25, metalness: 0.25, transparent: true, opacity: 0.93 });
function applyTime(m) {
  mode = m; const c = skies[m];
  scene.background = new THREE.Color(c.bg);
  scene.fog = new THREE.Fog(c.fog, 6000, 26000);
  sun.color.set(c.sun); sun.intensity = c.si; hemi.intensity = c.hemi; seaMat.color.set(c.sea);
  const a = m === 'sunset' ? 0.3 : 1.0;
  sun.position.set(Math.cos(a) * 6000, Math.sin(a) * 6000, 2500);
  document.getElementById('info').dataset.mode = m;
  if (window.__bMat) { window.__bMat.map = window.__winTex[m === 'night' ? 1 : 0]; window.__bMat.emissive = new THREE.Color(m === 'night' ? 0x332a10 : 0x000000); window.__bMat.needsUpdate = true; }
  renderInfo();
}

// ---- load assets ----
const loader = new THREE.TextureLoader();
const loadTex = u => new Promise((res, rej) => loader.load(u, res, undefined, rej));
const loadImg = u => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = u; });
const loadJSON = u => fetch(u).then(r => r.json());

let heightData, HN = 512, terrainMesh, exaggeration = 1.0;
const MAXH = 520; // tallest terrain in world units

function hAt(wx, wz) {
  const u = (wx + HALFW) / (2 * HALFW), v = (wz + HALFW) / (2 * HALFW);
  if (u < 0 || u > 1 || v < 0 || v > 1) return 0;
  const x = u * (HN - 1), y = v * (HN - 1), x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const g = (i, j) => heightData[Math.min(HN - 1, j) * HN + Math.min(HN - 1, i)];
  return ((g(x0, y0) * (1 - fx) + g(x0 + 1, y0) * fx) * (1 - fy) + (g(x0, y0 + 1) * (1 - fx) + g(x0 + 1, y0 + 1) * fx) * fy) * MAXH * exaggeration;
}

const tags = [];       // {el, pos}
const tagLayer = document.getElementById('tags');
function addTag(text, color, wx, wz, lift = 40) {
  const el = document.createElement('div'); el.className = 'tag'; el.textContent = text; el.style.color = color;
  tagLayer.appendChild(el); tags.push({ el, p: new THREE.Vector3(wx, Math.max(hAt(wx, wz), 0) + lift, wz) });
}

function buildMarker(color, wx, wz, kind) {
  const y = Math.max(hAt(wx, wz), 0);
  const g = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 60, 8), new THREE.MeshBasicMaterial({ color }));
  pole.position.y = 30; g.add(pole);
  const head = new THREE.Mesh(kind === 'airport' ? new THREE.ConeGeometry(14, 22, 4) : new THREE.SphereGeometry(10, 12, 10), new THREE.MeshBasicMaterial({ color }));
  head.position.y = 68; g.add(head);
  g.position.set(wx, y, wz); scene.add(g); return g;
}

const districts = [
  ['Los Santos',    860, 255, 900],
  ['San Fierro',    175, 455, 900],
  ['Las Venturas',  770, 735, 900],
  ['Mount Chiliad', 395, 835, 800],
  ['Bone County',   300, 905, 1400],
  ['Red County',    790, 420, 1400],
  ['Flint County',  285, 305, 1400],
  ['Tierra Robada', 120, 740, 1400],
];

async function main() {
  const [aerial, hImg, wImg, airports, buildings, homes, schools] = await Promise.all([
    loadTex('assets/sa_aerial.jpg'), loadImg('assets/sa_height.png'), loadImg('assets/sa_water.png'),
    loadJSON('assets/airports.json'), loadJSON('assets/buildings.json'), loadJSON('assets/homes.json'), loadJSON('assets/schools.json'),
  ]);
  aerial.colorSpace = THREE.SRGBColorSpace; aerial.anisotropy = renderer.capabilities.getMaxAnisotropy();

  // height array
  const c = document.createElement('canvas'); c.width = c.height = HN; const cx = c.getContext('2d');
  cx.drawImage(hImg, 0, 0, HN, HN);
  const px = cx.getImageData(0, 0, HN, HN).data; heightData = new Float32Array(HN * HN);
  for (let i = 0; i < HN * HN; i++) heightData[i] = px[i * 4] / 255;

  // terrain mesh
  const SEG = 384;
  const geo = new THREE.PlaneGeometry(HALFW * 2, HALFW * 2, SEG, SEG); geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, hAt(p.getX(i), p.getZ(i)) - 2);
  geo.computeVertexNormals();
  terrainMesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: aerial, roughness: 1, metalness: 0 }));
  scene.add(terrainMesh);

  // sea
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000).rotateX(-Math.PI / 2), seaMat);
  sea.position.y = -1; scene.add(sea);

  // POIs
  const legend = document.getElementById('legend');
  legend.innerHTML = '<b>Regions</b> <small>(click to fly)</small>';
  districts.forEach(d => {
    const el = document.createElement('div'); el.textContent = d[0];
    el.onclick = () => flyTo(mx2x(d[1]), my2z(d[2]), d[3]);
    legend.appendChild(el);
    addTag(d[0].toUpperCase(), '#ffd54a', mx2x(d[1]), my2z(d[2]), 260);
  });
  const pt = f => f.geometry.type === 'Point' ? f.geometry.coordinates : f.geometry.coordinates[0].reduce((a, q) => [a[0] + q[0] / f.geometry.coordinates[0].length, a[1] + q[1] / f.geometry.coordinates[0].length], [0, 0]);
  const groups = { airports: [], buildings: [], homes: [], schools: [] };
  const seen = new Set();
  [['airports', airports, 0x6cc4ff, 'airport', '#8fd6ff'], ['buildings', buildings, 0xff6b6b, 'b', '#ffb0b0'], ['homes', homes, 0x7CFC8a, 'h', '#b6ffb0'], ['schools', schools, 0xffa94d, 's', '#ffd2a0']].forEach(([k, data, col, kind, tcol]) => {
    data.forEach(f => {
      const [mx, my] = pt(f), name = f.properties.name || k;
      const key = name + Math.round(mx / 20) + Math.round(my / 20); if (seen.has(key)) return; seen.add(key);
      const wx = mx2x(mx), wz = my2z(my);
      if (f.geometry.type === 'Point' || k === 'airports') {
        groups[k].push(buildMarker(col, wx, wz, kind));
        if (k !== 'homes' || name !== 'Safehouse') addTag(name, tcol, wx, wz, 110);
      }
    });
  });

  // ============ DETAIL LAYER: trees, buildings, birds ============
  const [trBuf, bdBuf, brBuf] = await Promise.all(['trees', 'buildings', 'birds'].map(k => fetch(`assets/${k}.bin`).then(r => r.arrayBuffer())));
  const TR = new Float32Array(trBuf), BD = new Float32Array(bdBuf), BR = new Float32Array(brBuf);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), sv = new THREE.Vector3(), pv = new THREE.Vector3(), col = new THREE.Color();
  const detail = new THREE.Group(); scene.add(detail); window.__detail = detail;

  // ---- trees: 4 species, each a multi-part mesh (trunk + crowns), instanced ----
  const mk = (geo, color, rough = 1) => new THREE.MeshStandardMaterial({ color, roughness: rough, flatShading: true });
  function merge(parts) { // parts: [geometry, matrix] -> single BufferGeometry with vertex colors
    const pos = [], nor = [], colr = [], idx = []; let off = 0;
    parts.forEach(([g, mat, c]) => {
      const gg = g.clone().applyMatrix4(mat); const p = gg.attributes.position, n = gg.attributes.normal; const cc = new THREE.Color(c);
      for (let i = 0; i < p.count; i++) { pos.push(p.getX(i), p.getY(i), p.getZ(i)); nor.push(n.getX(i), n.getY(i), n.getZ(i)); const j = 0.88 + Math.random() * 0.24; colr.push(cc.r * j, cc.g * j, cc.b * j); }
      if (gg.index) for (let i = 0; i < gg.index.count; i++) idx.push(gg.index.getX(i) + off); else for (let i = 0; i < p.count; i++) idx.push(i + off);
      off += p.count;
    });
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); out.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3)); out.setIndex(idx); return out;
  }
  const T = (x, y, z, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, rz)), new THREE.Vector3(sx, sy, sz));
  const species = [
    merge([[new THREE.CylinderGeometry(0.7, 1.1, 9, 6), T(0, 4.5, 0), 0x6b4a2b], [new THREE.ConeGeometry(6, 12, 7), T(0, 13, 0), 0x1f6b3a], [new THREE.ConeGeometry(4.8, 10, 7), T(0, 19, 0), 0x277a44], [new THREE.ConeGeometry(3, 8, 7), T(0, 24, 0), 0x2f8a4e]]), // pine
    merge([[new THREE.CylinderGeometry(0.9, 1.4, 8, 6), T(0, 4, 0), 0x70502e], [new THREE.IcosahedronGeometry(6.5, 1), T(0, 12, 0, 0, 0, 1, 0.85, 1), 0x3f8f3a], [new THREE.IcosahedronGeometry(4.4, 1), T(4, 10, 2), 0x4aa043], [new THREE.IcosahedronGeometry(4, 1), T(-3.5, 11, -2), 0x388a35]]), // broadleaf
    merge([[new THREE.CylinderGeometry(0.5, 0.9, 16, 6), T(0, 8, 0, 0, 0.12), 0x9a7b50], ...Array.from({ length: 7 }, (_, i) => { const a = i / 7 * Math.PI * 2; return [new THREE.BoxGeometry(9, 0.3, 2), T(Math.cos(a) * 3.8 + 1.2, 16.5, Math.sin(a) * 3.8, 0.35, 0).multiply(new THREE.Matrix4().makeRotationY(-a)), 0x3aa65a]; })]), // palm
    merge([[new THREE.CylinderGeometry(1, 1.2, 7, 7), T(0, 3.5, 0), 0x5f8f4f], [new THREE.CylinderGeometry(0.6, 0.7, 3.5, 6), T(2, 5, 0, 0, -0.9), 0x5f8f4f], [new THREE.SphereGeometry(1, 7, 6), T(0, 7, 0), 0x5f8f4f]]), // cactus
  ];
  const treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });
  const byType = [[], [], [], []]; for (let i = 0; i < TR.length; i += 4) byType[TR[i + 3]].push(i);
  byType.forEach((list, t) => {
    const im = new THREE.InstancedMesh(species[t], treeMat, list.length);
    list.forEach((o, k) => {
      const wx = mx2x(TR[o]), wz = my2z(TR[o + 1]), sc = TR[o + 2] * (t === 3 ? 0.8 : 1.15);
      q.setFromAxisAngle(up, Math.random() * 6.28); pv.set(wx, Math.max(hAt(wx, wz), 0) - 0.5, wz); sv.set(sc, sc * (0.9 + Math.random() * 0.3), sc);
      m4.compose(pv, q, sv); im.setMatrixAt(k, m4);
    });
    im.instanceMatrix.needsUpdate = true; im.frustumCulled = false; detail.add(im);
  });

  // ---- buildings: window texture generated on a canvas ----
  function windowTex(lit) {
    const c = document.createElement('canvas'); c.width = 64; c.height = 128; const x = c.getContext('2d');
    x.fillStyle = '#9aa7b3'; x.fillRect(0, 0, 64, 128);
    for (let r = 0; r < 16; r++) for (let k = 0; k < 6; k++) { x.fillStyle = lit ? (Math.random() < 0.55 ? '#ffe7a3' : '#2a3441') : '#46607a'; x.fillRect(4 + k * 10, 3 + r * 8, 6, 5); }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  const dayWin = windowTex(false), nightWin = windowTex(true);
  const bMat = new THREE.MeshStandardMaterial({ map: dayWin, roughness: 0.7, metalness: 0.1 });
  // tile the window texture by the building's real size (floors = height/4, columns = width/3) using the instance matrix scale
  bMat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>
      #ifdef USE_INSTANCING
        vec3 isc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
        vec3 nn = abs(normal);
        float horiz = nn.x > 0.5 ? isc.z : isc.x;
        vMapUv = uv * (nn.y > 0.5 ? vec2(1.0) : vec2(max(1.0, floor(horiz / 5.0)) * 0.5, max(1.0, floor(isc.y / 4.0)) / 16.0 * 1.0));
      #endif`);
  };
  window.__bMat = bMat; window.__winTex = [dayWin, nightWin];
  // box with UVs scaled in the shader-free way: we bake repeat via per-kind geometry
  const unit = new THREE.BoxGeometry(1, 1, 1); unit.translate(0, 0.5, 0);
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x55606b, roughness: 1 });
  const houseRoof = new THREE.ConeGeometry(0.78, 0.55, 4); houseRoof.rotateY(Math.PI / 4); houseRoof.translate(0, 0.5 + 0.275, 0);
  const kinds = [[], [], [], []]; for (let i = 0; i < BD.length; i += 7) kinds[BD[i + 6]].push(i);
  const palette = [[0xbfc8d2, 0xa4b3c4, 0xd6dde5, 0x8ea1b5], [0xd9c9b0, 0xc4b59c, 0xe3d6c0, 0xb9a98f], [0xf3e3c8, 0xe9c9bd, 0xd4e3c9, 0xe2d6f0, 0xf6dba7], [0x9aa3ab, 0xb0b6bb, 0x8a9096]];
  kinds.forEach((list, kd) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(unit, bMat, list.length);
    const roofs = kd === 2 ? new THREE.InstancedMesh(houseRoof, new THREE.MeshStandardMaterial({ color: 0xa8493a, roughness: 1, flatShading: true }), list.length) : null;
    const caps = kd <= 1 ? new THREE.InstancedMesh(unit, roofMat, list.length) : null;
    const pal = palette[kd];
    list.forEach((o, k) => {
      const wx = mx2x(BD[o]), wz = my2z(BD[o + 1]), w = BD[o + 2], d = BD[o + 3], h = BD[o + 4], rot = BD[o + 5];
      const y = Math.max(hAt(wx, wz), 0);
      q.setFromAxisAngle(up, rot); pv.set(wx, y, wz); sv.set(w, h, d); m4.compose(pv, q, sv); im.setMatrixAt(k, m4);
      im.setColorAt(k, col.setHex(pal[Math.floor(Math.random() * pal.length)]));
      if (roofs) { sv.set(w * 1.1, h * 0.9 + 4, d * 1.1); pv.set(wx, y + h - 0.5, wz); m4.compose(pv, q, sv); roofs.setMatrixAt(k, m4); }
      if (caps) { sv.set(w * 0.55, 2.5 + Math.random() * 3, d * 0.55); pv.set(wx, y + h, wz); m4.compose(pv, q, sv); caps.setMatrixAt(k, m4); }
    });
    im.frustumCulled = false; detail.add(im); if (roofs) { roofs.frustumCulled = false; detail.add(roofs); } if (caps) { caps.frustumCulled = false; detail.add(caps); }
  });

  // ---- birds: animated flocks (wings flap in the vertex shader, boids-ish circling) ----
  const birdGeo = new THREE.BufferGeometry();
  birdGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 1.2, -0.2, 0, -0.6, 0.2, 0, -0.6, /*left*/ 0, 0, 0.2, -2.6, 0.2, -0.2, 0, 0, -0.5, /*right*/ 0, 0, 0.2, 0, 0, -0.5, 2.6, 0.2, -0.2], 3));
  birdGeo.computeVertexNormals();
  const birdMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  const flockSize = 14, nFlocks = BR.length / 3, nBirds = nFlocks * flockSize;
  const birds = new THREE.InstancedMesh(birdGeo, birdMat, nBirds); birds.frustumCulled = false;
  const uTime = { value: 0 };
  birdMat.onBeforeCompile = sh => {
    sh.uniforms.uTime = uTime;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace('#include <begin_vertex>', `
      vec3 transformed = vec3(position);
      float ph = float(gl_InstanceID) * 1.37;
      float flap = sin(uTime * 9.0 + ph) * 0.9;
      transformed.y += abs(position.x) * 0.45 * flap;`);
  };
  detail.add(birds);
  const flock = []; for (let f = 0; f < nFlocks; f++) {
    const cx = mx2x(BR[f * 3]), cz = my2z(BR[f * 3 + 1]), kind = BR[f * 3 + 2];
    const base = kind === 0 ? 140 : kind === 1 ? 260 : 90;
    for (let b = 0; b < flockSize; b++) flock.push({ cx, cz, r: 80 + Math.random() * 260, a: Math.random() * 6.28, sp: (0.15 + Math.random() * 0.25) * (Math.random() < .5 ? 1 : -1), y: base + Math.random() * 90, bob: Math.random() * 6 });
  }
  window.__birdUpdate = (t, dt) => {
    uTime.value = t;
    for (let i = 0; i < flock.length; i++) {
      const b = flock[i]; b.a += b.sp * dt * 0.6;
      const x = b.cx + Math.cos(b.a) * b.r, z = b.cz + Math.sin(b.a) * b.r, y = Math.max(hAt(x, z), 0) + b.y + Math.sin(t * 0.8 + b.bob) * 8;
      q.setFromAxisAngle(up, -b.a + (b.sp > 0 ? 0 : Math.PI)); pv.set(x, y, z); sv.set(1.6, 1.6, 1.6); m4.compose(pv, q, sv); birds.setMatrixAt(i, m4);
    }
    birds.instanceMatrix.needsUpdate = true;
  };

  // ---- sea gulls near coast already covered by anchors; clouds ----
  const cm = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, fog: false, depthWrite: false });
  const clouds = new THREE.Group();
  for (let i = 0; i < 46; i++) { const c = new THREE.Group(); for (let k = 0; k < 5; k++) { const m = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), cm); m.scale.set(120 + Math.random() * 160, 40 + Math.random() * 30, 90 + Math.random() * 120); m.position.set(k * 110 - 220, Math.random() * 30, Math.random() * 90); c.add(m); } c.position.set((Math.random() - .5) * 11000, 1100 + Math.random() * 600, (Math.random() - .5) * 11000); clouds.add(c); }
  scene.add(clouds); window.__clouds = clouds;
  document.getElementById('load').firstChild.textContent = 'Starting...';

  document.getElementById('load').remove();
  applyTime('day');
  camera.position.set(-1800, 3600, 4200); controls.target.set(0, 0, 0);
  presets['1']();
  window.__ready = true;
  frame();
}

// ---- camera ----
let anim = null, autoRot = false, labelsOn = true;
function flyTo(tx, tz, dist, hh) {
  const ty = Math.max(hAt(tx, tz), 0);
  anim = { t: 0, fp: camera.position.clone(), ft: controls.target.clone(), tp: new THREE.Vector3(tx - dist * 0.25, ty + (hh ?? dist * 0.65), tz + dist * 0.85), tt: new THREE.Vector3(tx, ty, tz) };
  autoRot = false;
}
const presets = {
  '1': () => flyTo(0, 0, 7200, 5200),
  '2': () => flyTo(mx2x(860), my2z(255), 900),
  '3': () => flyTo(mx2x(175), my2z(455), 900),
  '4': () => flyTo(mx2x(770), my2z(735), 900),
};
addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (presets[k]) presets[k]();
  if (k === 't') applyTime({ day: 'sunset', sunset: 'night', night: 'day' }[mode]);
  if (k === 'r') autoRot = !autoRot;
  if (k === 'l') { labelsOn = !labelsOn; tagLayer.style.display = labelsOn ? '' : 'none'; }
  if (k === 'h') { exaggeration = exaggeration === 1 ? 2.2 : exaggeration === 2.2 ? 0.4 : 1; rebuildTerrain(); }
});
function rebuildTerrain() {
  const p = terrainMesh.geometry.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, hAt(p.getX(i), p.getZ(i)) - 2);
  p.needsUpdate = true; terrainMesh.geometry.computeVertexNormals();
}

const infoEl = document.getElementById('info');
const regionAt = (x, z) => {
  const mx = (x + HALFW) / S, my = (HALFW - z) / S; let best = null, bd = 1e9;
  for (const d of districts.slice(0, 3)) { const dd = Math.hypot(mx - d[1], my - d[2]); if (dd < bd) { bd = dd; best = d[0]; } }
  return bd < 130 ? best : (mx < 0 || mx > 1000 || my < 0 || my > 1000 ? 'Open sea' : 'Countryside');
};
function renderInfo() { infoEl.textContent = regionAt(controls.target.x, controls.target.z) + ' | ' + ({ day: 'Day', sunset: 'Sunset', night: 'Night' })[mode]; }

const v = new THREE.Vector3(), clock = new THREE.Clock();
function frame() {
  const dt = clock.getDelta();
  if (anim) {
    anim.t = Math.min(1, anim.t + dt * 0.55); const k = 1 - Math.pow(1 - anim.t, 3);
    camera.position.lerpVectors(anim.fp, anim.tp, k); controls.target.lerpVectors(anim.ft, anim.tt, k);
    if (anim.t >= 1) anim = null;
  }
  if (autoRot) { const o = camera.position.clone().sub(controls.target); o.applyAxisAngle(new THREE.Vector3(0, 1, 0), dt * 0.1); camera.position.copy(controls.target).add(o); }
  if (window.__clouds) window.__clouds.position.x = Math.sin(performance.now() / 60000) * 400;
  if (window.__birdUpdate) window.__birdUpdate(performance.now() / 1000, dt);
  controls.update();
  // keep camera above terrain
  const gh = Math.max(hAt(camera.position.x, camera.position.z), 0) + 25;
  if (camera.position.y < gh) camera.position.y = gh;
  // labels
  if (labelsOn) for (const t of tags) {
    v.copy(t.p).project(camera);
    const vis = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 && camera.position.distanceTo(t.p) < 9000;
    t.el.style.display = vis ? '' : 'none';
    if (vis) { t.el.style.left = ((v.x + 1) / 2 * innerWidth) + 'px'; t.el.style.top = ((1 - v.y) / 2 * innerHeight) + 'px'; }
  }
  renderInfo();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
main().catch(e => { document.getElementById('load').innerHTML = 'Failed to load: ' + e.message; console.error(e); });
