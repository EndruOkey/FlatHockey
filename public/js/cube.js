// KOSTKA (center-hung scoreboard) — 2026-11-18, schváleno Ondřejem (náhled v6: „kostka je insane, to je ono").
// Rešerše (tmp/cube/research/kostka_research.md): 4 vrstvy (horní prstenec / stěna s rohy / spodní prstenec / underbelly), čelní pohled,
// v klidu jen underbelly se skóre a časem (≤ 7 % výšky), skóre vidět v každé fázi, příchod ≤ 400 ms ease-out, odchod ease-in.
// Gól (vzor led-ticker-hockey): 3× bliknutí barvy týmu s vyříznutým GOAL (perioda 340 ms ≈ 2,9 Hz ≤ 3 Hz, WCAG 2.3.1), pak karta střelce
// (banner ze šatny, obří číslo, profilovka, jméno po písmenech, titul, asistence, góly v zápase / sezóně), skóre se přepíše až v doba 2.
// Průběh = čistá funkce set(t) (ms od gólu) → deterministicky testovatelná (scripts/cube_test.mjs krokuje po 40 ms).
// Omezený pohyb (prefers-reduced-motion): bez blikání, blesků a houpání; posuny zůstávají (jinak by animaci Ondřej neviděl vůbec).
import { Player } from './entities/Player.js';
import { PLAYER } from './constants.js';
import { pickBanner, pickTitle } from './cosmetics.js';
const W = 520, H = 170, RING = 30, UBH = 46, UBW = 364, CW = Math.round(W * 0.12);
const UB_TOP = RING + H + 8;   // poloha underbelly v kostce; v klidu je kostka posunutá o −UB_TOP (vidět jen underbelly)
const DUR = 1900;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cl = (x, a, b) => Math.max(a, Math.min(b, x));
const eOutExpo = x => x >= 1 ? 1 : 1 - Math.pow(2, -10 * x), eIn = x => x * x * x, eOut = x => 1 - Math.pow(1 - x, 3);
const STICKS = `<svg viewBox="0 0 40 60" width="34" height="52" aria-hidden="true"><g stroke="#0b1220" stroke-width="6" stroke-linecap="round"><path d="M8 6 L30 46 h6"/><path d="M32 6 L10 46 h-6"/></g><g stroke="#F2F6FB" stroke-width="3" stroke-linecap="round"><path d="M8 6 L30 46 h6"/><path d="M32 6 L10 46 h-6"/></g><ellipse cx="20" cy="54" rx="8" ry="4" fill="#0b1220"/></svg>`;
const CSS = `
#fhcube{position:fixed;left:50%;top:0;width:0;z-index:30;pointer-events:none;font-family:Barlow,system-ui,sans-serif;color:#F2F6FB}
#fhcube *{box-sizing:border-box}#fhcube .a{position:absolute;left:0}
#fhcube .led{background-color:#0f2550;background-image:radial-gradient(circle,rgba(127,212,255,.55) 1px,transparent 1.5px);background-size:4px 4px}
#fhcube .ub{display:flex;align-items:center;justify-content:center;gap:16px;height:100%;font:italic 900 30px/1 'Barlow Condensed';text-transform:uppercase}
#fhcube .ub .t{font:italic 800 13px/1 'Barlow Condensed';letter-spacing:.12em;max-width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#fhcube .ub .clk{font:700 22px/1 'JetBrains Mono',monospace;text-align:center}
#fhcube .chase{white-space:nowrap;font:italic 900 14px/1 'Barlow Condensed';letter-spacing:.3em;overflow:hidden;display:flex;align-items:center}
#fhcube .goalw{position:absolute;left:0;right:0;top:50%;text-align:center;font:italic 900 96px/.8 'Barlow Condensed';letter-spacing:.04em;color:#fff;-webkit-text-stroke:3px #0b1220;paint-order:stroke fill;text-shadow:5px 5px 0 #E4002B}
#fhcube .c6{position:absolute;inset:0;opacity:0}
#fhcube .c6 .bn{position:absolute;inset:0}
#fhcube .c6 .sh{position:absolute;inset:0;background:linear-gradient(90deg,rgba(5,10,20,.15) 0,rgba(5,10,20,.55) 30%,rgba(5,10,20,.92) 62%)}
#fhcube .c6 .num{position:absolute;right:-8px;top:-34px;font:italic 900 230px/1 'Barlow Condensed';color:transparent;-webkit-text-stroke:3px rgba(127,212,255,.55)}
#fhcube .c6 .avb{position:absolute;left:20px;top:22px;width:126px;height:126px;border-radius:50%;border:5px solid var(--tc);background:#13203d;box-shadow:0 0 0 4px #0b1220;display:grid;place-items:center;font:italic 900 56px/1 'Barlow Condensed';overflow:hidden}
#fhcube .c6 .avb canvas,#fhcube .c6 .avb img{width:100%;height:100%;display:block;object-fit:cover}
#fhcube .c6 .meta{position:absolute;left:166px;top:22px;right:20px}
#fhcube .c6 .row1{display:flex;align-items:center;gap:8px}
#fhcube .c6 .chipG{padding:4px 14px 4px 9px;background:#E4002B;font:italic 900 17px/1 'Barlow Condensed';letter-spacing:.16em;clip-path:polygon(0 0,100% 0,calc(100% - 10px) 100%,0 100%)}
#fhcube .c6 .stat{font:italic 800 14px/1 'Barlow Condensed';letter-spacing:.1em;color:#7FD4FF;text-transform:uppercase}
#fhcube .c6 .big{margin-top:6px;font:italic 900 52px/.86 'Barlow Condensed';text-transform:uppercase;white-space:nowrap;overflow:hidden;-webkit-text-stroke:2px #0b1220;paint-order:stroke fill}
#fhcube .c6 .big span{display:inline-block}
#fhcube .c6 .ul{height:6px;background:#fff;transform-origin:0 50%;margin-top:6px}
#fhcube .c6 .row3{display:flex;align-items:center;gap:10px;margin-top:9px}
#fhcube .c6 .ttc{display:inline-flex;align-items:center;gap:6px;padding:4px 12px 4px 8px;background:#FFB020;color:#0b1220;font:italic 900 15px/1 'Barlow Condensed';letter-spacing:.08em;text-transform:uppercase;clip-path:polygon(0 0,100% 0,calc(100% - 9px) 100%,0 100%)}
#fhcube .c6 .ast{font:italic 700 14px/1 'Barlow Condensed';letter-spacing:.08em;color:#d7e3f5;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#fhcube .c6 .streak{position:absolute;top:-20px;bottom:-20px;width:70px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.45),transparent);transform:skewX(-20deg)}
#fhcube-dim{position:fixed;inset:0;background:#02060f;opacity:0;z-index:29;pointer-events:none}
#fhcube-fx{position:fixed;inset:0;z-index:29;pointer-events:none}
#fhcube-fx .sw{position:absolute;top:0;width:260px;height:100%;opacity:0;clip-path:polygon(45% 0,55% 0,100% 100%,0 100%);background:linear-gradient(180deg,rgba(255,255,255,.25),rgba(255,255,255,0) 85%)}
#fhcube-fx .fl{position:absolute;width:7px;height:7px;border-radius:50%;background:#fff;box-shadow:0 0 10px 4px rgba(255,255,255,.8);opacity:0}
`;
const FLASHES = [[.22, 30, 260], [.31, 18, 420], [.72, 26, 340], [.78, 40, 610], [.26, 60, 760], [.66, 14, 900], [.37, 44, 1050], [.74, 62, 1200]];   // pevné (x jako podíl šířky, y px, čas ms)

