// Rekordér nepřirozených poloh (vložit do konzole hry, F12 → Console). F9 = uloží posledních 2 s kolem vlastního hráče
// jako PNG (30 snímků + data pohybu) do Stažených souborů: fh_pose_<čas>.png
(() => {
if (window.__fhRec) return 'rekordér už běží';
const N = 60, BOX = 150, W = 220; const buf = []; let fr = 0, camK = null;
const findCam = g => { const ok = v => v && typeof v.scale === 'number' && typeof v.ox === 'number' && typeof v.oy === 'number';
  if (camK) { const v = camK.reduce((o, k) => o && o[k], g); if (ok(v)) return v; }
  for (const k of Object.keys(g)) { const v = g[k]; if (ok(v)) { camK = [k]; return v; }
    if (v && typeof v === 'object') for (const k2 of Object.keys(v).slice(0, 80)) if (ok(v[k2])) { camK = [k, k2]; return v[k2]; } }
  return null; };
const tick = async () => { requestAnimationFrame(tick); const g = window.__fhGame; if (!g || !g.local || fr++ % 2) return;
  const cam = findCam(g), cv = g.canvas || document.querySelector('canvas'); if (!cam || !cv) return;
  const L = g.local, k = cv.width / cv.getBoundingClientRect().width, sx = (cam.ox + L.x * cam.scale) * k, sy = (cam.oy + L.y * cam.scale) * k, h = BOX * k / 2;   // kamera v CSS px → px canvasu
  try { const bm = await createImageBitmap(cv, Math.round(sx - h), Math.round(sy - h), Math.round(2 * h), Math.round(2 * h), { resizeWidth: W, resizeHeight: W });
    buf.push({ bm, d: `v${Math.hypot(L.vx||0, L.vy||0).toFixed(0)} st${(L._stopK3||0).toFixed(1)} ch${(L._dispCharge||0).toFixed(1)}${L.crossCheck?' CC':''}${L.hasPuck?' P':''}` });
    if (buf.length > N) buf.shift().bm.close(); } catch (e) { console.warn('[fhrec]', e); } };
addEventListener('keydown', e => { if (e.code !== 'F9') return; e.preventDefault(); e.stopPropagation();
  const fs = buf.filter((_, j) => j % 2 === 0), cols = 6, rows = Math.ceil(fs.length / cols), H = W + 18;
  if (!fs.length) { console.warn('[fhrec] prázdný buffer — běží zápas?'); return; }
  const o = document.createElement('canvas'); o.width = cols * W; o.height = rows * H; const x = o.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, o.width, o.height); x.font = '13px sans-serif';
  fs.forEach((f, j) => { const X = (j % cols) * W, Y = Math.floor(j / cols) * H; x.drawImage(f.bm, X, Y); x.fillStyle = '#c00'; x.fillText(`${j * 2}`, X + 4, Y + 15); x.fillStyle = '#000'; x.fillText(f.d, X + 4, Y + W + 14); });
  const a = document.createElement('a'); a.download = `fh_pose_${Date.now()}.png`; a.href = o.toDataURL('image/png'); a.click();
  const fl = document.createElement('div'); fl.style.cssText = 'position:fixed;inset:0;border:8px solid #ff3;pointer-events:none;z-index:99999'; document.body.appendChild(fl); setTimeout(() => fl.remove(), 300);
  console.log('[fhrec] uloženo', a.download); }, true);
window.__fhRec = true; requestAnimationFrame(tick); return 'rekordér běží — F9 uloží klip do Stažených souborů';
})();
