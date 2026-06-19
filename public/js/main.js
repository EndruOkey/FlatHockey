import { Net } from './net.js';
import { NetGame, SandboxGame, TutorialGame } from './game.js';
import { Player } from './entities/Player.js';
import { PLAYER, RINK } from './constants.js';
import { t, applyI18n, toggleLang, setOnChange } from './i18n.js';
import { setVolume, getVolume } from './sound.js';
import { loadSession, onAuthChange, loginWithDiscord, logout, handleOAuthRedirect, getUser, loadServerStats, saveServerProfile, loadRankAndCredits } from './auth.js';

const $ = id => document.getElementById(id);
const canvas = $('canvas');
const lobby  = $('lobby');
const status = $('status');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Volume slidery — inicializace + sync při změně
function _initVolSliders() {
  const pct = Math.round(getVolume() * 100);
  for (const [sliderId, pctId] of [['vol-slider', 'vol-pct'], ['vol-slider-pause', 'vol-pct-pause']]) {
    const sl = $(sliderId), lb = $(pctId);
    if (!sl) continue;
    sl.value = pct;
    lb.textContent = pct + '%';
    sl.addEventListener('input', () => {
      const v = sl.value / 100;
      setVolume(v);
      $('vol-pct').textContent       = sl.value + '%';
      $('vol-pct-pause').textContent = sl.value + '%';
      $('vol-slider').value       = sl.value;
      $('vol-slider-pause').value = sl.value;
    });
  }
}
_initVolSliders();

// Předdefinovaná paleta
const PALETTE = ['#3a9fff','#1b4fd1','#ff4455','#b81d3a','#19c37d','#0c7a4a',
                 '#ffcf3a','#ff8a1e','#9b5cff','#ff5bd0','#f4f7fb','#1a1f29'];
let isSponsor = false;   // odemčeno tajným kódem v nicku (ověřuje server)
const sponsorMsg = () => setStatus(t('sponsor_only'), '#ffcf3a');
function makeSwatches(el, initial, onChange, opts = {}) {
  const colors = opts.colors || PALETTE;
  const free = opts.free;                 // null = vše povolené; jinak pole povolených barev
  const isFree = c => !free || free.includes(c);
  let value = (colors.includes(initial) && isFree(initial)) ? initial : (free ? free[0] : colors[0]);
  el.innerHTML = '';
  const clearActive = () => [...el.children].forEach(x => x.classList.remove('active'));
  colors.forEach(c => {
    const b = document.createElement('button');
    b.type = 'button';
    const locked = !isFree(c);
    b.className = 'sw' + (c === value ? ' active' : '') + (locked ? ' locked' : '');
    b.dataset.color = c;
    b.style.background = c;
    b.addEventListener('click', () => {
      if (locked && !isSponsor) { (opts.onLocked || sponsorMsg)(); return; }   // zamčené = jen sponzor
      value = c; clearActive(); b.classList.add('active'); onChange?.(value);
    });
    el.appendChild(b);
  });
  if (!opts.noCustom) {                    // vlastní barva (color picker) = jen pro sponzory
    const cb = document.createElement('button');
    cb.type = 'button'; cb.className = 'sw custom locked'; cb.title = 'custom';
    const ci = document.createElement('input');
    ci.type = 'color'; ci.style.display = 'none';
    cb.addEventListener('click', () => {
      if (!isSponsor) { sponsorMsg(); return; }
      ci.value = /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#3a9fff'; ci.click();
    });
    ci.addEventListener('input', () => {
      value = ci.value; clearActive(); cb.classList.add('active'); cb.style.background = ci.value; onChange?.(value);
    });
    el.appendChild(cb); el.appendChild(ci);
  }
  function set(c) {
    if (!colors.includes(c)) return;
    if (!isFree(c) && !isSponsor) return;
    value = c; clearActive();
    const btn = [...el.querySelectorAll('.sw')].find(b => b.dataset.color === c);
    if (btn) btn.classList.add('active');
    onChange?.(value);
  }
  return { get: () => value, set };
}

// Výběr typu (chips s popiskem). items: [{val, key, free}]. Zamčené = sponzor.
function makeChips(el, items, initial, onChange, onLocked) {
  const free = items.filter(i => i.free !== false);
  let value = items.some(i => i.val === initial && i.free !== false) ? initial : (free[0]?.val ?? items[0].val);
  el.innerHTML = '';
  items.forEach(it => {
    const b = document.createElement('button');
    b.type = 'button';
    const locked = it.free === false;
    b.className = 'chip' + (it.val === value ? ' active' : '') + (locked ? ' locked' : '');
    b.dataset.i18n = it.key;             // překlad přes applyI18n
    b.textContent = t(it.key);
    b.addEventListener('click', () => {
      if (locked && !isSponsor) { (onLocked || sponsorMsg)(); return; }
      value = it.val;
      [...el.children].forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      onChange?.(value);
    });
    el.appendChild(b);
  });
  return {
    get: () => value,
    _items: items,
    set(v) {
      const it = items.find(i => i.val === v);
      if (!it || (it.free === false && !isSponsor)) return;
      value = v;
      [...el.children].forEach(x => x.classList.remove('active'));
      [...el.querySelectorAll('.chip')].find(b => b.dataset.i18n === it.key)?.classList.add('active');
      onChange?.(value);
    }
  };
}

// ── Profil ────────────────────────────────────────────────────────────
const nameInput = $('name-input'), numInput = $('num-input');
const handBtns  = document.querySelectorAll('.hand-btn');
const NAME_KEY='hockey_name', HAND_KEY='hockey_hand', NUM_KEY='hockey_num';
const GK = { helmet:'hockey_helmet', jersey:'hockey_jersey', shorts:'hockey_shorts', stripe:'hockey_stripe', laces:'hockey_laces',
             gloves:'hockey_gloves', tape:'hockey_tape', trail:'hockey_trail',
             stick:'hockey_stick', tapeStyle:'hockey_tapestyle', helmetType:'hockey_helmettype', visor:'hockey_visor' };
const TRAIL_GRAY = '#9aa3b2';                                  // jediná stopa zdarma
const STICK_PALETTE = ['#1a1f29','#f4f7fb','#9aa3b2','#7a5015','#b81d3a','#1b4fd1','#19c37d','#ffcf3a'];
const VISOR_PALETTE = ['#bfe0ff','#39414e','#4f8fd6','#cfe7f2','#e2b25a']; // tradiční odstíny vizoru/akvárka

nameInput.value = localStorage.getItem(NAME_KEY) || '';
numInput.value  = localStorage.getItem(NUM_KEY) || '';
let chosenHand = parseInt(localStorage.getItem(HAND_KEY) || '1', 10);
const refreshHand = () => handBtns.forEach(b => b.classList.toggle('active', parseInt(b.dataset.hand,10) === chosenHand));
refreshHand();
handBtns.forEach(b => b.addEventListener('click', () => { chosenHand = parseInt(b.dataset.hand,10); localStorage.setItem(HAND_KEY,String(chosenHand)); refreshHand(); drawPreview(); }));
numInput.addEventListener('input', () => { localStorage.setItem(NUM_KEY, numInput.value); drawPreview(); });
nameInput.addEventListener('input', drawPreview);

const swHelmet  = makeSwatches($('sw-helmet'),  localStorage.getItem(GK.helmet)  || '#f4f7fb', drawPreview);
const swJersey  = makeSwatches($('sw-jersey'),  localStorage.getItem(GK.jersey)  || '#df2626', drawPreview);
const swShorts  = makeSwatches($('sw-shorts'),  localStorage.getItem(GK.shorts)  || '#df2626', drawPreview);
const swStripe  = makeSwatches($('sw-stripe'),  localStorage.getItem(GK.stripe)  || '#df2626', drawPreview);
const swLaces   = makeSwatches($('sw-laces'),   localStorage.getItem(GK.laces)   || '#f4f7fb', drawPreview);
const swGloves  = makeSwatches($('sw-gloves'),  localStorage.getItem(GK.gloves)  || '#1a1f29', drawPreview);
const swStick   = makeSwatches($('sw-stick'),   localStorage.getItem(GK.stick)   || '#1a1f29', drawPreview, { colors: STICK_PALETTE });
const swTape    = makeSwatches($('sw-tape'),    localStorage.getItem(GK.tape)    || '#f4f7fb', drawPreview);
const swTrail  = makeSwatches($('sw-trail'),  localStorage.getItem(GK.trail)  || TRAIL_GRAY, drawPreview,
                  { colors: [TRAIL_GRAY, ...PALETTE], free: [TRAIL_GRAY], onLocked: sponsorMsg });  // ostatní barvy = sponzor
