import { Net } from './net.js';
import { NetGame, SandboxGame } from './game.js';

const $ = id => document.getElementById(id);
const canvas = $('canvas');
const lobby  = $('lobby');
const status = $('status');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Předdefinovaná paleta (podrobný picker přijde později)
const PALETTE = ['#3a9fff','#1b4fd1','#ff4455','#b81d3a','#19c37d','#0c7a4a',
                 '#ffcf3a','#ff8a1e','#9b5cff','#ff5bd0','#f4f7fb','#1a1f29'];
function makeSwatches(el, initial) {
  let value = PALETTE.includes(initial) ? initial : PALETTE[0];
  el.innerHTML = '';
  PALETTE.forEach(c => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sw' + (c === value ? ' active' : '');
    b.style.background = c;
    b.addEventListener('click', () => {
      value = c;
      [...el.children].forEach(x => x.classList.remove('active'));
      b.classList.add('active');
    });
    el.appendChild(b);
  });
  return { get: () => value };
}

// ── Profil ────────────────────────────────────────────────────────────
const nameInput = $('name-input'), numInput = $('num-input');
const handBtns  = document.querySelectorAll('.hand-btn');
const NAME_KEY='hockey_name', HAND_KEY='hockey_hand', NUM_KEY='hockey_num';
const GK = { helmet:'hockey_helmet', gloves:'hockey_gloves', tape:'hockey_tape' };

nameInput.value = localStorage.getItem(NAME_KEY) || '';
numInput.value  = localStorage.getItem(NUM_KEY) || '';
let chosenHand = parseInt(localStorage.getItem(HAND_KEY) || '1', 10);
const refreshHand = () => handBtns.forEach(b => b.classList.toggle('active', parseInt(b.dataset.hand,10) === chosenHand));
refreshHand();
handBtns.forEach(b => b.addEventListener('click', () => { chosenHand = parseInt(b.dataset.hand,10); localStorage.setItem(HAND_KEY,String(chosenHand)); refreshHand(); }));
numInput.addEventListener('change', () => localStorage.setItem(NUM_KEY, numInput.value));

const swHelmet = makeSwatches($('sw-helmet'), localStorage.getItem(GK.helmet) || '#f4f7fb');
const swGloves = makeSwatches($('sw-gloves'), localStorage.getItem(GK.gloves) || '#1a1f29');
const swTape   = makeSwatches($('sw-tape'),   localStorage.getItem(GK.tape)   || '#1a1f29');

