import * as THREE from 'three';

const V = '1795620585';
const S = 6, HALFW = 3000;
const mx2x = mx => mx * S - HALFW, my2z = my => HALFW - my * S;

// ================= QUALITY (Lite by default, auto-downgrades if FPS drops) =================
const TIERS = {
  lite:   { name: 'Lite',   dpr: 1,    seg: 192, trees: 0.35, bldg: 0.6, birds: 4,  drawDist: 1500, detailDist: 260, shadows: false },
  medium: { name: 'Medium', dpr: 1,    seg: 256, trees: 0.7,  bldg: 0.85, birds: 8, drawDist: 2300, detailDist: 420, shadows: false },
  high:   { name: 'High',   dpr: Math.min(devicePixelRatio, 1.5), seg: 320, trees: 1, bldg: 1, birds: 12, drawDist: 3200, detailDist: 650, shadows: true },
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
  const ei = m === 'night' ? 0.04 : m === 'sunset' ? 0.18 : 0.35; for (const k of ['asph', 'walk']) if (window.__roadMats) window.__roadMats[k].envMapIntensity = ei; seaMat.envMapIntensity = ei * 2;
}

// ================= DATA / TERRAIN =================
const loadTex = u => new Promise((res, rej) => new THREE.TextureLoader().load(u, res, undefined, rej));
const loadImg = u => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = u; });
const loadJSON = u => fetch(u).then(r => r.json());
const loadBin = k => fetch('assets/' + k + '.bin?v=' + V).then(r => r.arrayBuffer()).then(b => new Float32Array(b));
const loadHeights = () => fetch('assets/height.bin?v=' + V).then(r => r.arrayBuffer()).then(b => { const u = new Uint16Array(b), f = new Float32Array(u.length); for (let i = 0; i < u.length; i++) f[i] = u[i] / 100; return f; });
let heightData, HN = 1024, terrain, fineTerrain;
const HCELL = (HALFW * 2) / (1024 - 1);          // world size of one height texel (about 5.9)
function hAt(wx, wz) {
  const u = (wx + HALFW) / (2 * HALFW), v = (wz + HALFW) / (2 * HALFW);
  if (u < 0 || u > 1 || v < 0 || v > 1) return 0;
  const x = u * (HN - 1), y = v * (HN - 1), x0 = Math.min(HN - 2, Math.floor(x)), y0 = Math.min(HN - 2, Math.floor(y)), fx = x - x0, fy = y - y0;
  const i = y0 * HN + x0, a = heightData[i], b = heightData[i + 1], c = heightData[i + HN], d = heightData[i + HN + 1];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}