const chHelmetType = makeChips($('ht-chips'), [
  { val:'visor', key:'ht_visor' }, { val:'none', key:'ht_none' },
  { val:'shield', key:'ht_shield' }, { val:'cage', key:'ht_cage' },
], localStorage.getItem(GK.helmetType) || 'visor', () => { updateVisorRow(); drawPreview(); });
const chTapeStyle = makeChips($('ts-chips'), [
  { val:'full', key:'ts_full' }, { val:'toe', key:'ts_toe' },
  { val:'heel', key:'ts_heel' }, { val:'candy', key:'ts_candy' },
], localStorage.getItem(GK.tapeStyle) || 'full', drawPreview);
const swVisor = makeSwatches($('sw-visor'), localStorage.getItem(GK.visor) || '#bfe0ff', drawPreview, { colors: VISOR_PALETTE });
function updateVisorRow() { /* gear panel removed — visor always available via popup */ }

function profile() {
  const name = (nameInput.value || '').trim().slice(0, 14);
  localStorage.setItem(NAME_KEY, name);
  localStorage.setItem(GK.helmet, swHelmet.get());
  localStorage.setItem(GK.jersey, swJersey.get());
  localStorage.setItem(GK.shorts, swShorts.get());
  localStorage.setItem(GK.stripe, swStripe.get());
  localStorage.setItem(GK.laces,  swLaces.get());
  localStorage.setItem(GK.gloves, swGloves.get());
  localStorage.setItem(GK.tape,   swTape.get());
  localStorage.setItem(GK.trail,  swTrail.get());
  localStorage.setItem(GK.stick,  swStick.get());
  localStorage.setItem(GK.tapeStyle,  chTapeStyle.get());
  localStorage.setItem(GK.helmetType, chHelmetType.get());
  localStorage.setItem(GK.visor, swVisor.get());
  const n = parseInt(numInput.value, 10);
  return {
    name, handed: chosenHand,
    number: Number.isFinite(n) ? Math.max(0, Math.min(99, n)) : null,
    helmet: swHelmet.get(), jersey: swJersey.get(), shorts: swShorts.get(), stripe: swStripe.get(), laces: swLaces.get(),
    gloves: swGloves.get(), tape: swTape.get(), trail: swTrail.get(),
    stick: swStick.get(), tapeStyle: chTapeStyle.get(), helmetType: chHelmetType.get(), visor: swVisor.get(),
  };
}

// ── SVG hero — locker room character stage ────────────────────────────
let _svgDoc = null;

function _hexRgb(hex) {
  const n = parseInt(hex.replace('#',''), 16);
  return [(n>>16)&255, (n>>8)&255, n&255];
}
function _svgRecolor(R, G, B, [tr, tg, tb]) {
  const v = Math.max(R, G, B) / 255;
  return `rgb(${Math.min(255,Math.round(tr*v))},${Math.min(255,Math.round(tg*v))},${Math.min(255,Math.round(tb*v))})`;
}

function _svgEl(svg, id) { return svg.querySelector('#' + CSS.escape(id)); }

function _normalizeWhite(s) {
  return s.replace(/\bfill:white\b/g, 'fill:rgb(255,255,255)');
}

function _recolorGroup(svg, groupId, rgb) {
  const g = _svgEl(svg, groupId);
  if (!g) return;
  g.querySelectorAll('[style]').forEach(el => {
    let s = _normalizeWhite(el.getAttribute('style') || '');
    if (!s.includes('fill:rgb')) return;
    el.setAttribute('style', s.replace(/fill:rgb\((\d+),\s*(\d+),\s*(\d+)\)/g,
      (_, R, G, B) => 'fill:' + _svgRecolor(+R, +G, +B, rgb)));
  });
  g.querySelectorAll('[fill]').forEach(el => {
    const f = (el.getAttribute('fill') || '').toLowerCase();
    const src = f === 'white' ? 'rgb(255,255,255)' : f;
    const m = src.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
    if (m) el.setAttribute('fill', _svgRecolor(+m[1],+m[2],+m[3],rgb));
  });
  let s = _normalizeWhite(g.getAttribute('style') || '');
  if (s.includes('fill:rgb')) {
    g.setAttribute('style', s.replace(/fill:rgb\((\d+),\s*(\d+),\s*(\d+)\)/g,
      (_, R, G, B) => 'fill:' + _svgRecolor(+R, +G, +B, rgb)));
  }
}

function _directColor(svg, groupId, [r, g, b]) {
  const el = _svgEl(svg, groupId);
  if (!el) return;
  [el, ...el.querySelectorAll('[style]')].forEach(node => {
    let s = _normalizeWhite(node.getAttribute('style') || '');
    if (!s.includes('fill:rgb')) return;
    node.setAttribute('style', s.replace(/fill:rgb\(\d+,\s*\d+,\s*\d+\)/g, `fill:rgb(${r},${g},${b})`));
  });
}

function _neutralizeShadow(svg, id) {
  const g = _svgEl(svg, id);
  if (!g) return;
  // replace any fill color with black so shadow is neutral dark, not color-tinted
  [g, ...g.querySelectorAll('[style]')].forEach(el => {
    const s = el.getAttribute('style') || '';
    if (!s.includes('fill:rgb')) return;
    el.setAttribute('style', s.replace(/fill:rgb\(\d+,\s*\d+,\s*\d+\)/g, 'fill:rgb(0,0,0)'));
  });
}

const DRES_GROUPS   = ['DRES-BARVA','STULPNY_COLOR'];
const SHORTS_GROUPS = ['KRATASY-COLOR','KRATASY_podkolenky_COLOR'];
const STRIPE_GROUPS = ['BRUSLE_L_Prouzek_COLOR','BRUSLE_R_Prouzek_COLOR'];
const LACES_GROUPS  = ['BRUSLE_L_TKANICKY_COLOR','BRUSLE_R_TKANICKY_COLOR','BRUSLE_L_TKANICKY2_COLOR','BRUSLE_R_TKANICKY2_COLOR'];
const TAPE_STYLE_GROUPS = ['TAPING-STYLE-1_COLOR','TAPING-STYLE-2_COLOR','TAPING-STYLE-3_COLOR','TAPING-STYLE-4_COLOR'];