function headCanvas(c, ent) {   // hlava střelce ve skutečných barvách (stejný renderer jako hra)
  const p = new Player('fhcube-av', ent?.team || 'home', null); p._dispReach = PLAYER.stickLen; p.charge = 0; p._dispCharge = 0; p.passReq = 0; p.crossCheck = false; p.name = '';
  for (const k of ['color', 'stripe', 'helmet', 'gloves', 'shorts', 'stick', 'tape', 'visor', 'helmetType', 'jersey', 'num', 'size', 'handed']) if (ent && ent[k] != null) p[k] = ent[k];
  const g = c.getContext('2d'), S = c.height / 13;
  for (let f = 0; f < 3; f++) { g.fillStyle = '#dfeaf3'; g.fillRect(0, 0, c.width, c.height); p.x = 500; p.y = 200; p.bodyAngle = p.skateAngle = -Math.PI / 2; p.vx = p.vy = 0; p.aimAngle = p.carryAngle = p._stickDisp = -Math.PI / 2 + 0.6;
    try { p.draw(g, { scale: S, ox: c.width / 2 - 500 * S, oy: c.height * .72 - 200 * S, dt: 1 / 60 }); } catch {} }
}

export function initCube(t9n) {
  if (typeof document === 'undefined') return null;
  let st = document.getElementById('fhcube-css'); if (!st) { st = document.createElement('style'); st.id = 'fhcube-css'; st.textContent = CSS; document.head.appendChild(st); }
  const reduce = !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const dim = document.createElement('div'); dim.id = 'fhcube-dim';
  const fx = document.createElement('div'); fx.id = 'fhcube-fx';
  fx.innerHTML = '<div class="sw" id="fhc-swL"></div><div class="sw" id="fhc-swR"></div>' + FLASHES.map((f, i) => `<div class="fl" id="fhc-f${i}" style="left:${f[0] * 100}%;top:${f[1]}px"></div>`).join('');
  const root = document.createElement('div'); root.id = 'fhcube';
  root.innerHTML = `<div class="a" id="fhc-g" style="width:${W}px;margin-left:-${W / 2}px;transform-origin:50% 0;transform:translateY(-${UB_TOP}px)">
    <div class="a led chase" id="fhc-ur" style="top:0;width:${W}px;height:${RING}px;border:2px solid #22324f"><span id="fhc-urt">${'GOAL ★ '.repeat(10)}</span></div>
    <div class="a" style="top:0;width:${W}px;height:6px;background:#E4002B;z-index:3"></div>
    <div class="a fhc-crn" id="fhc-cl" style="top:${RING}px;left:-${CW - 4}px;width:${CW}px;height:${H}px;clip-path:polygon(100% 0,100% 100%,0 92%,0 8%);border:2px solid #22324f;display:grid;place-items:center">${STICKS}</div>
    <div class="a fhc-crn" id="fhc-cr" style="top:${RING}px;left:${W - 4}px;width:${CW}px;height:${H}px;clip-path:polygon(0 0,100% 8%,100% 92%,0 100%);border:2px solid #22324f;display:grid;place-items:center">${STICKS}</div>
    <div class="a" id="fhc-wall" style="top:${RING}px;width:${W}px;height:${H}px;overflow:hidden;border:2px solid #22324f;background:#0B1730;transform-origin:50% 0;transform:scaleY(0)">
      <svg id="fhc-knock" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%;opacity:0"><defs><mask id="fhc-km"><rect width="${W}" height="${H}" fill="#fff"/><text x="${W / 2}" y="122" text-anchor="middle" font-family="Barlow Condensed" font-style="italic" font-weight="900" font-size="128" letter-spacing="6" fill="#000">GOAL</text></mask></defs><rect id="fhc-kr" width="${W}" height="${H}" mask="url(#fhc-km)"/></svg>
      <div style="position:absolute;inset:0;background-image:radial-gradient(circle,rgba(255,255,255,.07) 1px,transparent 1.5px);background-size:4px 4px"></div>
      <div class="goalw" id="fhc-bigG" style="opacity:0;transform:translateY(-50%)">GOAL!</div>
      <div class="c6" id="fhc-c6"><div class="bn" id="fhc-bn"></div><div class="sh"></div><div class="num" id="fhc-n"></div><div class="avb" id="fhc-a"></div>
        <div class="meta"><div class="row1"><span class="chipG" id="fhc-chip">GÓL</span><span class="stat" id="fhc-s"></span></div><div class="big" id="fhc-b"></div><div class="ul" id="fhc-u" style="transform:skewX(-20deg) scaleX(0)"></div>
        <div class="row3"><span class="ttc" id="fhc-t"></span><span class="ast" id="fhc-x"></span></div></div><div class="streak" id="fhc-k"></div></div>
    </div>
    <div class="a led" id="fhc-lr" style="top:${RING + H}px;left:${(W - W * .86) / 2}px;width:${W * .86}px;height:8px"></div>
    <div class="a" id="fhc-ub" style="top:${UB_TOP}px;left:${(W - UBW) / 2}px;width:${UBW}px;height:${UBH}px;background:#081127;border-bottom:3px solid #E4002B;clip-path:polygon(0 0,100% 0,calc(100% - 14px) 100%,14px 100%)">
      <div class="ub"><div style="text-align:center"><div class="t" id="fhc-hn"></div><span id="fhc-hs">0</span></div><div class="clk"><span id="fhc-clk">0:00</span><div class="t" id="fhc-per" style="margin:3px auto 0"></div></div><div style="text-align:center"><div class="t" id="fhc-an"></div><span id="fhc-as">0</span></div></div>
    </div>
  </div>
  <div class="a" id="fhc-cabL" style="top:0;left:-${W / 2 - 70}px;width:2px;height:0;background:#3b475f"></div><div class="a" id="fhc-cabR" style="top:0;left:${W / 2 - 72}px;width:2px;height:0;background:#3b475f"></div>`;
  document.body.append(dim, fx, root);
  const $ = id => document.getElementById(id);
  let goal = null, t0 = 0, raf = 0, score = { home: 0, away: 0 }, teams = null, shown = { home: 0, away: 0 };
  const paintScore = () => { $('fhc-hs').textContent = shown.home; $('fhc-as').textContent = shown.away; };
  // ČISTÁ FUNKCE PRŮBĚHU: t = ms od gólu (deterministické; test krokuje po 40 ms)
  function set(t) {
    const g = goal, on = !!g && t >= 0 && t < DUR;
    const p = !on ? 0 : t < 320 ? eOutExpo(t / 320) : t < 1650 ? 1 : t < 1900 ? 1 - eIn((t - 1650) / 250) : 0;
    const sway = (!on || reduce || t < 320 || t > 1650) ? 0 : 1.2 * Math.exp(-(t - 320) / 340) * Math.sin((t - 320) / 1000 * 2 * Math.PI * 1.5);
    $('fhc-g').style.transform = `translateY(${(p - 1) * UB_TOP}px) rotate(${sway}deg)`;
    $('fhc-wall').style.transform = `scaleY(${on ? cl(t < 1650 ? eOutExpo(cl((t - 60) / 300, 0, 1)) : p, 0, 1) : 0})`;
    for (const c of document.querySelectorAll('#fhcube .fhc-crn')) c.style.opacity = on ? cl((t - 120) / 160, 0, 1) * (t >= 1650 ? p : 1) : 0;
    $('fhc-cabL').style.height = $('fhc-cabR').style.height = Math.max(0, p * UB_TOP) + 'px';
    // doba 1: 3 bliknutí barvy týmu s vyříznutým GOAL (bez blikání při omezeném pohybu)
    const fl = [200, 540, 880], kon = on && t < 1050 && (reduce ? t >= 200 : fl.some(f => t >= f && t < f + 170));
    $('fhc-knock').style.opacity = kon ? 1 : 0;
    $('fhc-bigG').style.opacity = on && !kon && t > 200 && t < 1050 ? 1 : 0;
    const red = kon && !reduce;
    $('fhc-ur').style.backgroundColor = $('fhc-lr').style.backgroundColor = on ? (red ? (g.color2 || '#1b4fd1') : '#0f2550') : '#0f2550';
    $('fhc-urt').style.transform = `translateX(${-((Math.floor(t / 90) * 9) % 90)}px)`;
    // hala: ztlumení + reflektory + blesky
    const dimK = !on ? 0 : t < 200 ? t / 200 : t < 1400 ? 1 : t < 1700 ? 1 - (t - 1400) / 300 : 0;
    dim.style.opacity = 0.28 * dimK;
    const sw = cl((t - 150) / 1300, 0, 1), vw = innerWidth;
    $('fhc-swL').style.left = (vw * .13 + sw * vw * .5) + 'px'; $('fhc-swR').style.left = (vw * .77 - sw * vw * .5) + 'px';
    $('fhc-swL').style.opacity = $('fhc-swR').style.opacity = on ? 0.9 * dimK : 0;
    FLASHES.forEach((f, i) => { const d = t - f[2]; $('fhc-f' + i).style.opacity = on && !reduce && d >= 0 && d < 90 ? 1 - d / 90 : 0; });
    // doba 2: karta střelce + skóre se přepíše
    const k2 = on && t >= 1050, ck = t >= 1650 ? p : 1, q = x => eOutExpo(cl(x, 0, 1));
    $('fhc-c6').style.opacity = k2 ? ck : 0;
    $('fhc-n').style.transform = `translateX(${(1 - q((t - 1050) / 300)) * 120}px)`;
    $('fhc-a').style.transform = `scale(${0.6 + 0.4 * q((t - 1060) / 240)})`;
    [...document.querySelectorAll('#fhc-b span')].forEach((e, i) => { const r = q((t - 1100 - i * 22) / 160); e.style.opacity = r; e.style.transform = `translateY(${(1 - r) * 16}px)`; });
    $('fhc-u').style.transform = `skewX(-20deg) scaleX(${q((t - 1180) / 260)})`;
    $('fhc-t').style.opacity = q((t - 1300) / 160); $('fhc-x').style.opacity = q((t - 1340) / 160); $('fhc-s').style.opacity = q((t - 1120) / 200);
    $('fhc-k').style.left = (-100 + 720 * cl((t - 1260) / 320, 0, 1)) + 'px'; $('fhc-k').style.opacity = on && t > 1260 && t < 1600 ? 1 : 0;
    if (!on || t >= 1050) shown = { ...score }; paintScore();
    $('fhc-hs').style.color = $('fhc-as').style.color = '';
    if (on && t >= 1050 && t < 1650 && g.side) $(g.side === 'home' ? 'fhc-hs' : 'fhc-as').style.color = '#FFB020';
    if (on === false && goal && t >= DUR) goal = null;
  }
  function loop() { const t = performance.now() - t0; set(t); if (t < DUR + 50) raf = requestAnimationFrame(loop); else { raf = 0; goal = null; set(DUR); } }
  return {
    set,
    // stav v klidu (každý snímek z game.js): skóre, čas, třetina, týmy
    update({ home, away, clock, period, periods, teams: tm }) {
      score = { home, away }; teams = tm;
      if (!goal) { shown = { ...score }; paintScore(); }
      const mm = Math.floor(clock / 60), ss = Math.max(0, Math.floor(clock % 60));
      $('fhc-clk').textContent = `${mm}:${String(ss).padStart(2, '0')}`;
      $('fhc-per').textContent = t9n?.('period_of', period, periods) ?? `${period}/${periods}`;
      $('fhc-hn').textContent = tm?.home?.name || 'Home'; $('fhc-an').textContent = tm?.away?.name || 'Away';
      $('fhc-hn').style.color = tm?.home?.color || '#7FD4FF'; $('fhc-an').style.color = tm?.away?.color || '#ff6b7f';
      $('fhc-cl').style.background = tm?.home?.color || '#1b4fd1'; $('fhc-cr').style.background = tm?.away?.color || '#c8102e';
    },
    // gól: card ze serveru {sid, bn, tt, av, au, num, as (asistence), gg (góly v zápase), sg (v sezóně)}
    goal({ card, scorer, side, ent, en, before }) {
      if (!card) return;
      const tc = teams?.[side]?.color || (side === 'home' ? '#3a9fff' : '#ff4455');
      goal = { side, color2: tc }; shown = before || shown;
      root.style.setProperty('--tc', tc); $('fhc-kr').setAttribute('fill', tc);
      $('fhc-bn').style.background = pickBanner(card.bn).bg;
      $('fhc-n').textContent = card.num ?? '';
      const av = $('fhc-a');
      if (card.av === 'discord' && card.au) av.innerHTML = `<img src="${esc(card.au)}" alt="">`;
      else if (card.av === 'num') av.textContent = card.num ?? '#';
      else { av.innerHTML = '<canvas width="240" height="240"></canvas>'; headCanvas(av.firstChild, ent); }
      $('fhc-b').innerHTML = [...String(scorer || '').toUpperCase()].map(ch => `<span>${esc(ch === ' ' ? ' ' : ch)}</span>`).join('') + (card.num != null ? ` <span style="color:#7FD4FF">${esc(card.num)}</span>` : '');
      const ti = pickTitle(card.tt); $('fhc-t').textContent = '★ ' + (en ? ti.en : ti.cs);
      $('fhc-chip').textContent = en ? 'GOAL' : 'GÓL';
      const gg = card.gg, sg = card.sg;
      $('fhc-s').textContent = [gg ? (en ? `goal #${gg} tonight` : `${gg}. gól v zápase`) : '', sg ? (en ? `#${sg} this season` : `${sg}. v sezóně`) : ''].filter(Boolean).join(' · ');
      $('fhc-x').textContent = card.as ? (en ? 'Assist: ' : 'Asist.: ') + card.as : '';
      if (raf) cancelAnimationFrame(raf);
      t0 = performance.now(); loop();
    },
    destroy() { if (raf) cancelAnimationFrame(raf); root.remove(); dim.remove(); fx.remove(); },
  };
}
