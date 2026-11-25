// 2D fallback: the real San Andreas map with pan/zoom + all landmarks. Works without WebGL.
const load = document.getElementById('load'); if (load) load.remove();
document.getElementById('c').style.display = 'none';
const MAP = 1000;
const wrap = document.createElement('div');
wrap.style.cssText = 'position:fixed;inset:0;overflow:hidden;background:#1d3b4a;cursor:grab;touch-action:none';
const stage = document.createElement('div'); stage.style.cssText = 'position:absolute;left:0;top:0;transform-origin:0 0';
const img = new Image(); img.src = 'assets/sa_aerial.jpg'; img.draggable = false; img.style.cssText = 'display:block;width:2000px;height:2000px;user-select:none';
stage.appendChild(img); wrap.appendChild(stage); document.body.prepend(wrap);
const SZ = 2000, K = SZ / MAP; // px per map unit
let sc = Math.min(innerWidth, innerHeight) / SZ, tx = (innerWidth - SZ * sc) / 2, ty = (innerHeight - SZ * sc) / 2;
const apply = () => { stage.style.transform = `translate(${tx}px,${ty}px) scale(${sc})`; stage.querySelectorAll('.pin').forEach(p => p.style.transform = `translate(-50%,-100%) scale(${1 / sc})`); };
const hud = document.getElementById('hud');
hud.innerHTML = '<b>2D map mode</b> (your browser has no WebGL, so showing the flat map)<br>Drag = pan &nbsp; Wheel / pinch = zoom &nbsp; Tap a pin for its name<br><small>3D version loads automatically on a device with WebGL</small>';
const legend = document.getElementById('legend');
legend.innerHTML = '<b>Regions</b> <small>(click to zoom)</small>';
const regions = [['Los Santos', 860, 255], ['San Fierro', 165, 560], ['Las Venturas', 690, 700], ['Mount Chiliad', 330, 810], ['Bone County', 150, 800], ['Red County', 780, 400], ['Flint County', 200, 330], ['Tierra Robada', 120, 760]];
function zoomTo(mx, my, z) { sc = z; tx = innerWidth / 2 - mx * K * sc; ty = innerHeight / 2 - (MAP - my) * K * sc; stage.style.transition = 'transform .6s'; apply(); setTimeout(() => stage.style.transition = '', 650); }
regions.forEach(r => {
  const d = document.createElement('div'); d.textContent = r[0]; d.onclick = () => zoomTo(r[1], r[2], 0.9); legend.appendChild(d);
  const t = document.createElement('div'); t.textContent = r[0].toUpperCase(); t.className = 'pin';
  t.style.cssText = `position:absolute;left:${r[1] * K}px;top:${(MAP - r[2]) * K}px;color:#ffd54a;font:800 22px system-ui;text-shadow:0 0 5px #000,0 0 5px #000,0 0 8px #000;white-space:nowrap;pointer-events:none;transform-origin:50% 100%`;
  stage.appendChild(t);
});
document.getElementById('info').textContent = 'San Andreas (2D)';
const pt = f => f.geometry.type === 'Point' ? f.geometry.coordinates : (c => c.reduce((a, q) => [a[0] + q[0] / c.length, a[1] + q[1] / c.length], [0, 0]))(f.geometry.coordinates[0]);
const seen = new Set();
Promise.all(['airports', 'buildings', 'homes', 'schools'].map(k => fetch(`assets/${k}.json`).then(r => r.json()).then(d => [k, d]))).then(all => {
  const col = { airports: '#6cc4ff', buildings: '#ff6b6b', homes: '#7cfc8a', schools: '#ffa94d' };
  all.forEach(([k, data]) => data.forEach(f => {
    const [mx, my] = pt(f), name = f.properties.name || k, key = name + Math.round(mx / 20) + Math.round(my / 20);
    if (seen.has(key)) return; seen.add(key);
    const p = document.createElement('div'); p.className = 'pin'; p.title = name;
    p.style.cssText = `position:absolute;left:${mx * K}px;top:${(MAP - my) * K}px;transform-origin:50% 100%;display:flex;flex-direction:column;align-items:center;font:700 12px system-ui;color:#fff;text-shadow:0 0 4px #000,0 0 4px #000;white-space:nowrap`;
    p.innerHTML = `<span>${name === 'Safehouse' ? '' : name}</span><i style="width:12px;height:12px;border-radius:50%;background:${col[k]};border:2px solid #fff;display:block"></i>`;
    stage.appendChild(p);
  }));
  apply();
});
let drag = null;
wrap.addEventListener('pointerdown', e => { drag = [e.clientX, e.clientY, tx, ty]; wrap.style.cursor = 'grabbing'; wrap.setPointerCapture(e.pointerId); });
wrap.addEventListener('pointermove', e => { if (!drag) return; tx = drag[2] + e.clientX - drag[0]; ty = drag[3] + e.clientY - drag[1]; apply(); });
wrap.addEventListener('pointerup', () => { drag = null; wrap.style.cursor = 'grab'; });
wrap.addEventListener('wheel', e => { e.preventDefault(); const z = Math.min(2.5, Math.max(0.2, sc * (e.deltaY < 0 ? 1.15 : 1 / 1.15))); tx = e.clientX - (e.clientX - tx) * z / sc; ty = e.clientY - (e.clientY - ty) * z / sc; sc = z; apply(); }, { passive: false });
apply();