async function loadHeroSVG() {
  const stage = $('hero-stage');
  if (!stage) return;
  if (!_svgDoc) {
    try {
      const text = await (await fetch('/player-hero.svg')).text();
      _svgDoc = new DOMParser().parseFromString(text, 'image/svg+xml');
    } catch { return; }
  }
  const svg = _svgDoc.documentElement.cloneNode(true);
  const hc = _hexRgb(swHelmet.get());
  const jc = _hexRgb(swJersey.get());
  const sc = _hexRgb(swShorts.get());
  const rc = _hexRgb(swStripe.get());
  const lc = _hexRgb(swLaces.get());
  const gc = _hexRgb(swGloves.get());
  const tc = _hexRgb(swTape.get());
  const stc = _hexRgb(swStick.get());
  const vc = _hexRgb(swVisor.get());

  _recolorGroup(svg, 'HELMA_COLOR', hc);
  DRES_GROUPS.forEach(id   => _recolorGroup(svg, id, jc));
  SHORTS_GROUPS.forEach(id => _recolorGroup(svg, id, sc));
  STRIPE_GROUPS.forEach(id => _recolorGroup(svg, id, rc));
  LACES_GROUPS.forEach(id  => _recolorGroup(svg, id, lc));
  _recolorGroup(svg, 'RUKAVICE_R_COLOR', gc);
  _recolorGroup(svg, 'RUKAVICE_L_COLOR', gc);
  _recolorGroup(svg, 'HOCKEY--STICK-BODY', stc);

  // sweep for orphan jersey-colored paths outside named groups
  const JERSEY_SRC = new Set(['223,38,38','223,43,38','161,41,21']);
  svg.querySelectorAll('[style]').forEach(el => {
    const s = el.getAttribute('style') || '';
    if (s.includes('fill-opacity')) return;
    const m = s.match(/fill:rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (!m || !JERSEY_SRC.has(`${m[1]},${m[2]},${m[3]}`)) return;
    el.setAttribute('style', s.replace(/fill:rgb\(\d+,\s*\d+,\s*\d+\)/, 'fill:' + _svgRecolor(+m[1], +m[2], +m[3], jc)));
  });

  // neutralize shadow fills to black
  _neutralizeShadow(svg, 'HELMA_SHADOW');
  _neutralizeShadow(svg, 'STULPNY_SHADOW');
  // DRES-SHADOW: raster images — grayscale to strip original red hue, then multiply to darken jersey
  const dresShadow = _svgEl(svg, 'DRES-SHADOW');
  if (dresShadow) { dresShadow.style.mixBlendMode = 'multiply'; dresShadow.style.filter = 'grayscale(1)'; }

  // visor/plexi: direct color (no brightness scaling), preserves fill-opacity
  _directColor(svg, 'Plexi', vc);

  // taping: show active style, apply tape color directly (original color was a design placeholder)
  const tapeIdx = ['full','toe','heel','candy'].indexOf(chTapeStyle.get());
  const activeStyle = tapeIdx >= 0 ? tapeIdx + 1 : 1;
  TAPE_STYLE_GROUPS.forEach((id, i) => {
    const el = _svgEl(svg, id);
    if (!el) return;
    if (i + 1 === activeStyle) { el.style.display = ''; _directColor(svg, id, tc); }
    else el.style.display = 'none';
  });

  svg.removeAttribute('width'); svg.removeAttribute('height');
  stage.innerHTML = '';
  stage.appendChild(document.adoptNode(svg));
  const liveSvg = stage.querySelector('svg');
  _wireHeroInteraction(liveSvg);
  if (liveSvg) liveSvg.style.transform = chosenHand === -1 ? 'scaleX(-1)' : '';

  // Jersey number — measure DRES-BARVA after DOM insertion for correct coords
  const numVal = numInput ? numInput.value.trim() : '';
  let numDiv = document.getElementById('hero-num-overlay');
  if (!numDiv) {
    numDiv = document.createElement('div');
    numDiv.id = 'hero-num-overlay';
    stage.parentElement.style.position = 'relative';
    stage.parentElement.appendChild(numDiv);
  }
  if (numVal) {
    const [jr, jg, jb] = jc;
    const lum = 0.299 * jr + 0.587 * jg + 0.114 * jb;
    numDiv.textContent = numVal;
    numDiv.style.color = lum > 140 ? 'rgba(0,0,0,0.82)' : 'rgba(255,255,255,0.95)';
    numDiv.style.display = '';
    // Position using DRES-BARVA bounding rect
    requestAnimationFrame(() => {
      const dresEl = stage.querySelector('#DRES-BARVA');
      const stageEl = stage.parentElement;
      if (dresEl && stageEl) {
        const dr = dresEl.getBoundingClientRect();
        const sr = stageEl.getBoundingClientRect();
        const cx = dr.left - sr.left + dr.width / 2;
        const cy = dr.top - sr.top + dr.height * 0.38;
        numDiv.style.left = cx + 'px';
        numDiv.style.top = cy + 'px';
      }
    });
  } else {
    numDiv.style.display = 'none';
  }
}

// ── Hero SVG hover-click contextual picker ────────────────────────────
const HERO_PARTS = [
  { ids: ['HELMA_COLOR'],                       label: 'HELMET',  sw: () => [swHelmet] },
  { ids: ['Plexi'],                             label: 'VISOR',   sw: () => [swVisor]  },
  { ids: ['DRES-BARVA','STULPNY_COLOR'],        label: 'JERSEY',  sw: () => [swJersey] },
  { ids: ['KRATASY-COLOR','KRATASY_podkolenky_COLOR'], label: 'SHORTS', sw: () => [swShorts] },
  { ids: ['RUKAVICE_R_COLOR','RUKAVICE_L_COLOR'], label: 'GLOVES', sw: () => [swGloves] },
  { ids: ['HOCKEY--STICK-BODY'],                label: 'STICK',   sw: () => [swStick] },
  { ids: ['TAPING-STYLE-1_COLOR','TAPING-STYLE-2_COLOR','TAPING-STYLE-3_COLOR','TAPING-STYLE-4_COLOR'],
                                                label: 'TAPE',    sw: () => [swTape], ch: () => [chTapeStyle] },
  { ids: ['BRUSLE_L_TKANICKY_COLOR','BRUSLE_R_TKANICKY_COLOR','BRUSLE_L_TKANICKY2_COLOR','BRUSLE_R_TKANICKY2_COLOR'], label: 'LACES', sw: () => [swLaces] },
  { ids: ['BRUSLE_L_Prouzek_COLOR','BRUSLE_R_Prouzek_COLOR'], label: 'STRIPE', sw: () => [swStripe] },
];

let _heroPopupCleanup = null;

function _wireHeroInteraction(svgEl) {
  if (!svgEl) return;
  const popup = $('hero-popup');
  if (!popup) return;

  // shadows sit on top — make them click-through so the color group below gets the event
  ['HELMA_SHADOW','STULPNY_SHADOW','KRATASY-SHADOW','RUKAVICE_R_SHADOW','RUKAVICE_L_SHADOW','DRES-SHADOW','HOCKEY-STICK-SHADOW'].forEach(id => {
    const el = svgEl.querySelector('#' + CSS.escape(id));
    if (el) el.style.pointerEvents = 'none';
  });

  const GLOW_IDLE   = 'drop-shadow(0 0 5px rgba(182,196,255,0.28))';
  const GLOW_HOVER  = 'brightness(1.38) drop-shadow(0 0 10px rgba(182,196,255,0.7))';

  // Floating label that follows hovered parts
  let _hoverLabel = document.getElementById('hero-hover-label');
  if (!_hoverLabel) {
    _hoverLabel = document.createElement('div');
    _hoverLabel.id = 'hero-hover-label';
    document.body.appendChild(_hoverLabel);
  }
  _hoverLabel.style.display = 'none';

  const GLOW_RESTING = 'drop-shadow(0 0 3px rgba(182,196,255,0.18))';

  const seen = new Set();
  HERO_PARTS.forEach(part => {
    part.ids.forEach(id => {
      if (seen.has(id)) return;
      seen.add(id);
      const el = svgEl.querySelector('#' + CSS.escape(id));
      if (!el) return;
      el.style.cursor = 'pointer';
      el.style.filter = GLOW_RESTING;
      el.addEventListener('mouseenter', () => {
        if (el.dataset.popupOpen) return;
        el.style.filter = GLOW_HOVER;
        const r = el.getBoundingClientRect();
        _hoverLabel.textContent = part.label;
        _hoverLabel.style.left = (r.left + r.width / 2) + 'px';
        _hoverLabel.style.top  = (r.top - 26) + 'px';
        _hoverLabel.style.display = 'block';
      });
      el.addEventListener('mouseleave', () => {
        if (!el.dataset.popupOpen) el.style.filter = GLOW_RESTING;
        _hoverLabel.style.display = 'none';
      });
      el.addEventListener('click', (e) => {
        _hoverLabel.style.display = 'none';
        e.stopPropagation();
        _showHeroPopup(popup, part, svgEl, el, e);
      });
    });
  });

  const closer = (e) => { if (!popup.contains(e.target)) _hideHeroPopup(popup, svgEl); };
  if (_heroPopupCleanup) _heroPopupCleanup();
  document.addEventListener('click', closer);
  _heroPopupCleanup = () => document.removeEventListener('click', closer);
}

function _hideHeroPopup(popup, svgEl) {
  popup.classList.remove('visible');
  if (svgEl) svgEl.querySelectorAll('[data-popup-open]').forEach(el => {
    delete el.dataset.popupOpen;
    el.style.filter = 'drop-shadow(0 0 3px rgba(182,196,255,0.18))';
  });
}

// Compute viewBox tight around the tape/blade area only (no shaft)
function _bladeViewBox(liveSvg) {
  if (!liveSvg) return null;
  try {
    const svgR = liveSvg.getBoundingClientRect();
    const vb   = liveSvg.viewBox?.baseVal;
    if (!svgR.width || !vb) return null;
    const scaleX = vb.width  / svgR.width;
    const scaleY = vb.height / svgR.height;
    const toVB = (r) => ({
      x: (r.left - svgR.left) * scaleX + vb.x,
      y: (r.top  - svgR.top)  * scaleY + vb.y,
      w: r.width  * scaleX,
      h: r.height * scaleY,
    });
    // Only use tape style groups — tight crop to blade, no shaft
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity, found = false;
    TAPE_STYLE_GROUPS.forEach(id => {
      const el = liveSvg.querySelector('#' + CSS.escape(id));
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) return;
      const v = toVB(r);
      x1 = Math.min(x1, v.x); y1 = Math.min(y1, v.y);
      x2 = Math.max(x2, v.x + v.w); y2 = Math.max(y2, v.y + v.h);
      found = true;
    });
    if (!found) return null;
    // Small padding only
    const pw = (x2 - x1) * 0.08, ph = (y2 - y1) * 0.08;
    return { vb: `${x1-pw} ${y1-ph} ${x2-x1+2*pw} ${y2-y1+2*ph}`, aspect: (x2-x1)/(y2-y1) };
  } catch(e) { return null; }
}

