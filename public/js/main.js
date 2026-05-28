import { Net } from './net.js';
import { Game, SoloGame } from './game.js';

const canvas  = document.getElementById('canvas');
const lobby   = document.getElementById('lobby');
const roomInput = document.getElementById('room-input');
const joinBtn = document.getElementById('join-btn');
const soloBtn = document.getElementById('solo-btn');
const status  = document.getElementById('status');

function resizeCanvas() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

function startGame(game) {
  lobby.style.display = 'none';
  canvas.style.cursor = 'none';
  game.start();
}

function setStatus(msg, color = '#888') {
  status.textContent = msg;
  status.style.color = color;
}

joinBtn.addEventListener('click', async () => {
  let roomId = roomInput.value.trim().toUpperCase();
  if (!roomId) {
    roomId = Math.random().toString(36).slice(2, 7).toUpperCase();
    roomInput.value = roomId;
  }

  setStatus('Connecting to signaling server...');
  joinBtn.disabled = true;

  const net = new Net();

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
  startGame(new SoloGame(canvas));
});

roomInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') joinBtn.click();
});