function profile() {
  const name = (nameInput.value || '').trim().slice(0, 12);
  localStorage.setItem(NAME_KEY, name);
  localStorage.setItem(GK.helmet, swHelmet.get());
  localStorage.setItem(GK.gloves, swGloves.get());
  localStorage.setItem(GK.tape,   swTape.get());
  const n = parseInt(numInput.value, 10);
  return {
    name, handed: chosenHand,
    number: Number.isFinite(n) ? Math.max(0, Math.min(99, n)) : null,
    helmet: swHelmet.get(), gloves: swGloves.get(), tape: swTape.get(),
  };
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
      home: { name: (hName.value||'').trim() || 'Domácí', color: swHome.get(), style: hStyle.value },
      away: { name: (aName.value||'').trim() || 'Hosté',  color: swAway.get(), style: aStyle.value },
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

// ── Hlavní menu ───────────────────────────────────────────────────────
$('go-profile').onclick = () => showView('profile');
$('go-online').onclick  = () => { showView('browse'); net.listLobbies(); };
$('go-solo').onclick     = () => {
  const g = new SandboxGame(canvas), pr = profile();
  Object.assign(g.local, { name: pr.name, handed: pr.handed, num: pr.number, helmet: pr.helmet, gloves: pr.gloves, tape: pr.tape });
  startGame(g);
};

// ── Procházení ────────────────────────────────────────────────────────
net.onLobbyList = (list) => {
  const el = $('lobby-list'); el.innerHTML = '';
  if (!list || list.length === 0) {
    el.innerHTML = '<div class="lobby-empty">Žádná otevřená lobby — vytvoř první.</div>';
    return;
  }
  for (const l of list) {
    const div = document.createElement('div');
    div.className = 'lobby-item';
    const full = l.count >= l.max;
    const lock = l.hp ? '🔒 ' : '';
    let right;
    if (l.state === 'playing') {
      const t = l.end ? 'KONEC' : fmtClock(l.clk);
      const sc = l.score ? `${l.score.home}:${l.score.away}` : '0:0';
      right = `<div class="li-live"><div class="li-score">${sc}</div>` +
              `<div class="li-time">${t} · ${l.per}/${l.pers}</div></div>`;
    } else {
      right = `<div class="li-cnt">${l.count}/${l.max}</div>`;
    }
    div.innerHTML = `<div><div class="li-name">${lock}${esc(l.name)}` +
      (l.state === 'playing' ? ' <span class="li-tag">LIVE</span>' : '') + `</div>` +
      `<div class="li-sub">${esc(l.home)} vs ${esc(l.away)} · ${l.count}/${l.max}</div></div>` + right;
    if (full) div.classList.add('full');
    div.onclick = () => {
      if (full) { setStatus('Lobby je plné.', '#e66'); return; }
      let pass;
      if (l.hp) { pass = prompt('Heslo lobby:'); if (pass == null) return; }
      net.joinLobby(l.id, profile(), pass);
    };
    el.appendChild(div);
  }
};
const fmtClock = s => { s = Math.max(0, s|0); return Math.floor(s/60) + ':' + String(s%60).padStart(2,'0'); };
$('refresh-btn').onclick = () => net.listLobbies();
$('create-btn').onclick  = () => showView('create');
$('create-go').onclick   = () => net.createLobby(readSettings(), profile());

// ── Čekárna ───────────────────────────────────────────────────────────
function teamCol(t, players) {
  return `<div class="wt-col" style="border-color:${t.color}"><h3 style="color:${t.color}">${esc(t.name)}</h3>` +
    players.map(p => `<div class="wt-p">${p.number != null ? '#'+p.number+' ' : ''}${esc(p.name || 'hráč')}</div>`).join('') + `</div>`;
}
function renderWait(st) {
  showView('wait');
  $('wait-title').textContent = st.settings.name;
  const fmt = (st.settings.max/2) + 'v' + (st.settings.max/2);
  $('wait-info').textContent = `${fmt} · ${st.settings.periods}× ${st.settings.minutes} min · ${st.settings.rules ? 'pravidla' : 'arkáda'}`;
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
net.onLobbyError  = (msg) => setStatus(msg, '#ff4455');
document.querySelectorAll('.pick-btn').forEach(b => b.addEventListener('click', () => net.setTeam(b.dataset.team)));
$('start-btn').onclick   = () => net.startLobby();
$('wait-leave').onclick  = () => { net.leaveLobby(); showView('browse'); net.listLobbies(); };

// ── Start hry ─────────────────────────────────────────────────────────
net.onLobbyStart = (data) => startGame(new NetGame(canvas, net, net.id, data && data.settings));
function startGame(game) { inGame = true; currentGame = game; lobby.style.display = 'none'; canvas.style.cursor = 'crosshair'; game.start(); }

// ── Esc menu / odpojení ───────────────────────────────────────────────
const pauseMenu = $('pause-menu'), pauseTitle = $('pause-title'), resumeBtn = $('resume-btn'), leaveBtn = $('leave-btn');
function showPause(title='PAUZA', disc=false) { currentGame?.input?.clear(); pauseTitle.textContent = title; resumeBtn.style.display = disc ? 'none' : ''; pauseMenu.style.display = 'flex'; }
const hidePause = () => pauseMenu.style.display = 'none';
resumeBtn.addEventListener('click', hidePause);
leaveBtn.addEventListener('click', () => { net.leaveLobby(); location.reload(); });
net.onPeerLeft = () => { if (inGame) showPause('SOUPEŘ SE ODPOJIL', true); };
window.addEventListener('keydown', e => { if (e.key !== 'Escape' || !inGame) return; pauseMenu.style.display === 'flex' ? hidePause() : showPause(); });
window.addEventListener('beforeunload', () => net.leaveLobby());

// init
showView('main');
setInterval(() => { if (!inGame && $('v-browse').style.display !== 'none') net.listLobbies(); }, 4000);