// Force-apply a color to a tape element and all its fill-carrying descendants
function _forceTapeColor(el, [r, g, b]) {
  const rgb = `rgb(${r},${g},${b})`;
  [el, ...el.querySelectorAll('[style]')].forEach(node => {
    const s = node.getAttribute('style') || '';
    if (s.includes('fill:')) node.setAttribute('style', s.replace(/fill:[^;]*/g, 'fill:' + rgb));
  });
  [el, ...el.querySelectorAll('[fill]')].forEach(node => {
    const f = node.getAttribute('fill');
    if (f && f !== 'none') node.setAttribute('fill', rgb);
  });
}

// Build a live SVG chip preview for a given tape style — cropped to blade only
function _tapeChipSvg(liveSvg, bladeVB, tapeVal) {
  const clone = liveSvg.cloneNode(true);
  clone.removeAttribute('width'); clone.removeAttribute('height');
  clone.setAttribute('viewBox', bladeVB.vb);
  clone.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  clone.style.cssText = 'width:80px;height:56px;display:block;pointer-events:none;overflow:hidden;transform:none';
  const tc = _hexRgb(swTape.get());
  const tapeIdx = ['full','toe','heel','candy'].indexOf(tapeVal);
  TAPE_STYLE_GROUPS.forEach((id, i) => {
    const el = clone.querySelector('#' + CSS.escape(id));
    if (!el) return;
    _forceTapeColor(el, tc);
    el.style.display = (i === tapeIdx) ? '' : 'none';
  });
  return clone;
}

function _showHeroPopup(popup, part, svgEl, triggerEl, evt) {
  _hideHeroPopup(popup, svgEl);

  // highlight all IDs for this part
  part.ids.forEach(id => {
    const el = svgEl.querySelector('#' + CSS.escape(id));
    if (el) { el.dataset.popupOpen = '1'; el.style.filter = 'brightness(1.45) drop-shadow(0 0 14px rgba(42,143,255,0.9))'; }
  });

  const swatches = part.sw();
  const chips = part.ch ? part.ch() : [];

  popup.innerHTML = `<div class="hp-label">${part.label}</div>`;

  swatches.forEach(sw => {
    const row = document.createElement('div');
    row.className = 'hp-swatches';
    const palette = sw === swStick ? STICK_PALETTE : sw === swVisor ? VISOR_PALETTE : PALETTE;
    palette.forEach(c => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sw' + (sw.get() === c ? ' active' : '');
      b.dataset.color = c;
      b.style.background = c;
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        row.querySelectorAll('.sw').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        sw.set(c);
        // Live-update tape chip previews when tape color changes
        if (sw === swTape) {
          const rgb = _hexRgb(c);
          popup.querySelectorAll('.chip-svg-wrap svg').forEach(chipSvg => {
            TAPE_STYLE_GROUPS.forEach(id => {
              const el = chipSvg.querySelector('#' + CSS.escape(id));
              if (el) _forceTapeColor(el, rgb);
            });
          });
        }
      });
      row.appendChild(b);
    });
    popup.appendChild(row);
  });

  if (chips.length) {
    const sep = document.createElement('div'); sep.className = 'hp-sep'; popup.appendChild(sep);
    chips.forEach(ch => {
      const row = document.createElement('div'); row.className = 'hp-chips';
      // Pre-compute blade viewBox once for tape chips
      const bladeVB = (ch === chTapeStyle) ? _bladeViewBox(svgEl) : null;
      ch._items?.forEach(it => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip' + (ch.get() === it.val ? ' active' : '');
        if (ch === chTapeStyle && bladeVB) {
          // Live SVG crop of the real blade
          const preview = document.createElement('div');
          preview.className = 'chip-svg-wrap';
          preview.appendChild(_tapeChipSvg(svgEl, bladeVB, it.val));
          b.appendChild(preview);
          const lbl = document.createElement('span');
          lbl.className = 'chip-lbl';
          lbl.textContent = it.val.toUpperCase();
          b.appendChild(lbl);
        } else {
          b.textContent = t(it.key);
        }
        b.addEventListener('click', (e) => {
          e.stopPropagation();
          row.querySelectorAll('.chip').forEach(x => x.classList.remove('active'));
          b.classList.add('active');
          ch.set(it.val);
        });
        row.appendChild(b);
      });
      popup.appendChild(row);
    });
  }

  // Position popup near click, clamped to viewport (measure offscreen to avoid flash)
  popup.style.left = '-9999px'; popup.style.top = '-9999px';
  popup.classList.add('visible');
  const rect = popup.getBoundingClientRect();
  let x = evt.clientX + 14, y = evt.clientY - rect.height / 2;
  if (x + rect.width > window.innerWidth - 8) x = evt.clientX - rect.width - 14;
  if (y < 8) y = 8;
  if (y + rect.height > window.innerHeight - 8) y = window.innerHeight - rect.height - 8;
  popup.style.left = x + 'px'; popup.style.top = y + 'px';
}

// ── Živý náhled hráče (helma/rukavice/páska/číslo/ruka) ───────────────
const prevCanvas = $('prof-preview');
const prevCtx = prevCanvas.getContext('2d');
const previewPlayer = new Player('preview', 'home', null);
previewPlayer.x = RINK.w / 2; previewPlayer.y = RINK.h / 2;
previewPlayer.bodyAngle = -Math.PI / 2;                      // čelem vzhůru (číslo na zádech čitelné)
// hůl PŘED hráčem (ve směru, kam kouká), natočená do strany ruky — ne kolmo/dozadu
previewPlayer.aimAngle = previewPlayer.carryAngle = previewPlayer._stickDisp = -Math.PI / 2 + 0.7;
previewPlayer._dispReach = PLAYER.stickLen;
previewPlayer._dispCharge = 0; previewPlayer.charge = 0; previewPlayer.passReq = 0; previewPlayer.crossCheck = false;
previewPlayer.color = '#3a9fff';

