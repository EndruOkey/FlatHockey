// GÓLOVÁ KARTA (2026-11-17, Ondřej: „banner by se měl ukazovat vždy při gólu, něco jako v COD killy").
// Po gólu se dole uprostřed vysune karta střelce: banner jako pozadí, profilovka (hlava hráče v jeho barvách z rendereru,
// číslo nebo Discord), jméno, titul a štítek GÓL. Data posílá server (goal.card), definice banneru/titulu = cosmetics.js.
import { Player } from './entities/Player.js';
import { PLAYER } from './constants.js';
import { pickBanner, pickTitle } from './cosmetics.js';
const CSS = `
#goal-card{position:fixed;left:50%;bottom:9vh;z-index:40;width:min(560px,92vw);height:104px;display:grid;grid-template-columns:auto 1fr;gap:16px;align-items:center;
  padding:0 26px 0 18px;color:#F2F6FB;font-family:Barlow,system-ui,sans-serif;clip-path:polygon(0 0,100% 0,calc(100% - 26px) 100%,0 100%);pointer-events:none;
  transform:translate(-50%,40px);opacity:0;transition:transform .35s cubic-bezier(.2,.9,.25,1.2),opacity .25s ease}
#goal-card.on{transform:translate(-50%,0);opacity:1}
#goal-card::before{content:'';position:absolute;inset:0;background:linear-gradient(90deg,rgba(5,10,20,.25),rgba(5,10,20,.88) 52%),var(--ban);z-index:-1}
#goal-card::after{content:'';position:absolute;left:0;top:0;bottom:0;width:7px;background:var(--team,#E4002B)}
#goal-card .av{width:74px;height:74px;border-radius:50%;overflow:hidden;border:3px solid var(--team,#E4002B);background:#13203d;display:grid;place-items:center;font:italic 900 34px/1 'Barlow Condensed'}
#goal-card .av canvas,#goal-card .av img{width:100%;height:100%;display:block;object-fit:cover}
#goal-card .lbl{display:inline-block;padding:3px 12px 3px 8px;background:#E4002B;font:italic 900 16px/1 'Barlow Condensed';letter-spacing:.12em;clip-path:polygon(0 0,100% 0,calc(100% - 10px) 100%,0 100%)}
#goal-card .nm{font:italic 900 40px/.95 'Barlow Condensed';text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:4px}
#goal-card .tt{font:italic 800 17px/1 'Barlow Condensed';color:#FFB020;letter-spacing:.06em;text-transform:uppercase;margin-top:3px}
@media (prefers-reduced-motion:reduce){#goal-card{transition:opacity .2s}}`;
let el = null, timer = 0;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function head(c, ent) {   // hlava střelce ve skutečných barvách (stejný renderer jako hra)
  const p = new Player('gc', ent?.team || 'home', null); p._dispReach = PLAYER.stickLen; p.charge = 0; p._dispCharge = 0; p.passReq = 0; p.crossCheck = false; p.name = '';
  for (const k of ['color', 'stripe', 'helmet', 'gloves', 'shorts', 'stick', 'tape', 'visor', 'helmetType', 'jersey', 'num', 'size', 'handed']) if (ent && ent[k] != null) p[k] = ent[k];
  const g = c.getContext('2d'), S = c.height / 13;
  for (let f = 0; f < 3; f++) { g.fillStyle = '#dfeaf3'; g.fillRect(0, 0, c.width, c.height); p.x = 500; p.y = 200; p.bodyAngle = p.skateAngle = -Math.PI / 2; p.vx = p.vy = 0; p.aimAngle = p.carryAngle = p._stickDisp = -Math.PI / 2 + 0.6;
    try { p.draw(g, { scale: S, ox: c.width / 2 - 500 * S, oy: c.height * .72 - 200 * S, dt: 1 / 60 }); } catch {} }
}
export function showGoalCard({ card, scorer, teamColor, ent, en }) {
  if (!card || typeof document === 'undefined') return;
  if (!el) { const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st); el = document.createElement('div'); el.id = 'goal-card'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  const b = pickBanner(card.bn), t = pickTitle(card.tt);   // klient už jen zobrazí (odemčení ověřil server)
  el.style.setProperty('--ban', b.bg); el.style.setProperty('--team', teamColor || '#E4002B');
  const av = card.av === 'discord' && card.au ? `<img src="${esc(card.au)}" alt="">` : card.av === 'num' ? esc(card.num ?? '#') : '<canvas width="148" height="148"></canvas>';
  el.innerHTML = `<div class="av">${av}</div><div style="min-width:0"><span class="lbl">${en ? 'GOAL' : 'GÓL'}</span><div class="nm">${esc(scorer || '')}${card.num != null ? ` <span style="color:var(--team)">${esc(card.num)}</span>` : ''}</div><div class="tt">${en ? t.en : t.cs}</div></div>`;
  const cv = el.querySelector('canvas'); if (cv) head(cv, ent);
  el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
  clearTimeout(timer); timer = setTimeout(() => el && el.classList.remove('on'), 2600);
}
