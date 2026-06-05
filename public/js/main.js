import { Net } from './net.js';
import { Game, SandboxGame } from './game.js';
import { Tweaker } from './tweaker.js';

const canvas  = document.getElementById('canvas');
const lobby   = document.getElementById('lobby');
const roomInput = document.getElementById('room-input');
const joinBtn = document.getElementById('join-btn');
const soloBtn = document.getElementById('solo-btn');
const status  = document.getElementById('status');
const nameInput = document.getElementById('name-input');
const handBtns  = document.querySelectorAll('.hand-btn');
const LAST_ROOM_KEY = 'hockey_last_room';
const NAME_KEY = 'hockey_name';
const HAND_KEY = 'hockey_hand';
const saved = localStorage.getItem(LAST_ROOM_KEY);
if (saved) roomInput.value = saved;

// Jméno + ruka z localStorage
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

// Nastaví zvolené jméno/ruku na lokálního hráče
function applyProfile(game) {
  const name = (nameInput.value || '').trim().slice(0, 12);
  localStorage.setItem(NAME_KEY, name);
  if (game.local) {
    game.local.name   = name;
    game.local.handed = chosenHand;
  }
  return game;
}

new Tweaker();

function resizeCanvas() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

function startGame(game) {
  lobby.style.display = 'none';
  canvas.style.cursor = 'crosshair';
  game.start();
}

function setStatus(msg, color = '#888') {
  status.textContent = msg;
  status.style.color = color;
}

const signalingNet = new Net();

joinBtn.addEventListener('click', async () => {
  let roomId = roomInput.value.trim().toUpperCase();
  if (!roomId) {
    roomId = Math.random().toString(36).slice(2, 7).toUpperCase();
    roomInput.value = roomId;
  }

  setStatus('Connecting to signaling server...');
  joinBtn.disabled = true;
  localStorage.setItem(LAST_ROOM_KEY, roomId);

  const net = signalingNet;

  try {
    const { isHost, waiting } = await net.join(roomId);

    if (isHost) {
      setStatus(`Room ${roomId} created. Waiting for opponent...`, '#4488ff');
      net.onConnected = () => {
        setStatus('Connected! Starting...', '#44ff88');
        setTimeout(() => startGame(applyProfile(new Game(canvas, net, true))), 500);
      };
    } else {
      setStatus('Joined! Connecting P2P...', '#4488ff');
      net.onConnected = () => {
        setStatus('Connected! Starting...', '#44ff88');
        setTimeout(() => startGame(applyProfile(new Game(canvas, net, false))), 500);
      };
    }

    net.onDisconnected = () => {
      setStatus('Opponent disconnected.', '#ff4455');
      joinBtn.disabled = false;
    };
  } catch (e) {
    setStatus(e.message, '#ff4455');
    joinBtn.disabled = false;
  }
});

soloBtn.addEventListener('click', () => {
  startGame(applyProfile(new SandboxGame(canvas)));
});

roomInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') joinBtn.click();
});