function _syncPlateDisplay() {
  const name = (nameInput.value || '').trim() || 'PLAYER';
  const num  = numInput.value || '16';
  const hand = chosenHand === -1 ? 'LEFT HAND' : 'RIGHT HAND';
  const ndEl = $('lk-name-display'); if (ndEl) ndEl.textContent = name;
  const nuEl = $('lk-num-display');  if (nuEl) nuEl.textContent = num;
  const hEl  = $('lk-hand-display'); if (hEl)  hEl.textContent  = hand;
}

let _autoSaveTimer = null;
function _triggerAutoSave() {
  if (!hasName()) return;
  clearTimeout(_autoSaveTimer);
  _autoSaveTimer = setTimeout(() => {
    commitProfile();
    const el = $('lk-autosave');
    if (el) {
      el.textContent = '✓ SAVED';
      el.classList.add('visible');
      clearTimeout(el._hideTimer);
      el._hideTimer = setTimeout(() => el.classList.remove('visible'), 2000);
    }
  }, 600);
}

function _drawRinkBg(ctx, w, h) {
  ctx.fillStyle = '#c8d8e8';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  for (let y = 0; y < h; y += 6) { ctx.fillRect(0, y, w, 1); }
}

function drawPreview() {
  const c = prevCanvas, ctx = prevCtx;
  if (!c || !ctx) return;
  _drawRinkBg(ctx, c.width, c.height);
  _syncPlateDisplay();
  const nameEl = $('preview-name');
  if (nameEl) nameEl.textContent = (nameInput.value || '').trim() || '—';
  const numEl = $('preview-num');
  if (numEl) numEl.textContent = numInput.value || '—';
  const p = previewPlayer;
  p.handed = chosenHand;
  p.helmet = swHelmet.get(); p.gloves = swGloves.get(); p.tape = swTape.get();
  p.stick = swStick.get(); p.tapeStyle = chTapeStyle.get(); p.helmetType = chHelmetType.get(); p.visor = swVisor.get();
  p.color = swJersey.get();
  const n = parseInt(numInput.value, 10);
  p.num  = Number.isFinite(n) ? Math.max(0, Math.min(99, n)) : null;
  p.name = '';
  const S = 1.8;
  const cam = { scale: S, ox: c.width / 2 - p.x * S, oy: c.height * 0.5 - p.y * S };
  p.draw(ctx, cam);
  if (lobby.classList.contains('on-profile')) loadHeroSVG();
  if (lobby.classList.contains('on-profile')) _triggerAutoSave();
}

// ── Create form (týmy = dlaždice) ─────────────────────────────────────
const swHome = makeSwatches($('sw-home'), '#3a9fff');
const swAway = makeSwatches($('sw-away'), '#ff4455');
const lobbyName = $('lobby-name');
const hName = $('hteam-name'), hStyle = $('hteam-style');
const aName = $('ateam-name'), aStyle = $('ateam-style');
const setPeriods = $('set-periods'), setMinutes = $('set-minutes'), setRules = $('set-rules');
const fmtBtns = document.querySelectorAll('.fmt-btn');
let chosenFmt = 3;
fmtBtns.forEach(b => b.addEventListener('click', () => { chosenFmt = parseInt(b.dataset.fmt,10); fmtBtns.forEach(x => x.classList.toggle('active', x === b)); }));
function readSettings() {
  return {
    name: (lobbyName.value || '').trim() || 'Lobby',
    teams: {
      home: { name: (hName.value||'').trim() || t('home_ph'), color: swHome.get(), style: hStyle.value },
      away: { name: (aName.value||'').trim() || t('away_ph'), color: swAway.get(), style: aStyle.value },
    },
    periods: parseInt(setPeriods.value,10),
    minutes: parseInt(setMinutes.value,10),
    max: chosenFmt * 2,
    rules: setRules.checked,
    password: ($('lobby-pass').value || '').trim(),
  };
}

// ── Navigace mezi obrazovkami ─────────────────────────────────────────
const VIEWS = { splash:'v-splash', main:'v-main', profile:'v-profile', browse:'v-browse', create:'v-create', wait:'v-wait', stats:'v-stats', store:'v-store' };
const _tabFor = { main: 'mn-tab-home', store: 'mn-tab-store', browse: 'mn-tab-home', create: 'mn-tab-home', wait: 'mn-tab-home', profile: 'mn-tab-locker', stats: 'mn-tab-stats' };
function showView(name) {
  for (const [k, id] of Object.entries(VIEWS)) $(id).style.display = (k === name) ? '' : 'none';
  lobby.classList.toggle('on-splash',  name === 'splash');
  lobby.classList.toggle('on-main',    name === 'main');
  lobby.classList.toggle('on-browse',  name === 'browse');
  lobby.classList.toggle('on-profile', name === 'profile');
  lobby.classList.toggle('on-create',  name === 'create');
  lobby.classList.toggle('on-wait',    name === 'wait');
  lobby.classList.toggle('on-stats',   name === 'stats');
  lobby.classList.toggle('on-store',   name === 'store');
  const activeTab = _tabFor[name] || null;
  document.querySelectorAll('.mn-tab').forEach(t => t.classList.toggle('active', t.id === activeTab));
  if (name === 'main' || name === 'stats' || name === 'store') _loadStats();
  if (name === 'splash') {
    const tutorialDone = !!localStorage.getItem('hockey_tutorial_done');
    $('splash-first').style.display  = tutorialDone ? 'none' : '';
    $('splash-return').style.display = tutorialDone ? '' : 'none';
  }
}
document.querySelectorAll('.back').forEach(b => b.addEventListener('click', () => {
  if (!b.dataset.to) return;                           // tlačítka s vlastní logikou (profile-done)
  showView(b.dataset.to);
  if (b.dataset.to === 'browse') net.listLobbies();   // čerstvý seznam při návratu
}));

// ── Nav tab clicks ────────────────────────────────────────────────────
document.querySelectorAll('.mn-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    if (tab.id === 'mn-tab-home') {
      showView('main'); _loadStats();
    } else if (tab.id === 'mn-tab-locker') {
      showView('profile'); drawPreview(); _loadStats();
    } else if (tab.id === 'mn-tab-stats') {
      showView('stats');
    } else if (tab.id === 'mn-tab-store') {
      showView('store');
    }
  });
});

function resizeCanvas() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

const net = new Net();
let inGame = false;
let currentGame = null;
let lastLobbyId = null;
let _pendingJoinId = null;
let _reconnectTimer = null;
const setStatus = (m, c = '#888') => { status.textContent = m; status.style.color = c; };

// ── Reconnect overlay ─────────────────────────────────────────────────
const reconnectOverlay = $('reconnect-overlay');
function showReconnecting() {
  if (reconnectOverlay) reconnectOverlay.style.display = 'flex';
  // Give up after 17s (server grace is 15s)
  _reconnectTimer = setTimeout(() => {
    hideReconnecting();
    if (inGame) { stopGame(); showView('main'); }
  }, 17_000);
}
function hideReconnecting() {
  if (reconnectOverlay) reconnectOverlay.style.display = 'none';
  clearTimeout(_reconnectTimer);
  _reconnectTimer = null;
}

net.onDisconnect = () => { if (inGame) showReconnecting(); };
net.onReconnect  = () => { hideReconnecting(); };

