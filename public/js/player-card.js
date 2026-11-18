// KARTA HRÁČE z žebříčku (2026-11-18) — stejná karta jako v šatně: banner, hráč v jeho výbavě, číslo, titul, statistiky, velikost a hůl.
// Data = řádek /api/leaderboard (profil z DB). Banner a titul se zobrazí jen odemčené (pickBanner/pickTitle se statistikami řádku).
import { Player } from './entities/Player.js';
import { PLAYER } from './constants.js';
import { pickBanner, pickTitle } from './cosmetics.js';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const SZ = [['Malý', 'Small', 'Rychlík', 'Speedster'], ['Střední', 'Medium', 'Univerzál', 'All-round'], ['Velký', 'Large', 'Tank', 'Tank']];
const ST = [['Krátká', 'Short', 15], ['Střední', 'Medium', 16], ['Dlouhá', 'Long', 17.4]];
const CSS = `
#fhpc{position:fixed;inset:0;z-index:60;display:grid;place-items:center;background:rgba(2,6,15,.72);backdrop-filter:blur(3px)}
#fhpc .pc{position:relative;width:min(380px,calc(100vw - 32px));background:#0B1730;border:1px solid rgba(255,255,255,.12);clip-path:var(--a3-cut-panel,polygon(0 0,calc(100% - 18px) 0,100% 18px,100% 100%,18px 100%,0 calc(100% - 18px)));color:#F2F6FB;font-family:Barlow,system-ui,sans-serif;overflow:hidden}
#fhpc .bn{position:absolute;inset:0 0 auto 0;height:190px}
#fhpc .bn::after{content:'';position:absolute;inset:0;background:linear-gradient(180deg,rgba(11,23,48,0) 40%,#0B1730)}
#fhpc .hero{position:relative;margin:46px 24px 0;height:200px;background:#dfeaf3;box-shadow:0 0 0 1px rgba(255,255,255,.2)}
#fhpc .hero canvas{width:100%;height:100%;display:block}
#fhpc .num{position:absolute;right:30px;top:178px;font:italic 900 72px/1 'Barlow Condensed';color:#fff;-webkit-text-stroke:3px #0b1220;paint-order:stroke fill}
#fhpc .bd{position:relative;padding:14px 24px 20px}
#fhpc .nm{font:italic 900 38px/.95 'Barlow Condensed';text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#fhpc .tt{display:inline-block;margin-top:6px;padding:4px 12px 4px 8px;background:var(--a3-amber,#FFB020);color:#0b1220;font:italic 900 14px/1 'Barlow Condensed';letter-spacing:.08em;text-transform:uppercase;clip-path:polygon(0 0,100% 0,calc(100% - 9px) 100%,0 100%)}
#fhpc .st{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:14px}
#fhpc .st div{padding:8px 8px 7px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08)}
#fhpc .st b{display:block;font:italic 900 24px/1 'Barlow Condensed'}#fhpc .st span{font:700 13px/1.2 Barlow;color:#A9BBD1;text-transform:uppercase;letter-spacing:.06em}
#fhpc .bl{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px}
#fhpc .bl div{padding:8px;background:rgba(127,212,255,.08);border-left:3px solid var(--a3-ice,#7FD4FF);font:700 13px/1.3 Barlow;color:#A9BBD1;text-transform:uppercase}
#fhpc .bl b{display:block;font:italic 800 18px/1.1 'Barlow Condensed';color:#fff}
#fhpc .x{position:absolute;right:10px;top:10px;z-index:2;width:36px;height:36px;border:0;background:rgba(5,10,20,.7);color:#fff;font:900 18px/1 Barlow;cursor:pointer;clip-path:var(--a3-cut,none)}
`;
export function showPlayerCard(r, en = false) {
  if (typeof document === 'undefined' || !r) return;
  if (!document.getElementById('fhpc-css')) { const s = document.createElement('style'); s.id = 'fhpc-css'; s.textContent = CSS; document.head.appendChild(s); }
  document.getElementById('fhpc')?.remove();
  const stats = { goals: r.goals, assists: r.assists, wins: r.wins, games_played: r.games_played, rank_points: r.rank_points };
  const ti = pickTitle(r.card_title, stats), bn = pickBanner(r.banner, stats);
  const sz = [0, 1, 2].includes(r.size) ? r.size : 1, sl = [0, 1, 2].includes(r.stick_len) ? r.stick_len : 1, L = en ? 1 : 0;
  const gp = r.games_played ?? 0, wr = gp ? Math.round((r.wins ?? 0) / gp * 100) + '%' : '—';
  const el = document.createElement('div'); el.id = 'fhpc';
  el.innerHTML = `<div class="pc" role="dialog" aria-label="${esc(r.display_name)}"><div class="bn" style="background:${bn.bg}"></div>
    <button type="button" class="x" aria-label="${en ? 'Close' : 'Zavřít'}">✕</button>
    <div class="hero"><canvas></canvas></div>${r.number != null ? `<div class="num">${esc(r.number)}</div>` : ''}
    <div class="bd"><div class="nm">${esc(r.display_name || 'Player')}</div><span class="tt">★ ${esc(en ? ti.en : ti.cs)}</span>
      <div class="st"><div><b>${r.rank_points ?? 1000}</b><span>ELO</span></div><div><b>${r.goals ?? 0}</b><span>${en ? 'Goals' : 'Góly'}</span></div><div><b>${r.assists ?? 0}</b><span>${en ? 'Assists' : 'Asist.'}</span></div>
        <div><b>${gp}</b><span>${en ? 'Games' : 'Zápasy'}</span></div><div><b>${wr}</b><span>${en ? 'Win %' : 'Výhry'}</span></div><div><b>${(r.plus_minus ?? 0) > 0 ? '+' : ''}${r.plus_minus ?? 0}</b><span>+/−</span></div></div>
      <div class="bl"><div>${en ? 'Size' : 'Velikost'}<b>${SZ[sz][L]} · ${SZ[sz][L + 2]}</b></div><div>${en ? 'Stick' : 'Hokejka'}<b>${ST[sl][L]}</b></div></div></div></div>`;
  document.body.appendChild(el);
  const close = () => { el.remove(); removeEventListener('keydown', onKey, true); };
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  addEventListener('keydown', onKey, true);
  el.addEventListener('click', e => { if (e.target === el || e.target.closest('.x')) close(); });
  // hráč v jeho výbavě (stejný renderer jako hra a šatna)
  const c = el.querySelector('canvas'), rc = c.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
  c.width = Math.round(rc.width * dpr); c.height = Math.round(rc.height * dpr);
  const p = new Player('fhpc', 'home', null); p.charge = 0; p._dispCharge = 0; p.passReq = 0; p.crossCheck = false; p.name = '';
  const map = { jersey: 'color', stripe: 'stripe', helmet: 'helmet', gloves: 'gloves', shorts: 'shorts', stick: 'stick', tape: 'tape', visor: 'visor', helmet_type: 'helmetType', handed: 'handed', number: 'num' };
  for (const [k, v] of Object.entries(map)) if (r[k] != null) p[v] = r[k];
  p.size = sz; const g = c.getContext('2d'), s0 = Math.min(c.height / 30, c.width / 36) * 0.85;
  for (let f = 0; f < 3; f++) { g.fillStyle = '#dfeaf3'; g.fillRect(0, 0, c.width, c.height); p._dispReach = ST[sl][2] ?? PLAYER.stickLen; p.x = 500; p.y = 200; p.bodyAngle = p.skateAngle = -Math.PI / 2; p.vx = p.vy = 0; p.aimAngle = p.carryAngle = p._stickDisp = -Math.PI / 2 + 0.6;
    try { p.draw(g, { scale: s0, ox: c.width / 2 - 500 * s0, oy: c.height * .58 - 200 * s0, dt: 1 / 60 }); } catch {} }
  el.querySelector('.x').focus();
  return el;
}
