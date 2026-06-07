import { Net } from './net.js';
import { NetGame, SandboxGame } from './game.js';
import { Tweaker } from './tweaker.js';

const $ = id => document.getElementById(id);
const canvas = $('canvas');
const lobby  = $('lobby');
const status = $('status');

// Profil
const nameInput = $('name-input');
const numInput  = $('num-input');
const handBtns  = document.querySelectorAll('.hand-btn');
// Views
const browseView = $('browse-view'), createView = $('create-view'), waitView = $('wait-view');
const lobbyList  = $('lobby-list');
// Create form
const lobbyName = $('lobby-name');
const hName = $('hteam-name'), hColor = $('hteam-color'), hStyle = $('hteam-style');
const aName = $('ateam-name'), aColor = $('ateam-color'), aStyle = $('ateam-style');
const setPeriods = $('set-periods'), setMinutes = $('set-minutes'), setMax = $('set-max'), setRules = $('set-rules');
// Wait
const waitTitle = $('wait-title'), waitInfo = $('wait-info'), waitTeams = $('wait-teams'), startBtn = $('start-btn');
// Pause
const pauseMenu = $('pause-menu'), pauseTitle = $('pause-title'), resumeBtn = $('resume-btn'), leaveBtn = $('leave-btn');

const NAME_KEY = 'hockey_name', HAND_KEY = 'hockey_hand', NUM_KEY = 'hockey_num';
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

nameInput.value = localStorage.getItem(NAME_KEY) || '';
numInput.value  = localStorage.getItem(NUM_KEY) || '';
let chosenHand = parseInt(localStorage.getItem(HAND_KEY) || '1', 10);
function refreshHand() { handBtns.forEach(b => b.classList.toggle('active', parseInt(b.dataset.hand, 10) === chosenHand)); }
refreshHand();
handBtns.forEach(b => b.addEventListener('click', () => { chosenHand = parseInt(b.dataset.hand, 10); localStorage.setItem(HAND_KEY, String(chosenHand)); refreshHand(); }));
numInput.addEventListener('change', () => localStorage.setItem(NUM_KEY, numInput.value));

function profile() {
  const name = (nameInput.value || '').trim().slice(0, 12);
  localStorage.setItem(NAME_KEY, name);
  const n = parseInt(numInput.value, 10);
  return { name, handed: chosenHand, number: Number.isFinite(n) ? Math.max(0, Math.min(99, n)) : null };
}

new Tweaker();
function resizeCanvas() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

const net = new Net();
let currentLobby = null;
let inGame = false;

function setStatus(msg, color = '#888') { status.textContent = msg; status.style.color = color; }
function showView(v) {
  browseView.style.display = v === 'browse' ? '' : 'none';
  createView.style.display = v === 'create' ? '' : 'none';
  waitView.style.display   = v === 'wait'   ? '' : 'none';
}

// ── Procházení lobby ──────────────────────────────────────────────────
net.onLobbyList = (list) => {
  lobbyList.innerHTML = '';
  for (const l of list) {
    const div = document.createElement('div');
    div.className = 'lobby-item';
    div.innerHTML = `<div><div class="li-name">${esc(l.name)}</div>` +
      `<div class="li-sub">${esc(l.home)} vs ${esc(l.away)}</div></div>` +
      `<div class="li-cnt">${l.count}/${l.max}</div>`;
    div.onclick = () => net.joinLobby(l.id, profile());
    lobbyList.appendChild(div);
  }
};
$('refresh-btn').onclick = () => net.listLobbies();
$('create-btn').onclick  = () => showView('create');
$('solo-btn').onclick     = () => { const g = new SandboxGame(canvas); g.local.name = profile().name; g.local.handed = chosenHand; g.local.num = profile().number; startGame(g); };

// ── Vytvoření lobby ───────────────────────────────────────────────────
function readSettings() {
  return {
    name: (lobbyName.value || '').trim() || 'Lobby',
    teams: {
      home: { name: (hName.value || '').trim() || 'Domácí', color: hColor.value, style: hStyle.value },
      away: { name: (aName.value || '').trim() || 'Hosté',  color: aColor.value, style: aStyle.value },
    },
    periods: parseInt(setPeriods.value, 10),
    minutes: parseInt(setMinutes.value, 10),
    max:     parseInt(setMax.value, 10),
    rules:   setRules.checked,
  };
}
$('create-go').onclick   = () => net.createLobby(readSettings(), profile());
$('create-back').onclick = () => showView('browse');

// ── Čekárna ───────────────────────────────────────────────────────────
function teamCol(t, players) {
  return `<div class="wt-col" style="border-color:${t.color}"><h3 style="color:${t.color}">${esc(t.name)}</h3>` +
    players.map(p => `<div class="wt-p">${p.number != null ? '#' + p.number + ' ' : ''}${esc(p.name || 'hráč')}</div>`).join('') +
    `</div>`;
}
function renderWait(st) {
  currentLobby = st;
  showView('wait');
  waitTitle.textContent = st.settings.name;
  waitInfo.textContent = `${st.settings.periods}× ${st.settings.minutes} min · ${st.settings.rules ? 'pravidla' : 'arkáda'} · max ${st.settings.max}`;
  const home = st.players.filter(p => p.team === 'home');
  const away = st.players.filter(p => p.team === 'away');
  waitTeams.innerHTML = teamCol(st.settings.teams.home, home) + teamCol(st.settings.teams.away, away);
  const isHost = st.hostId === net.id;
  startBtn.style.display = isHost ? '' : 'none';
  startBtn.disabled = st.players.length === 0;
}
net.onLobbyJoined = (st) => { setStatus(''); renderWait(st); };
net.onLobbyState  = (st) => { if (!inGame) renderWait(st); };
net.onLobbyError  = (msg) => setStatus(msg, '#ff4455');
document.querySelectorAll('.pick-btn').forEach(b => b.addEventListener('click', () => net.setTeam(b.dataset.team)));
startBtn.onclick   = () => net.startLobby();
$('wait-leave').onclick = () => { net.leaveLobby(); showView('browse'); net.listLobbies(); };

// ── Start hry ─────────────────────────────────────────────────────────
net.onLobbyStart = () => { startGame(new NetGame(canvas, net, net.id)); };

function startGame(game) {
  inGame = true;
  lobby.style.display = 'none';
  canvas.style.cursor = 'crosshair';
  game.start();
}

// ── Esc menu / odpojení ───────────────────────────────────────────────
function showPauseMenu(title = 'PAUZA', disconnected = false) {
  pauseTitle.textContent = title;
  resumeBtn.style.display = disconnected ? 'none' : '';
  pauseMenu.style.display = 'flex';
}
function hidePauseMenu() { pauseMenu.style.display = 'none'; }
resumeBtn.addEventListener('click', hidePauseMenu);
leaveBtn.addEventListener('click', () => { net.leaveLobby(); location.reload(); });
net.onPeerLeft = () => { if (inGame) showPauseMenu('SOUPEŘ SE ODPOJIL', true); };
window.addEventListener('keydown', e => {
  if (e.key !== 'Escape' || !inGame) return;
  pauseMenu.style.display === 'flex' ? hidePauseMenu() : showPauseMenu('PAUZA', false);
});
window.addEventListener('beforeunload', () => net.leaveLobby());

// init
showView('browse');
net.listLobbies();
setInterval(() => { if (!inGame && browseView.style.display !== 'none') net.listLobbies(); }, 4000);