// ── Profil — povinný (bez přezdívky nepustíme dál) ────────────────────
const hasName = () => (nameInput.value || '').trim().length > 0;
const suggestName = () => t('guest_name') + Math.floor(100 + Math.random() * 900);
function commitProfile() {
  if (!hasName()) { setStatus(t('name_required'), '#ffcf3a'); nameInput.focus(); return false; }
  const p = profile();       // ulož jméno + výbavu do localStorage
  if (getUser()) {
    saveServerProfile({      // synchronizuj na server pro přihlášené hráče
      helmet: p.helmet, gloves: p.gloves, tape: p.tape, trail: p.trail, stick: p.stick,
      tape_style: p.tapeStyle, helmet_type: p.helmetType, visor: p.visor,
      handed: p.handed, number: p.number,
    });
  }
  setStatus('');
  return true;
}
function requireProfile() {
  if (!hasName()) nameInput.value = getUser()?.display_name || suggestName();
  showView('profile'); drawPreview();
  setStatus(t('welcome'), '#6ee0a0');
  setTimeout(() => { try { nameInput.focus(); nameInput.select(); } catch {} }, 60);
}

// Guest flow — tutorial pokud první návštěva, jinak profil/menu
function proceedAsGuest() {
  if (!localStorage.getItem('hockey_tutorial_done')) { _startTutorial(); return; }
  if (!hasName()) { requireProfile(); return; }
  showView('main');
}

// Rozhodne jakou obrazovku ukázat po načtení session
function initFlow() {
  const user = getUser();
  const tutorialDone = !!localStorage.getItem('hockey_tutorial_done');
  if (user) {
    // Přihlášený uživatel
    if (!tutorialDone) { _startTutorial(); return; }
    showView('main'); _loadStats();
  } else {
    // Guest nebo nepřihlášený — ukáže splash, ale guest footer na main nastavíme hned
    _loadStats();
    showView('splash');
  }
}
$('profile-done').onclick = () => {
  if (!commitProfile()) return;
  if (_pendingJoinId) {
    const id = _pendingJoinId; _pendingJoinId = null;
    showView('browse'); net.joinLobby(id, profile(), null);
  } else {
    showView('main');
  }
};

// ── Plate display ↔ form toggle ────────────────────────────────────────
(function() {
  const display  = $('lk-plate-display');
  const form     = $('lk-plate-form');
  const editBtn  = $('lk-plate-edit-btn');
  const doneBtn  = $('lk-plate-done');
  if (!display || !form || !editBtn || !doneBtn) return;
  _syncPlateDisplay();
  editBtn.addEventListener('click', () => {
    display.style.display = 'none';
    form.style.display    = '';
    nameInput.focus();
  });
  doneBtn.addEventListener('click', () => {
    _syncPlateDisplay();
    display.style.display = '';
    form.style.display    = 'none';
  });
  // also hide the form and sync when clicking the main SAVE button
  const origDone = $('profile-done').onclick;
  $('profile-done').onclick = (e) => {
    display.style.display = '';
    form.style.display    = 'none';
    _syncPlateDisplay();
    if (origDone) origDone.call($('profile-done'), e);
  };
})();

// ── Hlavní menu ───────────────────────────────────────────────────────
$('go-profile').onclick = () => { showView('profile'); drawPreview(); _loadStats(); };
async function _loadStats() {
  const [stats, rankData] = await Promise.all([loadServerStats(), loadRankAndCredits()]);
  const user = getUser();

  // Profile stats grid (Locker Room)
  const statsEl = $('profile-stats');
  if (!stats || !user) { statsEl.style.display = 'none'; }
  else {
    statsEl.style.display = '';
    $('stat-goals').textContent   = stats.goals        ?? 0;
    $('stat-assists').textContent = stats.assists       ?? 0;
    $('stat-saves').textContent   = stats.saves         ?? 0;
    $('stat-games').textContent   = stats.games_played  ?? 0;
    $('stat-wins').textContent    = stats.wins          ?? 0;
    $('stat-losses').textContent  = stats.losses        ?? 0;
  }

  // Profile rank + credits row
  const rankRow = $('profile-rank-row');
  if (rankData && user) {
    rankRow.classList.add('show');
    $('stat-rank').textContent     = rankData.rank_points ?? 1000;
    $('stat-position').textContent = rankData.position ? `#${rankData.position}` : '#—';
    $('stat-credits').textContent  = rankData.puck_credits ?? 0;
  } else {
    rankRow.classList.remove('show');
  }

  const gp   = stats?.games_played ?? 0;
  const wins = stats?.wins  ?? 0;
  const losses = stats?.losses ?? 0;
  const wr   = gp > 0 ? Math.round(wins / gp * 100) + '%' : '—';
  const rp   = rankData?.rank_points ?? 1000;
  const pos  = rankData?.position;
  const cred = rankData?.puck_credits ?? 0;

  // ELO overlay on art panel — only for logged-in users
  const statOverlay = $('vm-stat-overlay');
  if (statOverlay) statOverlay.style.display = user ? '' : 'none';
  const eloEl = $('vm-elo-val');
  if (eloEl && user) eloEl.textContent = rp;

  // Footer stats row (main menu)
  const footerGuest = $('vm-footer-guest');
  if (footerGuest) footerGuest.style.display = user ? 'none' : 'flex';
  document.querySelectorAll('#vm-footer .vmsb-card').forEach(c => {
    c.style.display = user ? '' : 'none';
  });
  const footerRank = $('vm-footer-rank');
  if (footerRank) {
    footerRank.textContent             = pos ? `#${pos}` : '#—';
    $('vm-footer-games').textContent   = gp;
    $('vm-footer-credits').textContent = `⊙ ${cred}`;
    $('vm-wr-val').textContent         = wr;
  }

  // Stats screen (v-stats)
  const vsRank = $('vs-rank');
  if (vsRank) {
    $('vs-rank').textContent     = pos ? `#${pos}` : '#—';
    $('vs-elo').textContent      = rp;
    $('vs-games').textContent    = gp;
    $('vs-wins').textContent     = stats?.wins    ?? 0;
    $('vs-losses').textContent   = stats?.losses  ?? 0;
    $('vs-goals').textContent    = stats?.goals   ?? 0;
    $('vs-assists').textContent  = stats?.assists  ?? 0;
    $('vs-plusminus').textContent = stats?.plus_minus ?? 0;
    $('vs-credits').textContent  = `⊙ ${cred}`;
    $('vs-saves').textContent    = stats?.saves   ?? 0;
    $('vs-winrate').textContent  = wr;
    const guestCta = $('stats-guest-cta');
    if (guestCta) guestCta.style.display = user ? 'none' : '';
  }

  // Store screen credits
  const storeCredEl = $('store-credits');
  if (storeCredEl) storeCredEl.textContent = cred;

  // Leaderboard — populate global list
  _renderLeaderboard('global');
}

let _lbMode = 'global';
async function _renderLeaderboard(mode) {
  _lbMode = mode;
  const list = $('sv-lb-list');
  const friendsCta = $('sv-lb-friends-cta');
  if (!list) return;

  if (mode === 'friends') {
    const user = getUser();
    if (!user) {
      list.innerHTML = '<div class="sv-lb-empty">SIGN IN TO SEE FRIENDS</div>';
      if (friendsCta) friendsCta.style.display = '';
      return;
    }
    if (friendsCta) friendsCta.style.display = 'none';
    list.innerHTML = '<div class="sv-lb-empty">FRIENDS LEADERBOARD — COMING SOON</div>';
    return;
  }

  if (friendsCta) friendsCta.style.display = 'none';
  list.innerHTML = '<div class="sv-lb-empty">LOADING...</div>';

  try {
    const resp = await fetch('/api/leaderboard?limit=50');
    if (!resp.ok) throw new Error();
    const rows = await resp.json();
    if (!rows.length) { list.innerHTML = '<div class="sv-lb-empty">NO DATA YET</div>'; return; }
    const me = getUser();
    list.innerHTML = rows.map((r, i) => {
      const rank = i + 1;
      const isMe = me && (r.id === me.id || r.name === me.display_name);
      const wr = r.games > 0 ? Math.round(r.wins / r.games * 100) + '%' : '—';
      return `<div class="sv-lb-row${isMe ? ' me' : ''}">
        <span class="sv-lb-rank${rank <= 3 ? ' top3' : ''}">${rank}</span>
        <span class="sv-lb-name">${r.name || 'Player'}</span>
        <span class="sv-lb-elo">${r.elo ?? 1000}</span>
        <span class="sv-lb-wr">${wr}</span>
        <span class="sv-lb-gp">${r.games ?? 0}</span>
      </div>`;
    }).join('');
  } catch {
    list.innerHTML = '<div class="sv-lb-empty">LEADERBOARD UNAVAILABLE</div>';
  }
}

