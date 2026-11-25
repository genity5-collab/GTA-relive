import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// World: the real San Andreas map image is 1000x1000 map units (SanMap coords, y up from bottom).
// We map it to a 6000 x 6000 world. world x = mx*6 - 3000 ; world z = 3000 - my*6.
const S = 6, HALFW = 3000;
const mx2x = mx => mx * S - HALFW;
const my2z = my => HALFW - my * S;

const canvas = document.getElementById('c');
function hasWebGL() { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; } }
if (!hasWebGL() || location.search.includes('flat')) { import('./flat.js'); throw new Error('webgl-fallback'); }
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
  // name, map coords (SanMap 0..1000 x/y), camera distance
  ['Los Santos',    860, 255, 900],
  ['San Fierro',    165, 560, 900],
  ['Las Venturas',  690, 700, 900],
  ['Mount Chiliad', 330, 810, 800],
  ['Bone County',   150, 800, 1400],
  ['Red County',    780, 400, 1400],
  ['Flint County',  200, 330, 1400],
  ['Tierra Robada', 120, 760, 1400],
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

  // sky rings for flavor: cloud puffs
  const cm = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, fog: false });
  const clouds = new THREE.Group();
  for (let i = 0; i < 40; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), cm);
    m.scale.set(120 + Math.random() * 260, 30 + Math.random() * 30, 100 + Math.random() * 200);
    m.position.set((Math.random() - 0.5) * 9000, 900 + Math.random() * 500, (Math.random() - 0.5) * 9000); clouds.add(m);
  }
  scene.add(clouds); window.__clouds = clouds;

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
  '3': () => flyTo(mx2x(165), my2z(560), 900),
  '4': () => flyTo(mx2x(690), my2z(700), 900),
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