// Height of the coarse terrain mesh exactly as the GPU draws it (same triangle split as PlaneGeometry), so far objects never hover above it.
function drawnAt(wx, wz) {
  const seg = Q.seg, u = (wx + HALFW) / (2 * HALFW) * seg, v = (wz + HALFW) / (2 * HALFW) * seg;
  if (u < 0 || v < 0 || u > seg || v > seg) return 0;
  const i = Math.min(seg - 1, Math.floor(u)), j = Math.min(seg - 1, Math.floor(v)), fx = u - i, fy = v - j, cs = (2 * HALFW) / seg;
  const g = (a, b) => hAt(a * cs - HALFW, b * cs - HALFW);
  const A = g(i, j), B = g(i, j + 1), C = g(i + 1, j + 1), D = g(i + 1, j);
  return fx + fy <= 1 ? A + (D - A) * fx + (B - A) * fy : C + (B - C) * (1 - fx) + (D - C) * (1 - fy);
}
// Where a static object stands: never above either the exact ground (near the player) or the drawn coarse ground (far away). It may sink a little, never float.
const placeY = (wx, wz) => Math.max(Math.min(hAt(wx, wz), drawnAt(wx, wz)), 0);

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
  // real facade detail: Poly Haven plaster (or brick on every 3rd building) multiplied over the window grid, tiled in world units
  sh.uniforms.facade = { value: T.plaster[0] }; sh.uniforms.facadeB = { value: T.brick[0] };
  sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vFac; varying float vBrick;').replace('#include <uv_vertex>', `#include <uv_vertex>
    #ifdef USE_INSTANCING
      vec3 isc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
      vec3 nn = abs(normal);
      float horiz = nn.x > 0.5 ? isc.z : isc.x;
      vMapUv = uv * (nn.y > 0.5 ? vec2(1.0) : vec2(max(1.0, floor(horiz / 5.0)) * 0.4, max(1.0, floor(isc.y / 4.0)) / 16.0));
      vFac = uv * vec2(horiz, isc.y) / 6.0;                        // one facade texture tile per 6 world units
      vBrick = step(0.66, fract(instanceMatrix[3].x * 0.0137 + instanceMatrix[3].z * 0.0211));
      #ifdef USE_EMISSIVEMAP
        vEmissiveMapUv = vMapUv;
      #endif
    #else
      vFac = uv; vBrick = 0.0;
    #endif`);
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D facade; uniform sampler2D facadeB; varying vec2 vFac; varying float vBrick;').replace('#include <map_fragment>', `#include <map_fragment>
    vec3 fac = mix(texture2D(facade, vFac).rgb * vec3(1.05, 0.97, 0.86), texture2D(facadeB, vFac).rgb * 1.35, vBrick);
    diffuseColor.rgb *= mix(vec3(1.0), fac * 1.25, 0.85);`);
};
// ---- real CC0 PBR textures (Poly Haven), 512px, loaded once and shared ----
const texLoader = new THREE.TextureLoader();
function pbrTex(name, rep, srgb = true) { const t = texLoader.load('assets/tex/' + name + '.jpg?v=' + V); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); t.anisotropy = Q.name === 'Lite' ? 2 : 4; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; }
const T = {
  road: [pbrTex('road_d', 1), pbrTex('road_n', 1, false)], walk: [pbrTex('walk_d', 1), pbrTex('walk_n', 1, false)],
  plaster: [pbrTex('plaster_d', 1), pbrTex('plaster_n', 1, false)], brick: [pbrTex('brick_d', 1), pbrTex('brick_n', 1, false)], roof: [pbrTex('roof_d', 1), pbrTex('roof_n', 1, false)],
};
const roofMat = new THREE.MeshLambertMaterial({ color: 0x5b646d });
const hRoofMat = new THREE.MeshLambertMaterial({ color: 0x9c4a3a });
const palette = [[0xc4ccd4, 0xa9b6c5, 0xdbe1e7, 0x93a5b8], [0xd8cab3, 0xc6b9a1, 0xe2d7c4, 0xb9aa91], [0xf0e2c9, 0xe6cabf, 0xd3e0c8, 0xe1d6ee, 0xf3d9a8], [0x9ba4ac, 0xaeb4ba, 0x8c9298]];

// ---- CC0 city-kit models (kayquer/kit-cidade-lowpoly), packed by tools/pack_props.py: int16 pos, int8 normal, uint8 colour, uint16 index ----
const PROPS = {};
async function loadProps() {
  const [ix, buf] = await Promise.all([loadJSON('assets/props.json?v=' + V), fetch('assets/props.bin?v=' + V).then(r => r.arrayBuffer())]);
  for (const name in ix) {
    const r = ix[name], v = r.v; let o = r.o;
    const pos = new Float32Array(v * 3), nor = new Float32Array(v * 3), col = new Float32Array(v * 3);
    const P = new Int16Array(buf, o, v * 3); o += v * 6; const N = new Int8Array(buf, o, v * 3); o += v * 3 + ((-v * 3) % 4 + 4) % 4;
    const C = new Uint8Array(buf, o, v * 3); o += v * 3 + ((-v * 3) % 4 + 4) % 4; const I = new Uint16Array(buf, o, r.i);
    for (let k = 0; k < v * 3; k++) { pos[k] = P[k] / 1024; nor[k] = N[k] / 127; col[k] = C[k] / 255; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(new THREE.BufferAttribute(new Uint16Array(I), 1));
    g.computeBoundingSphere(); PROPS[name] = { geo: g, min: r.min, max: r.max, size: [r.max[0] - r.min[0], r.max[1] - r.min[1], r.max[2] - r.min[2]] };
  }
}
const propMat = new THREE.MeshLambertMaterial({ vertexColors: true });
// which kit model each building kind may use (picked per building from its index so the street looks varied)
const KIND_MODELS = { 2: ['casa_simples', 'casa_sobrado', 'casas_geminadas', 'casa_simples'], 3: ['loja_esquina', 'mercado', 'restaurante', 'galpao', 'oficina', 'banco'], 1: ['predio_apartamentos', 'escritorio', 'hotel', 'predio_alto'] };

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
      list.forEach((o, k) => { const wx = mx2x(TR[o]), wz = my2z(TR[o + 1]), sc = TR[o + 2] * 1.1; q.setFromAxisAngle(up, (o * 12.9898 % 6.28)); pv.set(wx, placeY(wx, wz) - 0.5, wz); sv.set(sc, sc * (0.9 + (o % 7) * 0.04), sc); m4.compose(pv, q, sv); im.setMatrixAt(k, m4); });
      im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.userData.tree = true; ch.meshes.push(im);
    });
    // buildings
    const bl = bbuck.get(key) || []; const byK = [[], [], [], []]; bl.forEach(o => byK[BD[o + 6]].push(o));
    byK.forEach((list, kd) => {
      if (!list.length) return;
      // FAR version: cheap stretched box (+ pitched roof for houses). Always built; shown beyond the detail radius.
      const im = new THREE.InstancedMesh(unit, bMat, list.length); const pal = palette[kd];
      const roofs = kd === 2 ? new THREE.InstancedMesh(houseRoof, hRoofMat, list.length) : null; const caps = kd <= 1 ? new THREE.InstancedMesh(unit, roofMat, list.length) : null;
      list.forEach((o, k) => {
        const wx = mx2x(BD[o]), wz = my2z(BD[o + 1]), w = BD[o + 2], d = BD[o + 3], h = BD[o + 4], rot = BD[o + 5], y = placeY(wx, wz);
        q.setFromAxisAngle(up, rot); pv.set(wx, y - 1, wz); sv.set(w, h + 1, d); m4.compose(pv, q, sv); im.setMatrixAt(k, m4); im.setColorAt(k, col.setHex(pal[(o * 7) % pal.length]));
        if (roofs) { sv.set(w * 1.1, h * 0.8 + 3, d * 1.1); pv.set(wx, y + h - 0.5, wz); m4.compose(pv, q, sv); roofs.setMatrixAt(k, m4); }
        if (caps) { sv.set(w * 0.5, 2.5 + (o % 3), d * 0.5); pv.set(wx, y + h, wz); m4.compose(pv, q, sv); caps.setMatrixAt(k, m4); }
      });
      [im, roofs, caps].forEach(x => { if (x) { x.instanceMatrix.needsUpdate = true; x.computeBoundingSphere(); x.userData.far = kd >= 1 && !!PROPS.casa_simples; ch.meshes.push(x); } });
      // NEAR version: real kit models (hundreds of triangles each), drawn only in chunks close to the player. Towers (kind 0) have no kit model and stay boxes.
      if (kd >= 1 && PROPS.casa_simples) {
        const models = KIND_MODELS[kd], groups = new Map();
        list.forEach(o => { const mn = models[(o * 2654435761 >>> 0) % models.length]; let g = groups.get(mn); if (!g) groups.set(mn, g = []); g.push(o); });
        groups.forEach((gl, mn) => {
          const P = PROPS[mn]; if (!P) return; const dm = new THREE.InstancedMesh(P.geo, propMat, gl.length);
          gl.forEach((o, k) => {
            const wx = mx2x(BD[o]), wz = my2z(BD[o + 1]), w = BD[o + 2], d = BD[o + 3], h = BD[o + 4], rot = BD[o + 5], y = placeY(wx, wz);
            q.setFromAxisAngle(up, rot); pv.set(wx, y - 0.4, wz); sv.set(w / P.size[0], (h + 0.4) / P.size[1], d / P.size[2]); m4.compose(pv, q, sv); dm.setMatrixAt(k, m4);
          });
          dm.instanceMatrix.needsUpdate = true; dm.computeBoundingSphere(); dm.userData.near = true; ch.meshes.push(dm);
        });
      }
    });
    ch.meshes.forEach(m => { m.visible = false; m.frustumCulled = true; world.add(m); }); chunks.push(ch);
  });
}
function updateChunks() {
  const cp = camera.position, lim = Q.drawDist + CS * 0.75, lim2 = lim * lim;
  const nearR = (lim * 0.62) ** 2, propR = (lim * 0.42) ** 2, detR = (Q.detailDist + CS * 0.5) ** 2;      // trees at 62% of draw distance, street props at 42% (a 1 m hydrant is invisible beyond that), real building models only right around the player
  for (const ch of chunks) {
    const dx = ch.center.x - cp.x, dz = ch.center.z - cp.z, d2 = dx * dx + dz * dz, vis = d2 < lim2, near = d2 < nearR, prop = d2 < propR, det = d2 < detR;
    for (const m of ch.meshes) { const u = m.userData; m.visible = u.near ? det : u.far ? (vis && !det) : u.small ? prop : u.tree ? near : vis; }
  }
}


// ================= ROADS: terrain-following ribbons, merged per chunk. Asphalt and sidewalks use real PBR textures =================
// widths in world units (1 map unit = 6 world units). street ~9, main ~14, freeway ~26.
const ROAD_W = [9, 14, 26];
const mkRoadMat = (tex, rep, tint) => new THREE.MeshStandardMaterial({ map: tex[0], normalMap: tex[1], normalScale: new THREE.Vector2(0.9, 0.9), color: tint, roughness: 0.92, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
window.__roadMats = null; const roadMats = { asph: mkRoadMat(T.road, 1, 0xb8b4ae), walk: mkRoadMat(T.walk, 1, 0xd6d0c6), paint: new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }) };
window.__roadMats = roadMats; for (const k of ['asph', 'walk']) roadMats[k].envMapIntensity = 0.35;
function buildRoads(roads) {
  const buckets = new Map();
  const bucket = key => { let b = buckets.get(key); if (!b) buckets.set(key, b = { asph: { pos: [], uv: [], idx: [] }, walk: { pos: [], uv: [], idx: [] }, paint: { pos: [], col: [], idx: [] } }); return b; };
  const C_LINE = [0.93, 0.93, 0.9], C_YEL = [0.92, 0.74, 0.14], C_RAIL = [0.55, 0.56, 0.58];
  // Catmull-Rom smoothing so curves are not jagged, resampled about every 14 world units
  function resample(pts) {
    const out = []; const n = pts.length;
    for (let i = 0; i < n - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n - 1, i + 2)];
      const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]); const steps = Math.max(1, Math.round(len / 14));
      for (let k = 0; k < steps; k++) { const t = k / steps, t2 = t * t, t3 = t2 * t;
        out.push([0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
                  0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3)]); }
    }
    out.push(pts[n - 1]); return out;
  }
  // a ribbon between lateral offsets off0..off1. kind 'tex' writes UVs (u across width in tile units, v along the road), kind 'col' writes a flat colour
  function strip(g, P, dist, off0, off1, lift, tile, col) {
    const base = g.pos.length / 3;
    for (let i = 0; i < P.length; i++) {
      const a = P[Math.max(0, i - 1)], d = P[Math.min(P.length - 1, i + 1)];
      let tx = d[0] - a[0], tz = d[1] - a[1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l; const nx = -tz, nz = tx;
      [off0, off1].forEach((o, k) => { const x = P[i][0] + nx * o, z = P[i][1] + nz * o; g.pos.push(x, Math.max(hAt(x, z), drawnAt(x, z), 0) + lift + P[i][2], z);
        if (g.uv) g.uv.push(k * Math.abs(off1 - off0) / tile, dist[i] / tile); else g.col.push(col[0], col[1], col[2]); });
    }
    for (let i = 0; i < P.length - 1; i++) { const k = base + i * 2; g.idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  }
  let tris = 0;
  roads.forEach(r => {
    const raw = []; for (let i = 0; i < r.p.length; i += 2) raw.push([mx2x(r.p[i]), my2z(r.p[i + 1])]);
    if (raw.length < 2) return;
    const P = resample(raw); const cls = r.c, W = ROAD_W[cls] / 2;
    for (const p of P) p[2] = 0;
    if (cls === 2) for (let i = 0; i < P.length; i++) { let m = -1e9; for (let j = Math.max(0, i - 4); j <= Math.min(P.length - 1, i + 4); j++) m = Math.max(m, hAt(P[j][0], P[j][1])); P[i][2] = Math.max(0, Math.min(14, m - hAt(P[i][0], P[i][1]))); }
    const D = [0]; for (let i = 1; i < P.length; i++) D[i] = D[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
    let run = [], rd = [], runKey = null;
    const flush = () => { if (run.length > 1) { const b = bucket(runKey); const lift = 0.35;
        strip(b.asph, run, rd, -W, W, lift, 9, null);                                                        // asphalt, one texture tile = 9 world units
        strip(b.paint, run, rd, -W, -W + 0.7, lift + 0.12, 1, C_LINE); strip(b.paint, run, rd, W - 0.7, W, lift + 0.12, 1, C_LINE);
        if (cls >= 1) strip(b.paint, run, rd, -0.35, 0.35, lift + 0.14, 1, cls === 2 ? C_LINE : C_YEL);
        if (cls === 0) { strip(b.walk, run, rd, -W - 2.4, -W, lift + 0.05, 4, null); strip(b.walk, run, rd, W, W + 2.4, lift + 0.05, 4, null); }
        if (cls === 2) { strip(b.paint, run, rd, -W - 0.9, -W, lift + 0.5, 1, C_RAIL); strip(b.paint, run, rd, W, W + 0.9, lift + 0.5, 1, C_RAIL); }
        tris += run.length * 2 * (cls === 0 ? 5 : cls === 1 ? 4 : 5); }
      run = []; rd = []; };
    P.forEach((pt, i) => { const [ca, cb] = chunkOf(pt[0], pt[1]); const k = ca + ',' + cb;
      if (runKey !== null && k !== runKey) { const last = run[run.length - 1], ld = rd[rd.length - 1]; run.push([pt[0], pt[1], pt[2] || 0]); rd.push(D[i]); flush(); run = [[last[0], last[1], last[2]]]; rd = [ld]; }
      runKey = k; run.push([pt[0], pt[1], pt[2] || 0]); rd.push(D[i]); });
    flush();
  });
  buckets.forEach((b, key) => {
    const [ca, cb] = key.split(',').map(Number);
    let ch = chunks.find(c => c.cx === ca && c.cz === cb);
    if (!ch) { ch = { cx: ca, cz: cb, center: new THREE.Vector3(-HALFW + (ca + .5) * CS, 0, -HALFW + (cb + .5) * CS), meshes: [] }; chunks.push(ch); }
    for (const kind of ['asph', 'walk', 'paint']) {
      const g = b[kind]; if (!g.idx.length) continue;
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
      if (g.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2)); else geo.setAttribute('color', new THREE.Float32BufferAttribute(g.col, 3));
      geo.setIndex(g.idx); geo.computeVertexNormals(); geo.computeBoundingSphere();
      const m = new THREE.Mesh(geo, roadMats[kind]); m.visible = false; m.userData.road = true; world.add(m); ch.meshes.push(m);
    }
  });
  window.__roadStats = { chunks: buckets.size, approxTris: tris };
}

// ================= STREET PROPS: lamps, hydrants, benches, bins, signs, bus stops and traffic from the CC0 city kit =================
// Real-world heights (metres). The kit models are tiny and un-scaled, so each type has a target height and is scaled uniformly to it.
const PROP_H = { poste_luz: 7.5, hidrante: 0.8, banco_praca: 1.0, lixeira: 1.1, placa_pare: 2.6, ponto_onibus: 2.8, carro: 1.5, taxi: 1.5, caminhao: 3.4, onibus: 3.2 };
function buildStreetProps(SP, types) {
  const buck = new Map(); const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), pv = new THREE.Vector3(), sv = new THREE.Vector3();
  for (let i = 0; i < SP.length; i += 4) { const wx = mx2x(SP[i]), wz = my2z(SP[i + 1]); const [a, b] = chunkOf(wx, wz); const key = a + ',' + b; let g = buck.get(key); if (!g) buck.set(key, g = []); g.push(i); }
  let n = 0;
  buck.forEach((list, key) => {
    const [ca, cb] = key.split(',').map(Number); let ch = chunks.find(c => c.cx === ca && c.cz === cb);
    if (!ch) { ch = { cx: ca, cz: cb, center: new THREE.Vector3(-HALFW + (ca + .5) * CS, 0, -HALFW + (cb + .5) * CS), meshes: [] }; chunks.push(ch); }
    const by = new Map(); list.forEach(o => { const t = types[SP[o + 3]]; let g = by.get(t); if (!g) by.set(t, g = []); g.push(o); });
    by.forEach((gl, t) => {
      const P = PROPS[t]; if (!P) return; const im = new THREE.InstancedMesh(P.geo, propMat, gl.length); const sc = PROP_H[t] / P.size[1];
      gl.forEach((o, k) => { const wx = mx2x(SP[o]), wz = my2z(SP[o + 1]); q.setFromAxisAngle(up, SP[o + 2]); pv.set(wx, placeY(wx, wz) - P.min[1] * sc + 0.05, wz); sv.set(sc, sc, sc); m4.compose(pv, q, sv); im.setMatrixAt(k, m4); });
      im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.userData.small = true; im.visible = false; world.add(im); ch.meshes.push(im); n += gl.length;
    });
  });
  window.__propStats = { props: n };
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

const districts = [['Los Santos', 800, 255, 900], ['San Fierro', 165, 500, 900], ['Las Venturas', 835, 715, 900]];

// ================= FINE TERRAIN: one vertex per height texel around the player, so everything sits exactly on the drawn ground =================
const FN = 150;                                   // 150 x 150 cells x 5.87 units = about 880 units across (about 45k triangles)
let fineGeo, fineCX = 1e9, fineCZ = 1e9;
function buildFineTerrain(mat) {
  fineGeo = new THREE.PlaneGeometry(1, 1, FN, FN); fineGeo.rotateX(-Math.PI / 2);
  const n = (FN + 1) * (FN + 1); fineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3)); fineGeo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  fineGeo.deleteAttribute('uv');
  fineTerrain = new THREE.Mesh(fineGeo, mat); fineTerrain.frustumCulled = false; fineTerrain.renderOrder = 0; scene.add(fineTerrain);
  fineTerrain.visible = false;
}
function updateFineTerrain(px, pz) {
  if (!fineTerrain) return;
  const ix = Math.round((px + HALFW) / HCELL), iz = Math.round((pz + HALFW) / HCELL);
  if (ix === fineCX && iz === fineCZ) return; fineCX = ix; fineCZ = iz;
  const pos = fineGeo.attributes.position, nor = fineGeo.attributes.normal, half = FN / 2; let k = 0;
  const hv = (i, j) => heightData[Math.max(0, Math.min(HN - 1, j)) * HN + Math.max(0, Math.min(HN - 1, i))];
  for (let j = 0; j <= FN; j++) for (let i = 0; i <= FN; i++, k++) {
    const gi = ix - half + i, gj = iz - half + j; const wx = gi * HCELL - HALFW, wz = gj * HCELL - HALFW;
    const edge = (i === 0 || j === 0 || i === FN || j === FN), y = hv(gi, gj); pos.setXYZ(k, wx, y + 0.02 - (edge ? 5 : 0), wz);
    const dx = (hv(gi + 1, gj) - hv(gi - 1, gj)) / (2 * HCELL), dz = (hv(gi, gj + 1) - hv(gi, gj - 1)) / (2 * HCELL); const l = Math.hypot(dx, 1, dz); nor.setXYZ(k, -dx / l, 1 / l, -dz / l);
  }
  pos.needsUpdate = nor.needsUpdate = true; fineGeo.computeBoundingSphere(); fineTerrain.visible = true;
}

// ================= MAIN =================
async function main() {
  const [aerial, detail, TR, BD, BR, ROADS, SP, SPT, gD, gN, gW] = await Promise.all([
    loadTex('assets/sa_aerial_2k.jpg?v=' + V), loadTex('assets/detail.jpg?v=' + V),
    loadBin('trees'), loadBin('buildings'), loadBin('birds'), loadJSON('assets/roads.json?v=' + V), loadBin('street'), loadJSON('assets/street_types.json?v=' + V),
    loadTex('assets/tex/ground_d.jpg?v=' + V), loadTex('assets/tex/ground_n.jpg?v=' + V), loadTex('assets/tex/ground_w.png?v=' + V),
  ]);
  heightData = await loadHeights();
  aerial.colorSpace = THREE.SRGBColorSpace; aerial.anisotropy = 4; detail.wrapS = detail.wrapT = THREE.RepeatWrapping; detail.colorSpace = THREE.SRGBColorSpace;
  gD.colorSpace = THREE.SRGBColorSpace; for (const t of [gD, gN]) { t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.anisotropy = 4; }
  gW.colorSpace = THREE.NoColorSpace; gW.minFilter = THREE.LinearFilter; gW.magFilter = THREE.LinearFilter; gW.generateMipmaps = false;

  // ---- terrain material: aerial map colour + four real CC0 ground layers (grass, dirt, rock, sand) tiled at metre scale, with normal maps ----
  const tm = new THREE.MeshLambertMaterial({ map: aerial });
  tm.onBeforeCompile = sh => {
    sh.uniforms.gD = { value: gD }; sh.uniforms.gN = { value: gN }; sh.uniforms.gW = { value: gW }; sh.uniforms.detailMap = { value: detail };
    sh.uniforms.uNear = tm.userData.uNear; sh.uniforms.uHalf = { value: HALFW };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWp = (modelMatrix * vec4(position, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      uniform sampler2D gD; uniform sampler2D gN; uniform sampler2D gW; uniform sampler2D detailMap; uniform float uHalf; uniform vec3 uNear; varying vec3 vWp;
      vec4 atlasSample(sampler2D t, vec2 wuv, float layer) {                         // one 2x2 atlas tile, wrapped by hand so mips never bleed into neighbours
        vec2 f = fract(wuv); vec2 dx = dFdx(wuv), dy = dFdy(wuv);
        vec2 off = vec2(mod(layer, 2.0), floor(layer / 2.0)) * 0.5;
        vec2 uv = off + 0.0025 + f * 0.495;
        return textureGrad(t, uv, dx * 0.495, dy * 0.495);
      }`)
      .replace('#include <map_fragment>', `
      vec2 wuvMap = (vWp.xz + uHalf) / (2.0 * uHalf);
      vec4 sampledDiffuseColor = texture2D(map, vec2(wuvMap.x, 1.0 - wuvMap.y));
      vec4 w = texture2D(gW, vec2(wuvMap.x, 1.0 - wuvMap.y));
      float camD = length(vWp - cameraPosition);
      float nearK = 1.0 - smoothstep(180.0, 900.0, camD);                              // ground detail fades into the plain aerial colour far away
      vec2 uvA = vWp.xz / 7.0, uvB = vWp.xz / 41.0 + 0.37;                              // fine and broad scales break up visible tiling
      vec3 gcol = vec3(0.0);
      gcol += w.r * (atlasSample(gD, uvA, 0.0).rgb * 0.65 + atlasSample(gD, uvB, 0.0).rgb * 0.35);
      gcol += w.g * (atlasSample(gD, uvA, 1.0).rgb * 0.65 + atlasSample(gD, uvB, 1.0).rgb * 0.35);
      gcol += w.b * (atlasSample(gD, uvA * 0.8, 2.0).rgb * 0.65 + atlasSample(gD, uvB, 2.0).rgb * 0.35);
      gcol += w.a * (atlasSample(gD, uvA, 3.0).rgb * 0.65 + atlasSample(gD, uvB, 3.0).rgb * 0.35);
      vec3 aer = sampledDiffuseColor.rgb;                                              // the real map keeps control of hue and brightness
      float aL = dot(aer, vec3(0.299, 0.587, 0.114));
      aer = mix(vec3(aL), aer, 0.9);
      float gL = max(dot(gcol, vec3(0.299, 0.587, 0.114)), 0.02);
      vec3 detailed = aer * (gcol / gL) * 0.5 + aer * (gL / 0.22) * 0.5;                // aerial hue, ground-texture grain and contrast
      detailed = mix(aer, detailed, 0.92);
      diffuseColor.rgb = mix(aer, detailed, nearK) * vec3(1.02, 1.0, 0.95);
      diffuseColor.rgb = mix(diffuseColor.rgb, aer * (0.82 + 0.36 * texture2D(detailMap, vWp.xz * 0.011).r), (1.0 - nearK) * 0.6);`)
      // normal map: the surface normal is geometric, tangents follow world X / Z, so build the TBN from the view matrix
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      {
        float lay = floor(w.g * 1.0 + w.b * 2.0 + w.a * 3.0 + 0.5);
        vec3 tn = atlasSample(gN, uvA, lay).rgb * 2.0 - 1.0;
        tn.xy *= 1.1 * nearK;
        vec3 Tw = normalize((viewMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
        vec3 Bw = normalize((viewMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz);
        normal = normalize(normal + Tw * tn.x - Bw * tn.y);
      }`);
  };
  tm.userData.uNear = { value: new THREE.Vector3() };

  const geo = new THREE.PlaneGeometry(HALFW * 2, HALFW * 2, Q.seg, Q.seg); geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, hAt(p.getX(i), p.getZ(i)) - 4); geo.computeVertexNormals();
  terrain = new THREE.Mesh(geo, tm); terrain.frustumCulled = false; scene.add(terrain);
  buildFineTerrain(tm);
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000).rotateX(-Math.PI / 2), seaMat); sea.position.y = -1; scene.add(sea);

  await loadProps(); buildChunks(TR, BD, BR); buildRoads(ROADS); buildStreetProps(SP, SPT); buildBirds(BR);
  window.__stats = { chunks: chunks.length, trees: TR.length / 4, buildings: BD.length / 7 };
  // Poly Haven HDRI (tone-mapped to a 256x128 JPG) as soft image-based lighting for the PBR roads; the visible sky stays the procedural day/sunset/night shader
  try { const envTex = await texLoader.loadAsync('assets/sky_env.jpg?v=' + V); envTex.mapping = THREE.EquirectangularReflectionMapping; envTex.colorSpace = THREE.SRGBColorSpace; scene.environment = envTex; } catch (e) { console.warn('env map skipped', e); }
  buildCollision(BD); initPlayer(); document.getElementById('load').remove(); applyTime('day'); updateChunks(); frame();
}

// ================= COLLISION: oriented building footprints in a spatial grid =================
const CG = 40; const cgrid = new Map(); let BLD = null;
function buildCollision(BD) {
  BLD = BD;
  for (let i = 0; i < BD.length; i += 7) {
    const wx = mx2x(BD[i]), wz = my2z(BD[i + 1]), r = Math.hypot(BD[i + 2], BD[i + 3]) / 2;
    for (let gx = Math.floor((wx - r) / CG); gx <= Math.floor((wx + r) / CG); gx++)
      for (let gz = Math.floor((wz - r) / CG); gz <= Math.floor((wz + r) / CG); gz++) { const k = gx * 73856093 ^ gz * 19349663; let a = cgrid.get(k); if (!a) cgrid.set(k, a = []); a.push(i); }
  }
}
// push a circle (player) out of every box it overlaps; boxes are rotated by BD rot about +Y (three.js convention)
function resolveBuildings(p, rad) {
  const k = Math.floor(p.x / CG) * 73856093 ^ Math.floor(p.z / CG) * 19349663; const list = cgrid.get(k); if (!list) return null;
  let roofY = null;
  for (const i of list) {
    const cx = mx2x(BLD[i]), cz = my2z(BLD[i + 1]), hw = BLD[i + 2] / 2, hd = BLD[i + 3] / 2, h = BLD[i + 4], rot = BLD[i + 5];
    const ext = Math.max(hw, hd); const lo = Math.min(hAt(cx, cz), hAt(cx + ext, cz), hAt(cx - ext, cz), hAt(cx, cz + ext), hAt(cx, cz - ext));
    const base = Math.max(lo, 0) - 1, top = Math.max(hAt(cx, cz), 0) + h;
    const c = Math.cos(rot), s = Math.sin(rot), dx = p.x - cx, dz = p.z - cz;
    // world -> box local. three.js Y rotation maps local (lx,lz) to world (lx*c + lz*s, -lx*s + lz*c), so the inverse is:
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    if (Math.abs(lx) > hw + rad || Math.abs(lz) > hd + rad) continue;
    if (p.y >= top - 0.6) { if (Math.abs(lx) <= hw + rad * 0.5 && Math.abs(lz) <= hd + rad * 0.5) roofY = Math.max(roofY ?? -1e9, top); continue; }
    if (p.y + 1.8 < base) continue;
    let nlx, nlz, push;
    const qx = Math.max(-hw, Math.min(hw, lx)), qz = Math.max(-hd, Math.min(hd, lz));
    const ox = lx - qx, oz = lz - qz, d = Math.hypot(ox, oz);
    if (d > 1e-6) { if (d >= rad) continue; nlx = ox / d; nlz = oz / d; push = rad - d; }
    else { const px = hw - Math.abs(lx), pz = hd - Math.abs(lz);                     // centre is inside the box: exit via nearest face
      if (px < pz) { nlx = Math.sign(lx) || 1; nlz = 0; push = px + rad; } else { nlx = 0; nlz = Math.sign(lz) || 1; push = pz + rad; } }
    const nx = nlx * c + nlz * s, nz = -nlx * s + nlz * c;                            // local normal -> world
    p.x += nx * push; p.z += nz * push;
    const vn = player.vel.x * nx + player.vel.z * nz; if (vn < 0) { player.vel.x -= vn * nx; player.vel.z -= vn * nz; }   // slide along the wall
  }
  return roofY;
}

// ================= CHARACTER: articulated low-poly person =================
const player = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, onGround: false, swimming: false, phase: 0, speed: 0 };
let rig;
function limb(w, h, d, col, pivotTop = true) {
  const g = new THREE.BoxGeometry(w, h, d); if (pivotTop) g.translate(0, -h / 2, 0);
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: col })); return m;
}
function initPlayer() {
  rig = new THREE.Group();
  const skin = 0x9a6a4b, shirt = 0x2f5d3a, jeans = 0x2b3a55, shoe = 0x1b1b1b, hair = 0x161210;
  const hips = new THREE.Group(); hips.position.y = 0.95; rig.add(hips);
  const torso = limb(0.46, 0.62, 0.26, shirt, false); torso.position.y = 0.33; hips.add(torso);
  const neck = new THREE.Group(); neck.position.y = 0.68; hips.add(neck);
  const head = limb(0.24, 0.27, 0.25, skin, false); head.position.y = 0.15; neck.add(head);
  const hairM = limb(0.26, 0.09, 0.27, hair, false); hairM.position.y = 0.3; neck.add(hairM);
  const mk = (x, y, w, h, col, lowCol) => { const up = new THREE.Group(); up.position.set(x, y, 0); const a = limb(w, h, w, col); up.add(a); const kn = new THREE.Group(); kn.position.y = -h; up.add(kn); const b = limb(w * 0.9, h, w * 0.9, lowCol); kn.add(b); return { up, kn }; };
  const armL = mk(-0.3, 0.6, 0.13, 0.33, shirt, skin), armR = mk(0.3, 0.6, 0.13, 0.33, shirt, skin);
  const legL = mk(-0.12, 0.02, 0.17, 0.46, jeans, jeans), legR = mk(0.12, 0.02, 0.17, 0.46, jeans, jeans);
  [armL, armR, legL, legR].forEach(l => hips.add(l.up));
  [legL, legR].forEach(l => { const f = limb(0.17, 0.08, 0.3, shoe, false); f.position.set(0, -0.48, 0.06); l.kn.add(f); });
  rig.userData = { hips, torso, neck, armL, armR, legL, legR };
  scene.add(rig);
  // spawn on a real Los Santos street
  player.pos.set(mx2x(801.4), 0, my2z(250.7)); player.pos.y = groundAt(player.pos.x, player.pos.z);
  camYaw = Math.PI; camPitch = 0.28;
}
function groundAt(x, z) { return Math.max(hAt(x, z), 0); }
const WATER_Y = -1, SEA_H = 0.6;       // terrain at or below SEA_H is open water

// walk/run/jump/swim animation driven by real speed
function animateRig(dt) {
  const u = rig.userData, sp = player.speed, run = Math.min(1, sp / 9);
  player.phase += dt * (sp > 0.3 ? 4 + sp * 0.9 : 0);
  const sw = Math.sin(player.phase), sw2 = Math.sin(player.phase + Math.PI), amp = Math.min(1, sp / 3) * (0.55 + 0.45 * run);
  const t = performance.now() / 1000;
  if (player.swimming) {
    u.legL.up.rotation.x = Math.sin(t * 6) * 0.4; u.legR.up.rotation.x = -Math.sin(t * 6) * 0.4;
    u.armL.up.rotation.x = -2.4 + Math.sin(t * 3) * 0.9; u.armR.up.rotation.x = -2.4 - Math.sin(t * 3) * 0.9;
    u.hips.rotation.x = 1.25; u.hips.position.y = 0.55; return;
  }
  u.hips.rotation.x = run * 0.18;
  if (!player.onGround) {                                    // airborne pose
    u.legL.up.rotation.x = -0.6; u.legL.kn.rotation.x = 0.9; u.legR.up.rotation.x = 0.2; u.legR.kn.rotation.x = 0.4;
    u.armL.up.rotation.x = -0.4; u.armR.up.rotation.x = -0.4; u.armL.up.rotation.z = 0.5; u.armR.up.rotation.z = -0.5; return;
  }
  u.armL.up.rotation.z = 0.06; u.armR.up.rotation.z = -0.06;
  u.legL.up.rotation.x = sw * 0.85 * amp; u.legR.up.rotation.x = sw2 * 0.85 * amp;
  u.legL.kn.rotation.x = Math.max(0, -Math.cos(player.phase)) * 1.3 * amp; u.legR.kn.rotation.x = Math.max(0, Math.cos(player.phase)) * 1.3 * amp;
  u.armL.up.rotation.x = sw2 * 0.7 * amp; u.armR.up.rotation.x = sw * 0.7 * amp;
  u.armL.kn.rotation.x = -0.25 - run * 1.1; u.armR.kn.rotation.x = -0.25 - run * 1.1;
  const breathe = sp < 0.3 ? Math.sin(t * 1.8) * 0.012 : 0;
  u.hips.position.y = 0.95 + Math.abs(Math.cos(player.phase)) * 0.06 * amp - 0.03 * amp + breathe;
  u.torso.scale.set(1, 1 + breathe, 1);
}

// ================= INPUT: keyboard + mouse look (pointer lock) + invisible touch zones, no UI =================
const keys = {}; let camYaw = 0, camPitch = 0.3, camDist = 6.5, lookDX = 0, lookDY = 0, touchMove = { x: 0, y: 0 }, wantJump = false;
addEventListener('keydown', e => { keys[e.code] = true; if (e.code === 'Space') { wantJump = true; e.preventDefault(); }
  if (e.code === 'KeyT') applyTime({ day: 'sunset', sunset: 'night', night: 'day' }[mode]);
  if (e.code === 'KeyQ') { const o = ['lite', 'medium', 'high']; localStorage.setItem('gtar_tier', o[(o.indexOf(tierKey) + 1) % 3]); location.reload(); } });
addEventListener('keyup', e => { keys[e.code] = false; });
canvas.addEventListener('click', () => { if (!('ontouchstart' in window) && document.pointerLockElement !== canvas) canvas.requestPointerLock?.(); });
addEventListener('mousemove', e => { if (document.pointerLockElement === canvas) { lookDX += e.movementX; lookDY += e.movementY; } });
addEventListener('wheel', e => { camDist = Math.min(14, Math.max(2.5, camDist + Math.sign(e.deltaY) * 0.8)); }, { passive: true });
const touches = new Map();
canvas.addEventListener('touchstart', e => { for (const t of e.changedTouches) touches.set(t.identifier, { sx: t.clientX, sy: t.clientY, x: t.clientX, y: t.clientY, left: t.clientX < innerWidth / 2, t0: performance.now() }); e.preventDefault(); }, { passive: false });
canvas.addEventListener('touchmove', e => { for (const t of e.changedTouches) { const o = touches.get(t.identifier); if (!o) continue;
  if (o.left) { touchMove.x = Math.max(-1, Math.min(1, (t.clientX - o.sx) / 60)); touchMove.y = Math.max(-1, Math.min(1, (t.clientY - o.sy) / 60)); }
  else { lookDX += (t.clientX - o.x) * 2.2; lookDY += (t.clientY - o.y) * 2.2; } o.x = t.clientX; o.y = t.clientY; } e.preventDefault(); }, { passive: false });
canvas.addEventListener('touchend', e => { for (const t of e.changedTouches) { const o = touches.get(t.identifier); if (!o) continue;
  if (o.left) touchMove.x = touchMove.y = 0; else if (performance.now() - o.t0 < 220 && Math.hypot(t.clientX - o.sx, t.clientY - o.sy) < 12) wantJump = true;   // quick tap on right side = jump
  touches.delete(t.identifier); } }, { passive: false });

// ================= PHYSICS: accel/friction, gravity, slopes, jumping, swimming, building collision =================
const G = 24, WALK = 4.2, RUN = 9.5, ACC_G = 34, ACC_AIR = 6, FRICTION = 10, JUMP = 7.2, STEP = 0.55, MAX_SLOPE = 0.9, RAD = 0.35;
function stepPhysics(dt) {
  // desired direction relative to camera yaw
  let ix = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0) + touchMove.x;
  let iz = (keys.KeyS || keys.ArrowDown ? 1 : 0) - (keys.KeyW || keys.ArrowUp ? 1 : 0) + touchMove.y;
  const il = Math.hypot(ix, iz); if (il > 1) { ix /= il; iz /= il; }
  const sprint = keys.ShiftLeft || keys.ShiftRight || Math.hypot(touchMove.x, touchMove.y) > 0.92;
  const sinY = Math.sin(camYaw), cosY = Math.cos(camYaw);
  const wx = ix * cosY + iz * sinY, wz = -ix * sinY + iz * cosY;           // camera-relative -> world
  const ground = hAt(player.pos.x, player.pos.z);
  player.swimming = ground <= SEA_H && player.pos.y <= 0.6;
  const target = player.swimming ? 2.6 * (sprint ? 1.5 : 1) : (sprint ? RUN : WALK);
  // slope: compute terrain gradient, slow down when walking uphill, block steep climbs
  const e = 1.5, gx = (hAt(player.pos.x + e, player.pos.z) - hAt(player.pos.x - e, player.pos.z)) / (2 * e), gz = (hAt(player.pos.x, player.pos.z + e) - hAt(player.pos.x, player.pos.z - e)) / (2 * e);
  let uphill = (wx * gx + wz * gz); let slopeMul = player.onGround ? Math.max(0.25, 1 - Math.max(0, uphill) * 0.9) : 1;
  if (player.onGround && uphill > MAX_SLOPE * 1.6) slopeMul = 0;
  const acc = player.onGround || player.swimming ? ACC_G : ACC_AIR;
  const tvx = wx * target * slopeMul, tvz = wz * target * slopeMul;
  const k = 1 - Math.exp(-acc * dt / Math.max(1, target));
  if (il > 0.05) { player.vel.x += (tvx - player.vel.x) * Math.min(1, k * 3); player.vel.z += (tvz - player.vel.z) * Math.min(1, k * 3); }
  else if (player.onGround || player.swimming) { const f = Math.exp(-FRICTION * dt); player.vel.x *= f; player.vel.z *= f; }
  // jump / gravity / buoyancy
  if (wantJump && player.onGround) { player.vel.y = JUMP; player.onGround = false; }
  wantJump = false;
  if (player.swimming) { player.vel.y += ((WATER_Y - 0.8) - player.pos.y) * 6 * dt; player.vel.y *= Math.exp(-3 * dt); }
  else player.vel.y -= G * dt;
  // integrate horizontally in small substeps for stable wall sliding
  const steps = Math.ceil(Math.hypot(player.vel.x, player.vel.z) * dt / 0.25) || 1;
  let roof = null;
  for (let s = 0; s < steps; s++) {
    const ox = player.pos.x, oz = player.pos.z, oyG = Math.max(hAt(ox, oz), -1e9);
    player.pos.x += player.vel.x * dt / steps; player.pos.z += player.vel.z * dt / steps;
    // step limit: can't walk up a sudden cliff (> STEP + slope allowance)
    const ng = hAt(player.pos.x, player.pos.z);
    if (player.onGround && ng - player.pos.y > STEP + 0.6) { player.pos.x = ox; player.pos.z = oz; player.vel.x *= 0.2; player.vel.z *= 0.2; }
    const r = resolveBuildings(player.pos, RAD); if (r !== null) roof = r;
  }
  // keep inside the state
  player.pos.x = Math.max(-HALFW - 400, Math.min(HALFW + 400, player.pos.x)); player.pos.z = Math.max(-HALFW - 400, Math.min(HALFW + 400, player.pos.z));
  player.pos.y += player.vel.y * dt;
  const floor = Math.max(hAt(player.pos.x, player.pos.z), roof ?? -1e9);
  if (!player.swimming && player.pos.y <= floor) { player.pos.y = floor; player.vel.y = 0; player.onGround = true; }
  else if (!player.swimming && player.onGround && player.pos.y - floor < 0.6 && player.vel.y <= 0) { player.pos.y = floor; player.vel.y = 0; }     // stick to ground going downhill
  else player.onGround = false;
  if (player.swimming) player.onGround = false;
  player.speed = Math.hypot(player.vel.x, player.vel.z);
  // face movement direction smoothly
  if (player.speed > 0.4) { const want = Math.atan2(player.vel.x, player.vel.z); let d = want - player.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); player.yaw += d * Math.min(1, dt * 12); }
}

// ================= THIRD-PERSON CAMERA: smooth follow, collision with terrain, sprint FOV kick, head bob =================
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
function updateCamera(dt) {
  camYaw -= lookDX * 0.0024; camPitch = Math.max(-0.35, Math.min(1.2, camPitch + lookDY * 0.0022)); lookDX = lookDY = 0;
  const head = new THREE.Vector3(player.pos.x, player.pos.y + 1.6, player.pos.z);
  const bob = player.onGround ? Math.sin(player.phase * 2) * Math.min(0.05, player.speed * 0.006) : 0;
  const want = new THREE.Vector3(head.x + Math.sin(camYaw) * Math.cos(camPitch) * camDist, head.y + Math.sin(camPitch) * camDist + bob, head.z + Math.cos(camYaw) * Math.cos(camPitch) * camDist);
  // pull the camera in if terrain blocks the view
  for (let i = 1; i <= 6; i++) { const t = i / 6, x = head.x + (want.x - head.x) * t, z = head.z + (want.z - head.z) * t, y = head.y + (want.y - head.y) * t; if (y < hAt(x, z) + 0.4) { want.lerpVectors(head, want, Math.max(0.15, t - 0.17)); want.y = Math.max(want.y, hAt(want.x, want.z) + 0.5); break; } }
  const k = 1 - Math.exp(-dt * 14); camPos.lerp(want, camPos.lengthSq() ? k : 1); camLook.lerp(head, camLook.lengthSq() ? k : 1);
  camera.position.copy(camPos); camera.lookAt(camLook);
  const fov = 62 + Math.min(1, Math.max(0, (player.speed - WALK) / (RUN - WALK))) * 9; if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 5); camera.updateProjectionMatrix(); }
}

// ================= LOOP: fixed-step physics, adaptive quality, paused when hidden =================
const clock = new THREE.Clock(); let acc = 0, frames = 0, fpsT = 0, slow = 0;
camera.near = 0.15; camera.far = 22000; camera.fov = 62; camera.updateProjectionMatrix();
function frame() {
  requestAnimationFrame(frame);
  if (document.hidden) { clock.getDelta(); return; }
  const dt = Math.min(clock.getDelta(), 0.1);
  acc += dt; const H = 1 / 120; let n = 0; while (acc >= H && n < 24) { stepPhysics(H); acc -= H; n++; } if (n >= 24) acc = 0;
  rig.position.copy(player.pos); rig.rotation.y = player.yaw; animateRig(dt);
  updateCamera(dt);
  sun.position.set(player.pos.x + 900, 1400, player.pos.z + 500); sun.target.position.copy(player.pos);
  updateFineTerrain(camera.position.x, camera.position.z); terrain.material.userData.uNear.value.copy(camera.position);
  updateChunks(); updateBirds(performance.now() / 1000, dt);
  renderer.render(scene, camera);
  frames++; fpsT += dt; if (fpsT >= 1) { const fps = frames / fpsT; if (fps < 24) slow++; else slow = Math.max(0, slow - 1); if (slow >= 4 && tierKey !== 'lite') { const o = ['lite', 'medium', 'high']; localStorage.setItem('gtar_tier', o[Math.max(0, o.indexOf(tierKey) - 1)]); location.reload(); } frames = 0; fpsT = 0; }
}
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
main().catch(e => { const l = document.getElementById('load'); if (l) l.innerHTML = 'Failed to load: ' + e.message; console.error(e); });