// Leaderboard tab toggle
document.querySelectorAll('.sv-lb-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.sv-lb-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    _renderLeaderboard(btn.dataset.mode);
  });
});
$('go-online').onclick      = () => { if (!commitProfile()) return requireProfile(); showView('browse'); net.listLobbies(); };
$('vm-create-btn').onclick  = () => { if (!commitProfile()) return requireProfile(); showView('create'); };
$('go-solo').onclick     = () => {
  if (!commitProfile()) return requireProfile();
  const g = new SandboxGame(canvas), pr = profile();
  Object.assign(g.local, { name: pr.name, handed: pr.handed, num: pr.number, helmet: pr.helmet, jersey: pr.jersey, shorts: pr.shorts, stripe: pr.stripe, laces: pr.laces, gloves: pr.gloves, tape: pr.tape, trail: pr.trail, stick: pr.stick, tapeStyle: pr.tapeStyle, helmetType: pr.helmetType, visor: pr.visor });
  g.local.color = pr.jersey;
  startGame(g);
};
$('go-tutorial').onclick = () => _startTutorial();

// ── Procházení ────────────────────────────────────────────────────────
let lastLobbyList = [];
function renderLobbyList(list) {
  lastLobbyList = list || [];
  const el = $('lobby-list'); el.innerHTML = '';
  if (!lastLobbyList.length) {
    el.innerHTML = `<div class="lobby-empty">${esc(t('lobby_empty'))}</div>`;
    return;
  }
  for (const l of lastLobbyList) {
    const div = document.createElement('div');
    div.className = 'lobby-item';
    const full = l.count >= l.max;
    const lock = l.hp ? '🔒 ' : '';
    let right;
    if (l.state === 'playing') {
      const tm = l.end ? t('live_end') : fmtClock(l.clk);
      const sc = l.score ? `${l.score.home}:${l.score.away}` : '0:0';
      right = `<div class="li-live"><div class="li-score">${sc}</div>` +
              `<div class="li-time">${tm} · ${l.per}/${l.pers}</div></div>`;
    } else {
      right = `<div class="li-cnt">${l.count}/${l.max}</div>`;
    }
    div.innerHTML = `<div><div class="li-name">${lock}${esc(l.name)}` +
      (l.state === 'playing' ? ' <span class="li-tag">LIVE</span>' : '') + `</div>` +
      `<div class="li-sub">${esc(l.home)} vs ${esc(l.away)} · ${l.count}/${l.max}</div></div>` + right;
    if (full) div.classList.add('full');
    div.onclick = () => {
      if (full) { setStatus(t('err_full'), '#e66'); return; }
      let pass;
      if (l.hp) { pass = prompt(t('prompt_password')); if (pass == null) return; }
      net.joinLobby(l.id, profile(), pass);
    };
    el.appendChild(div);
  }
}
net.onLobbyList = renderLobbyList;
const fmtClock = s => { s = Math.max(0, s|0); return Math.floor(s/60) + ':' + String(s%60).padStart(2,'0'); };
$('refresh-btn').onclick = () => net.listLobbies();
$('create-btn').onclick  = () => showView('create');
$('create-go').onclick   = () => net.createLobby(readSettings(), profile());
const joinInput = $('join-input'), joinBtn = $('join-btn');
joinBtn.onclick = () => {
  const code = joinInput.value.trim();
  if (!code) return;
  if (!commitProfile()) { requireProfile(); return; }
  net.joinLobby(code, profile(), null);
  joinInput.value = '';
};
joinInput.addEventListener('keydown', e => { if (e.key === 'Enter') joinBtn.click(); });

// ── Čekárna ───────────────────────────────────────────────────────────
function teamCol(tc, players) {
  return `<div class="wt-col" style="border-color:${tc.color}"><h3 style="color:${tc.color}">${esc(tc.name)}</h3>` +
    players.map(p => `<div class="wt-p${p.dc ? ' wt-p-dc' : ''}">${p.dc ? '⚠ ' : ''}${p.number != null ? '#'+p.number+' ' : ''}${esc(p.name || t('player'))}</div>`).join('') + `</div>`;
}
let lastWaitState = null;
function renderWait(st) {
  lastWaitState = st;
  showView('wait');
  $('wait-title').textContent = st.settings.name;
  const fmt = (st.settings.max/2) + 'v' + (st.settings.max/2);
  $('wait-info').textContent = `${fmt} · ${st.settings.periods}× ${st.settings.minutes} min · ${st.settings.rules ? t('mode_rules') : t('mode_arcade')}`;
  $('wait-teams').innerHTML =
    teamCol(st.settings.teams.home, st.players.filter(p => p.team === 'home')) +
    teamCol(st.settings.teams.away, st.players.filter(p => p.team === 'away'));
  const isHost = st.hostId === net.id;
  const sb = $('start-btn');
  sb.style.display = isHost ? '' : 'none';
  sb.disabled = st.players.length === 0;
}
net.onLobbyJoined = (st) => { lastLobbyId = st.id; localStorage.setItem('fh_last_lobby', st.id); setStatus(''); renderWait(st); };
net.onLobbyState  = (st) => { if (!inGame) renderWait(st); };
net.onLobbyError  = (code) => setStatus(t(code), '#ff4455');
document.querySelectorAll('.pick-btn').forEach(b => b.addEventListener('click', () => net.setTeam(b.dataset.team)));
$('start-btn').onclick   = () => net.startLobby();
$('wait-leave').onclick  = () => { net.leaveLobby(); lastLobbyId = null; localStorage.removeItem('fh_last_lobby'); showView('browse'); net.listLobbies(); };
$('share-btn').addEventListener('click', () => {
  if (!lastLobbyId) return;
  const url = location.origin + '/?join=' + lastLobbyId;
  navigator.clipboard?.writeText(url).then(() => {
    setStatus(t('link_copied'), '#6ee0a0');
    setTimeout(() => setStatus(''), 3000);
  }).catch(() => setStatus(url, '#8aa'));
});

// ── Post-match summary ────────────────────────────────────────────────
let _lastMatchRewards = null;
net.onMatchRewards = (data) => { _lastMatchRewards = data; };

function showMatchResult(rewards, game) {
  stopGame();
  showView('main');
  if (!rewards) return;
  const elo = rewards.rankDelta ?? 0;
  const cred = rewards.creditsDelta ?? 0;
  const pm = rewards.pm ?? 0;
  const titleEl = $('mr-result-title');
  titleEl.textContent = rewards.isWin ? 'VICTORY' : rewards.isLoss ? 'DEFEAT' : 'DRAW';
  titleEl.className = 'mr-result-title ' + (rewards.isWin ? 'win' : rewards.isLoss ? 'loss' : 'draw');
  const scoreEl = $('mr-score');
  if (game?.score && game?.teams) {
    const { home, away } = game.score;
    const hn = game.teams?.home?.name || 'HOME', an = game.teams?.away?.name || 'AWAY';
    scoreEl.textContent = `${hn}  ${home} : ${away}  ${an}`;
  } else { scoreEl.textContent = ''; }
  $('mr-goals').textContent = rewards.goals ?? 0;
  $('mr-assists').textContent = rewards.assists ?? 0;
  $('mr-pm').textContent = pm > 0 ? '+' + pm : pm;
  const eloEl = $('mr-elo');
  eloEl.textContent = (elo >= 0 ? '+' : '') + elo;
  eloEl.className = 'mr-reward-val ' + (elo > 0 ? 'elo-pos' : elo < 0 ? 'elo-neg' : 'elo-zero');
  $('mr-credits').textContent = '+' + cred + ' ⊙';
  $('mr-mvp-badge').style.display = rewards.isMVP ? '' : 'none';
  $('match-result').style.display = 'flex';
}

