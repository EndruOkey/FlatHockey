// Profilovka Discord bota (webhooku) — 3 varianty 512×512, hráč vykreslený HERNÍM KÓDEM.
// Deterministické: pevné hodnoty stavu, pevné hodiny, seedovaný Math.random při kreslení.
// Spuštění: node scripts/bot-avatar.mjs <base-url> <výstupní-složka>   (např. http://localhost:4830 out)
// Výstup: avatar-hrac.png, avatar-fh.png, avatar-kombo.png (+ náhled-32.png: všechny tři v 32 px a kruhovém ořezu)
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const [base, out] = process.argv.slice(2);
if (!base || !out) { console.error('použití: node scripts/bot-avatar.mjs <base-url> <složka>'); process.exit(1); }
fs.mkdirSync(out, { recursive: true });
const S = 512;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: S, height: S } });
const errs = []; page.on('pageerror', e => errs.push(e.message));
await page.goto(base + '/api/season');
await page.setContent(`<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@1,800;1,900&display=swap" rel="stylesheet">
<style>html,body{margin:0;background:#000}</style><canvas id=c width=${S} height=${S}></canvas>`);
await page.evaluate(() => document.fonts.load('italic 900 100px "Barlow Condensed"'));
await page.waitForTimeout(300);

const result = await page.evaluate(async (S) => {
  let fr = 0; Date.now = () => 1.8e12 + fr; performance.now = () => fr;
  let a = 20261115; Math.random = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const B = location.origin + '/js/';
  const { Player } = await import(B + 'entities/Player.js');
  const { Puck } = await import(B + 'entities/Puck.js');
  const inp = { dx: 0, dy: 0, lmb: false, rmb: false, mmb: false, aim: 0, aimDist: 100, keys: { Space: false },
    lmbJustPressed: false, lmbJustReleased: false, rmbJustPressed: false, mmbJustPressed: false };
  const ctx = document.getElementById('c').getContext('2d');
  const C = { bg: '#050A14', ice: '#DCEBF7', red: '#E4002B', red2: '#A8001F', iceA: '#7FD4FF', text: '#F2F6FB' };

  // hráč: červený dres (barva hry #E4002B), číslo 9, jede doprava nahoru s pukem na čepeli
  const mkPlayer = () => {
    const p = new Player('bot', 'home', { ...inp });
    p.x = 0; p.y = 0; p.vx = 60; p.vy = -30;
    p.bodyAngle = -0.45; p.skateAngle = -0.45; p.aimAngle = -0.2; p._stickRel = 0.25;
    p.color = '#E4002B'; p.num = 9; p.name = ''; p.hasPuck = true;
    const k = new Puck(); const t = p.stickTip; k.x = t.x; k.y = t.y; k.z = 0; k.vx = 0; k.vy = 0;
    p._puckView = k; p._solids = []; p._others = [p]; p._isLocal = false;
    return { p, k };
  };
  const drawPlayer = (cx, cy, scale) => {
    const { p, k } = mkPlayer();
    // střed kompozice = mezi tělem a pukem
    const t = p.stickTip, mx = p.x + (t.x - p.x) * 0.35, my = p.y + (t.y - p.y) * 0.35;   // těžiště blíž tělu
    const cam = { scale, ox: cx - mx * scale, oy: cy - my * scale };
    k.draw(ctx, cam); p.draw(ctx, cam);
  };
  const shots = {};
  const save = (name) => { shots[name] = document.getElementById('c').toDataURL('image/png').slice(22); };

  // 1) HRÁČ na ledě, jemná modrá čára
  ctx.fillStyle = C.ice; ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = '#C9DDEE'; ctx.fillRect(0, S * 0.70, S, S * 0.06);
  drawPlayer(S / 2, S / 2, 11);
  save('avatar-hrac');

  // 2) MONOGRAM FH
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, S, S);
  ctx.save(); ctx.translate(S / 2, S / 2); ctx.transform(1, 0, -0.18, 1, 0, 0);
  ctx.fillStyle = C.red; ctx.fillRect(-150, 92, 300, 22);          // červená „čepel" pod písmem
  ctx.restore();
  ctx.font = 'italic 900 300px "Barlow Condensed"'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = C.text; ctx.fillText('F', S / 2 - 62, S / 2 + 92);
  ctx.fillStyle = C.red; ctx.fillText('H', S / 2 + 66, S / 2 + 92);
  save('avatar-fh');

  // 3) KOMBO: tmavé pozadí, ledový kruh, hráč, červený prstenec
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, S, S);
  ctx.beginPath(); ctx.arc(S / 2, S / 2, S * 0.40, 0, Math.PI * 2); ctx.fillStyle = C.ice; ctx.fill();
  ctx.lineWidth = 16; ctx.strokeStyle = C.red; ctx.stroke();
  ctx.save(); ctx.beginPath(); ctx.arc(S / 2, S / 2, S * 0.40 - 8, 0, Math.PI * 2); ctx.clip();
  drawPlayer(S / 2, S / 2, 9); ctx.restore();
  save('avatar-kombo');
  return shots;
}, S);
for (const [n, b64] of Object.entries(result)) fs.writeFileSync(path.join(out, n + '.png'), Buffer.from(b64, 'base64'));

// náhled: každá varianta v kruhu 256 / 64 / 32 px (jak ji uvidí Discord)
const html = `<style>body{margin:0;background:#313338;display:flex;gap:28px;padding:20px;align-items:center;font:12px sans-serif;color:#ccc}
div{display:flex;flex-direction:column;gap:10px;align-items:center}img{border-radius:50%}</style>` +
  Object.keys(result).map(n => { const u = 'data:image/png;base64,' + result[n];
    return `<div><img src="${u}" width=256><span style="display:flex;gap:10px;align-items:center"><img src="${u}" width=64><img src="${u}" width=32></span>${n}</div>`; }).join('');
const pv = await browser.newPage({ viewport: { width: 940, height: 400 } });
await pv.setContent(html); await pv.waitForTimeout(200);
await pv.screenshot({ path: path.join(out, 'nahled-discord.png') });
await browser.close();
if (errs.length) { console.error('chyba kreslení:', errs[0]); process.exit(1); }
console.log('hotovo:', Object.keys(result).join(', '));
