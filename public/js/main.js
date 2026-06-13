import { Net } from './net.js';
import { NetGame, SandboxGame, TutorialGame } from './game.js';
import { Player } from './entities/Player.js';
import { PLAYER, RINK } from './constants.js';
import { t, applyI18n, toggleLang, setOnChange } from './i18n.js';
import { setVolume, getVolume } from './sound.js';
import { loadSession, onAuthChange, loginWithDiscord, logout, handleOAuthRedirect, getUser } from './auth.js';

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
  return { get: () => value };
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
  return { get: () => value };
}

// ── Profil ────────────────────────────────────────────────────────────
const nameInput = $('name-input'), numInput = $('num-input');
const handBtns  = document.querySelectorAll('.hand-btn');
const NAME_KEY='hockey_name', HAND_KEY='hockey_hand', NUM_KEY='hockey_num';
const GK = { helmet:'hockey_helmet', gloves:'hockey_gloves', tape:'hockey_tape', trail:'hockey_trail',
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

const swHelmet = makeSwatches($('sw-helmet'), localStorage.getItem(GK.helmet) || '#f4f7fb', drawPreview);
const swGloves = makeSwatches($('sw-gloves'), localStorage.getItem(GK.gloves) || '#1a1f29', drawPreview);
const swStick  = makeSwatches($('sw-stick'),  localStorage.getItem(GK.stick)  || '#1a1f29', drawPreview, { colors: STICK_PALETTE });
const swTape   = makeSwatches($('sw-tape'),   localStorage.getItem(GK.tape)   || '#1a1f29', drawPreview);
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
// Řádek barvy vizoru ukaž jen u typů, kde dává smysl (vizír / akvárko)
function updateVisorRow() {
  const ht = chHelmetType.get();
  $('gear-visor').style.display = (ht === 'visor' || ht === 'shield') ? '' : 'none';
}

function profile() {
  const name = (nameInput.value || '').trim().slice(0, 14);
  localStorage.setItem(NAME_KEY, name);
  localStorage.setItem(GK.helmet, swHelmet.get());
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
    helmet: swHelmet.get(), gloves: swGloves.get(), tape: swTape.get(), trail: swTrail.get(),
    stick: swStick.get(), tapeStyle: chTapeStyle.get(), helmetType: chHelmetType.get(), visor: swVisor.get(),
  };
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
previewPlayer.color = '#3a9fff';                             // neutrální dres (barva týmu se volí v lobby)

function drawPreview() {
  const c = prevCanvas, ctx = prevCtx;
  if (!c || !ctx) return;
  ctx.clearRect(0, 0, c.width, c.height);
  const p = previewPlayer;
  p.handed = chosenHand;
  p.helmet = swHelmet.get(); p.gloves = swGloves.get(); p.tape = swTape.get();
  p.stick = swStick.get(); p.tapeStyle = chTapeStyle.get(); p.helmetType = chHelmetType.get(); p.visor = swVisor.get();
  const n = parseInt(numInput.value, 10);
  p.num  = Number.isFinite(n) ? Math.max(0, Math.min(99, n)) : null;
  p.name = (nameInput.value || '').trim();
  const S = 4.2;
  const cam = { scale: S, ox: c.width / 2 - p.x * S, oy: c.height * 0.44 - p.y * S };
  p.draw(ctx, cam);
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
const VIEWS = { main:'v-main', profile:'v-profile', browse:'v-browse', create:'v-create', wait:'v-wait' };
function showView(name) {
  for (const [k, id] of Object.entries(VIEWS)) $(id).style.display = (k === name) ? '' : 'none';
}
document.querySelectorAll('.back').forEach(b => b.addEventListener('click', () => {
  if (!b.dataset.to) return;                           // tlačítka s vlastní logikou (profile-done)
  showView(b.dataset.to);
  if (b.dataset.to === 'browse') net.listLobbies();   // čerstvý seznam při návratu
}));

function resizeCanvas() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

const net = new Net();
let inGame = false;
let currentGame = null;
const setStatus = (m, c = '#888') => { status.textContent = m; status.style.color = c; };

// ── Profil — povinný (bez přezdívky nepustíme dál) ────────────────────
const hasName = () => (nameInput.value || '').trim().length > 0;
const suggestName = () => t('guest_name') + Math.floor(100 + Math.random() * 900);
function commitProfile() {
  if (!hasName()) { setStatus(t('name_required'), '#ffcf3a'); nameInput.focus(); return false; }
  profile();                 // ulož jméno + výbavu
  setStatus('');
  return true;
}
function requireProfile() {   // jemné navedení na profil (ne tvrdá zeď)
  if (!hasName()) nameInput.value = suggestName();   // předvyplň návrh → nikdo nezůstane zaseklý
  showView('profile'); drawPreview();
  setStatus(t('welcome'), '#6ee0a0');
  setTimeout(() => { try { nameInput.focus(); nameInput.select(); } catch {} }, 60);
}
$('profile-done').onclick = () => { if (commitProfile()) showView('main'); };

// ── Hlavní menu ───────────────────────────────────────────────────────
$('go-profile').onclick = () => { showView('profile'); drawPreview(); };
$('go-online').onclick  = () => { if (!commitProfile()) return requireProfile(); showView('browse'); net.listLobbies(); };
$('go-solo').onclick     = () => {
  if (!commitProfile()) return requireProfile();
  const g = new SandboxGame(canvas), pr = profile();
  Object.assign(g.local, { name: pr.name, handed: pr.handed, num: pr.number, helmet: pr.helmet, gloves: pr.gloves, tape: pr.tape, trail: pr.trail, stick: pr.stick, tapeStyle: pr.tapeStyle, helmetType: pr.helmetType, visor: pr.visor });
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

// ── Čekárna ───────────────────────────────────────────────────────────
function teamCol(tc, players) {
  return `<div class="wt-col" style="border-color:${tc.color}"><h3 style="color:${tc.color}">${esc(tc.name)}</h3>` +
    players.map(p => `<div class="wt-p">${p.number != null ? '#'+p.number+' ' : ''}${esc(p.name || t('player'))}</div>`).join('') + `</div>`;
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
net.onLobbyJoined = (st) => { setStatus(''); renderWait(st); };
net.onLobbyState  = (st) => { if (!inGame) renderWait(st); };
net.onLobbyError  = (code) => setStatus(t(code), '#ff4455');
document.querySelectorAll('.pick-btn').forEach(b => b.addEventListener('click', () => net.setTeam(b.dataset.team)));
$('start-btn').onclick   = () => net.startLobby();
$('wait-leave').onclick  = () => { net.leaveLobby(); showView('browse'); net.listLobbies(); };

// ── Start hry ─────────────────────────────────────────────────────────
net.onLobbyStart = (data) => {
  if (inGame && currentGame?.stop) currentGame.stop();
  startGame(new NetGame(canvas, net, net.id, data && data.settings));
};
function startGame(game) { inGame = true; currentGame = game; lobby.style.display = 'none'; canvas.style.cursor = 'crosshair'; game.start(); }
function stopGame()  { if (currentGame?.stop) currentGame.stop(); currentGame = null; inGame = false; lobby.style.display = ''; canvas.style.cursor = 'default'; }

function _startTutorial() {
  if (!hasName()) nameInput.value = suggestName();   // guest jméno pro hru
  const g = new TutorialGame(canvas);
  const pr = profile();
  Object.assign(g.local, { name: pr.name, handed: pr.handed, num: pr.number, helmet: pr.helmet, gloves: pr.gloves, tape: pr.tape, trail: pr.trail, stick: pr.stick, tapeStyle: pr.tapeStyle, helmetType: pr.helmetType, visor: pr.visor });
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
leaveBtn.addEventListener('click', () => { net.leaveLobby(); location.reload(); });
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
const authMsg     = $('auth-msg');

function updateAuthUI(user) {
  if (user) {
    authLabel.textContent = user.display_name;
    authTier.textContent  = user.is_sponsor ? '💎' : '';
    if (user.avatar_url) { authAvatar.src = user.avatar_url; authAvatar.style.display = 'block'; }
    else authAvatar.style.display = 'none';
    // Synchronizuj jméno do profilu (pokud ještě nemá vlastní)
    if (!nameInput.value.trim()) nameInput.value = user.display_name;
    // Sponsor přístup — synchronizuj vždy (i při odhlášení)
    isSponsor = !!user.is_sponsor;
    document.body.classList.toggle('sponsor', isSponsor);
  } else {
    authLabel.textContent = '👤 Přihlásit se';
    authTier.textContent  = '';
    authAvatar.style.display = 'none';
    isSponsor = false;
    document.body.classList.remove('sponsor');
  }
  authDropdown.classList.remove('open');
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

$('dd-logout').addEventListener('click', async () => {
  await logout();
  authDropdown.classList.remove('open');
});
$('dd-profile').addEventListener('click', () => {
  authDropdown.classList.remove('open');
  showView('profile'); drawPreview();
});

// Modal
function openAuthModal() {
  authMsg.textContent = '';
  $('magic-email').value = '';
  authModal.classList.add('open');
}
function closeAuthModal() { authModal.classList.remove('open'); }

$('auth-close-btn').addEventListener('click', closeAuthModal);
authModal.addEventListener('click', e => { if (e.target === authModal) closeAuthModal(); });

$('discord-login-btn').addEventListener('click', loginWithDiscord);


onAuthChange(updateAuthUI);

// init
applyI18n();
updateVisorRow();
drawPreview();

// Auth: načti session + zpracuj OAuth redirect
const oauthResult = handleOAuthRedirect();
loadSession().then(() => {
  if (oauthResult === 'ok') setStatus('✅ Přihlášení úspěšné!', '#6ee0a0');
  else if (oauthResult?.error) setStatus('❌ Přihlášení selhalo: ' + oauthResult.error, '#ff4455');
});

if (hasName()) showView('main');
else if (!localStorage.getItem('hockey_tutorial_done')) _startTutorial();  // první návštěva → tutorial → profil
else requireProfile();
setInterval(() => { if (!inGame && $('v-browse').style.display !== 'none') net.listLobbies(); }, 4000);