$('mr-close-btn').addEventListener('click', () => {
  $('match-result').style.display = 'none';
  _loadStats();
});

// ── Start hry ─────────────────────────────────────────────────────────
net.onLobbyStart = (data) => {
  if (inGame && currentGame?.stop) currentGame.stop();
  const g = new NetGame(canvas, net, net.id, data && data.settings);
  g.onExit = () => {
    const rewards = _lastMatchRewards;
    _lastMatchRewards = null;
    showMatchResult(rewards, g);
  };
  startGame(g);
};
net.onOnlineCount = ({ count }) => {
  const badge = $('nav-online-badge');
  if (!badge) return;
  badge.style.display = 'flex';
  const lbl = badge.querySelector('span:last-child');
  if (lbl) lbl.textContent = count + ' online';
};

function startGame(game) { inGame = true; currentGame = game; lobby.style.display = 'none'; canvas.style.cursor = 'crosshair'; game.start(); }
function stopGame()  { if (currentGame?.stop) currentGame.stop(); currentGame = null; inGame = false; lobby.style.display = ''; canvas.style.cursor = 'default'; }

function _startTutorial() {
  if (!hasName()) nameInput.value = suggestName();   // guest jméno pro hru
  const g = new TutorialGame(canvas);
  const pr = profile();
  Object.assign(g.local, { name: pr.name, handed: pr.handed, num: pr.number, helmet: pr.helmet, jersey: pr.jersey, shorts: pr.shorts, stripe: pr.stripe, laces: pr.laces, gloves: pr.gloves, tape: pr.tape, trail: pr.trail, stick: pr.stick, tapeStyle: pr.tapeStyle, helmetType: pr.helmetType, visor: pr.visor });
  g.local.color = pr.jersey;
  g.onComplete = (isFirst) => {
    stopGame();
    if (isFirst) { showView('profile'); drawPreview(); setStatus(t('welcome'), '#6ee0a0'); }
    else showView('main');
  };
  startGame(g);
}

// ── Esc menu / odpojení ───────────────────────────────────────────────
const pauseMenu = $('pause-menu'), pauseTitle = $('pause-title'), resumeBtn = $('resume-btn'), leaveBtn = $('leave-btn');
function showPause(title=t('pause'), disc=false) { currentGame?.input?.clear(); pauseTitle.textContent = title; resumeBtn.style.display = disc ? 'none' : ''; pauseMenu.style.display = 'flex'; }
const hidePause = () => pauseMenu.style.display = 'none';
resumeBtn.addEventListener('click', hidePause);
leaveBtn.addEventListener('click', () => { net.leaveLobby(); lastLobbyId = null; localStorage.removeItem('fh_last_lobby'); stopGame(); hidePause(); showView('main'); });
net.onPeerLeft = () => { if (inGame) currentGame?.notify?.(t('peer_left')); };  // hra běží dál, jen upozorni
window.addEventListener('keydown', e => { if (e.key !== 'Escape' || !inGame) return; pauseMenu.style.display === 'flex' ? hidePause() : showPause(); });
window.addEventListener('beforeunload', () => net.leaveLobby());

// ── Jazyk (CS/EN) ─────────────────────────────────────────────────────
$('lang-btn').onclick = () => toggleLang();
setOnChange(() => {                 // po přepnutí jazyka přerenderuj z cache (bez probliknutí)
  if ($('v-browse').style.display !== 'none') renderLobbyList(lastLobbyList);
  if ($('v-wait').style.display !== 'none' && lastWaitState) renderWait(lastWaitState);
});

// ── Auth UI ───────────────────────────────────────────────────────────
const authWrap    = $('auth-wrap');
const authBtn     = $('auth-btn');
const authLabel   = $('auth-label');
const authAvatar  = $('auth-avatar');
const authTier    = $('auth-tier');
const authDropdown = $('auth-dropdown');
const authModal   = $('auth-modal');

function updateAuthUI(user) {
  if (user) {
    authLabel.textContent = user.display_name;
    authTier.textContent  = user.is_sponsor ? '💎' : '';
    if (user.avatar_url) { authAvatar.src = user.avatar_url; authAvatar.style.display = 'block'; }
    else authAvatar.style.display = 'none';
    if (!nameInput.value.trim()) nameInput.value = user.display_name;
    isSponsor = !!user.is_sponsor;
    document.body.classList.toggle('sponsor', isSponsor);
  } else {
    authLabel.textContent = t('auth_label_guest');
    authTier.textContent  = '';
    authAvatar.style.display = 'none';
    isSponsor = false;
    document.body.classList.remove('sponsor');
  }
  authDropdown.classList.remove('open');
  // Zobraz/skryj Discord login banner + stats sekci v profilu
  $('profile-guest-login').style.display = user ? 'none' : '';
  $('profile-stats').style.display = 'none'; // stats se načítají lazy při otevření profilu
}

// Otevření/zavření dropdownu
authBtn.addEventListener('click', () => {
  if (!getUser()) {
    authDropdown.classList.remove('open');
    openAuthModal();
  } else {
    authDropdown.classList.toggle('open');
  }
});
document.addEventListener('click', e => {
  if (!authWrap.contains(e.target)) authDropdown.classList.remove('open');
});

// Settings dropdown
const settingsWrap = $('settings-wrap');
const settingsBtn  = $('settings-btn');
const settingsDrop = $('settings-dropdown');
settingsBtn.addEventListener('click', () => settingsDrop.classList.toggle('open'));
document.addEventListener('click', e => {
  if (!settingsWrap.contains(e.target)) settingsDrop.classList.remove('open');
});

$('footer-signin-btn')?.addEventListener('click', openAuthModal);
$('store-back-btn')?.addEventListener('click', () => { showView('main'); _loadStats(); });
$('splash-tutorial-btn').addEventListener('click', _startTutorial);
$('splash-discord-btn').addEventListener('click', loginWithDiscord);
$('splash-guest-btn').addEventListener('click', proceedAsGuest);
$('profile-discord-btn').addEventListener('click', loginWithDiscord);

$('dd-logout').addEventListener('click', async () => {
  await logout();
  authDropdown.classList.remove('open');
  showView('splash');
});
$('dd-profile').addEventListener('click', () => {
  authDropdown.classList.remove('open');
  showView('profile'); drawPreview();
});

// Modal
function openAuthModal() {
  authModal.classList.add('open');
}
function closeAuthModal() { authModal.classList.remove('open'); }

$('auth-close-btn').addEventListener('click', () => {
  closeAuthModal();
  if ($('v-splash').style.display !== 'none') proceedAsGuest();
});
authModal.addEventListener('click', e => { if (e.target === authModal) closeAuthModal(); });

$('discord-login-btn').addEventListener('click', loginWithDiscord);


onAuthChange(updateAuthUI);

// init
applyI18n();
updateVisorRow();
drawPreview();

const oauthResult = handleOAuthRedirect();
// Detekuj share link (?join=LOBBYID)
const _joinParam = new URLSearchParams(location.search).get('join');
if (_joinParam) history.replaceState(null, '', location.pathname);

// Nejdřív načti session, pak rozhoduj o view — aby se přihlášený uživatel nikdy nezobrazil na splash
loadSession().then(() => {
  if (oauthResult === 'ok') setStatus(t('login_ok'), '#6ee0a0');
  else if (oauthResult?.error) setStatus(t('login_fail') + oauthResult.error, '#ff4455');

  if (_joinParam) {
    // Share link — auto-join lobby
    if (!hasName()) {
      _pendingJoinId = _joinParam;
      requireProfile();
      setStatus(t('join_found'), '#ffcf3a');
    } else if (commitProfile()) {
      showView('browse');
      net.joinLobby(_joinParam, profile(), null);
    }
  } else {
    initFlow();
  }
});

setInterval(() => { if (!inGame && $('v-browse').style.display !== 'none') net.listLobbies(); }, 4000);
