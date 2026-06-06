import { Net } from './net.js';
import { NetGame, SandboxGame } from './game.js';
import { Tweaker } from './tweaker.js';

const canvas  = document.getElementById('canvas');
const lobby   = document.getElementById('lobby');
const roomInput = document.getElementById('room-input');
const joinBtn = document.getElementById('join-btn');
const soloBtn = document.getElementById('solo-btn');
const status  = document.getElementById('status');
const nameInput = document.getElementById('name-input');
const handBtns  = document.querySelectorAll('.hand-btn');
const pauseMenu = document.getElementById('pause-menu');
const pauseTitle = document.getElementById('pause-title');
const resumeBtn = document.getElementById('resume-btn');
const leaveBtn  = document.getElementById('leave-btn');
const LAST_ROOM_KEY = 'hockey_last_room';
const NAME_KEY = 'hockey_name';
const HAND_KEY = 'hockey_hand';
const saved = localStorage.getItem(LAST_ROOM_KEY);
if (saved) roomInput.value = saved;

nameInput.value = localStorage.getItem(NAME_KEY) || '';
let chosenHand = parseInt(localStorage.getItem(HAND_KEY) || '1', 10);
function refreshHand() {
  handBtns.forEach(b => b.classList.toggle('active', parseInt(b.dataset.hand, 10) === chosenHand));
}
refreshHand();
handBtns.forEach(b => b.addEventListener('click', () => {
  chosenHand = parseInt(b.dataset.hand, 10);
  localStorage.setItem(HAND_KEY, String(chosenHand));
  refreshHand();
}));

function profileName() {
  const name = (nameInput.value || '').trim().slice(0, 12);
  localStorage.setItem(NAME_KEY, name);
  return name;
}
// solo: nastav jméno/ruku přímo na lokálního hráče
function applyProfile(game) {
  if (game.local) { game.local.name = profileName(); game.local.handed = chosenHand; }
  return game;
}

new Tweaker();

function resizeCanvas() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

let currentNet = null;

function startGame(game) {
  lobby.style.display = 'none';
  canvas.style.cursor = 'crosshair';
  currentNet = game.net ?? null;
  if (currentNet) currentNet.onPeerLeft = () => showPauseMenu('SOUPEŘ SE ODPOJIL', true);
  game.start();
}

function setStatus(msg, color = '#888') {
  status.textContent = msg;
  status.style.color = color;
}

// ── Esc menu / odpojení ──────────────────────────────────────────────
function showPauseMenu(title = 'PAUZA', disconnected = false) {
  pauseTitle.textContent = title;
  resumeBtn.style.display = disconnected ? 'none' : '';
  pauseMenu.style.display = 'flex';
}
function hidePauseMenu() { pauseMenu.style.display = 'none'; }

resumeBtn.addEventListener('click', hidePauseMenu);
leaveBtn.addEventListener('click', () => { currentNet?.leave(); location.reload(); });
window.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  if (lobby.style.display !== 'none') return;
  if (pauseMenu.style.display === 'flex') hidePauseMenu(); else showPauseMenu('PAUZA', false);
});
window.addEventListener('beforeunload', () => currentNet?.leave());
window.addEventListener('pagehide',     () => currentNet?.leave());

// ── Online ────────────────────────────────────────────────────────────
joinBtn.addEventListener('click', () => {
  let roomId = roomInput.value.trim().toUpperCase();
  if (!roomId) { roomId = Math.random().toString(36).slice(2, 7).toUpperCase(); roomInput.value = roomId; }
  localStorage.setItem(LAST_ROOM_KEY, roomId);
  setStatus('Připojuji…', '#4488ff');
  joinBtn.disabled = true;

  const net = new Net();
  net.onFull = () => { setStatus('Místnost je plná.', '#ff4455'); joinBtn.disabled = false; };
  net.onJoined = ({ id, team }) => {
    setStatus('Připojeno!', '#44ff88');
    startGame(new NetGame(canvas, net, id, team));
  };
  net.join(roomId, profileName(), chosenHand);
});

soloBtn.addEventListener('click', () => {
  startGame(applyProfile(new SandboxGame(canvas)));
});

roomInput.addEventListener('keydown', e => { if (e.key === 'Enter') joinBtn.click(); });
