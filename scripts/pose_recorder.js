// Rekordér nepřirozených poloh (vložit do konzole hry, F12 → Console). F9 = uloží posledních 2 s kolem vlastního hráče
// jako VIDEO (WebM, zpomaleně 0,5×, s daty pohybu) do Stažených souborů: fh_pose_<čas>.webm
(() => {
if (window.__fhRec) return 'rekordér už běží';
const N = 60, BOX = 150, W = 320; const buf = []; let fr = 0, camK = null, busy = false;
const findCam = g => { const ok = v => v && typeof v.scale === 'number' && typeof v.ox === 'number' && typeof v.oy === 'number';
  if (camK) { const v = camK.reduce((o, k) => o && o[k], g); if (ok(v)) return v; }
  for (const k of Object.keys(g)) { const v = g[k]; if (ok(v)) { camK = [k]; return v; }
    if (v && typeof v === 'object') for (const k2 of Object.keys(v).slice(0, 80)) if (ok(v[k2])) { camK = [k, k2]; return v[k2]; } }
  return null; };
const tick = async () => { requestAnimationFrame(tick); const g = window.__fhGame; if (!g || !g.local || fr++ % 2) return;
  const cam = findCam(g), cv = g.canvas || document.querySelector('canvas'); if (!cam || !cv) return;
  const L = g.local, k = cv.width / cv.getBoundingClientRect().width, sx = (cam.ox + L.x * cam.scale) * k, sy = (cam.oy + L.y * cam.scale) * k, h = BOX * k / 2;   // kamera v CSS px → px canvasu
  try { const bm = await createImageBitmap(cv, Math.round(sx - h), Math.round(sy - h), Math.round(2 * h), Math.round(2 * h), { resizeWidth: W, resizeHeight: W });
    buf.push({ bm, d: `v ${Math.hypot(L.vx||0, L.vy||0).toFixed(0)}  brzda ${(L._stopK3||0).toFixed(1)}  nápřah ${(L._dispCharge||0).toFixed(1)}${L.crossCheck?'  CC':''}${L.hasPuck?'  puk':''}` });
    if (buf.length > N) buf.shift().bm.close(); } catch (e) { console.warn('[fhrec]', e); } };
addEventListener('keydown', e => { if (e.code !== 'F9') return; e.preventDefault(); e.stopPropagation();
  if (busy) { console.warn('[fhrec] ukládám předchozí klip…'); return; }
  if (buf.length < 5) { console.warn('[fhrec] prázdný buffer — běží zápas?'); return; }
  const fs = buf.splice(0);   // snímky převzít (snímání je jinak zavírá → „detached“), zavřou se po uložení
  busy = true; const H = W + 26, o = document.createElement('canvas'); o.width = W; o.height = H; const x = o.getContext('2d');
  const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'], mt = types.find(t => MediaRecorder.isTypeSupported(t));
  const stream = o.captureStream(30), rec = new MediaRecorder(stream, { mimeType: mt, videoBitsPerSecond: 4e6 }), chunks = [];
  rec.ondataavailable = ev => ev.data.size && chunks.push(ev.data);
  rec.onstop = () => { const a = document.createElement('a'); a.download = `fh_pose_${Date.now()}.webm`; a.href = URL.createObjectURL(new Blob(chunks, { type: 'video/webm' })); a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000); fs.forEach(f => f.bm.close()); busy = false; console.log('[fhrec] uloženo', a.download); };
  const draw = i => { x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.drawImage(fs[i].bm, 0, 0); x.font = '14px sans-serif';
    x.fillStyle = '#c00'; x.fillText(`${i + 1}/${fs.length}  ·  0,5×`, 6, 18); x.fillStyle = '#000'; x.fillText(fs[i].d, 6, W + 18); };
  draw(0); rec.start(); let i = 0;
  const step = () => { draw(i); if (++i < fs.length) setTimeout(step, 66); else setTimeout(() => rec.stop(), 300); };   // snímky po 33 ms → přehrání po 66 ms = 0,5×
  step();
  const fl = document.createElement('div'); fl.style.cssText = 'position:fixed;inset:0;border:8px solid #ff3;pointer-events:none;z-index:99999'; document.body.appendChild(fl); setTimeout(() => fl.remove(), 300);
}, true);
window.__fhRec = true; requestAnimationFrame(tick); return 'rekordér běží — F9 uloží video do Stažených souborů';
})();
