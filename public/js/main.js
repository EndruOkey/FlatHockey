import { Net } from './net.js';
import { Game, SandboxGame } from './game.js';
import { Tweaker } from './tweaker.js';

const canvas  = document.getElementById('canvas');
const lobby   = document.getElementById('lobby');
const roomInput = document.getElementById('room-input');
const joinBtn = document.getElementById('join-btn');
const soloBtn = document.getElementById('solo-btn');
const status  = document.getElementById('status');
const LAST_ROOM_KEY = 'hockey_last_room';
const saved = localStorage.getItem(LAST_ROOM_KEY);
if (saved) roomInput.value = saved;

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
        setTimeout(() => startGame(new Game(canvas, net, true)), 500);
      };
    } else {
      setStatus('Joined! Connecting P2P...', '#4488ff');
      net.onConnected = () => {
        setStatus('Connected! Starting...', '#44ff88');
        setTimeout(() => startGame(new Game(canvas, net, false)), 500);
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
  startGame(new SandboxGame(canvas));
});

roomInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') joinBtn.click();
});
