import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

import { World } from './public/js/world.js';
import { Player } from './public/js/entities/Player.js';
import { Puck } from './public/js/entities/Puck.js';
import { Goalie } from './public/js/entities/Goalie.js';
import { Rink } from './public/js/entities/Rink.js';
import { RINK, PUCK } from './public/js/constants.js';
import { lerpAngle, clamp } from './public/js/utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-store'),
}));

// ── Authoritativní simulace ──────────────────────────────────────────────
const CHARGE_RATE = 1.8;
const TICK_HZ = 60;
const SNAP_HZ = 30;            // snapshot každý druhý tick
const DT = 1 / TICK_HZ;

const rooms = new Map();  // roomId -> match

function makeInput() {
  return {
    dx: 0, dy: 0, shift: false, lmb: false, rmb: false, mmb: false,
    aim: 0, aimDist: 100, keys: { Space: false },
    lmbJustPressed: false, lmbJustReleased: false, rmbJustPressed: false, mmbJustPressed: false,
    _p: { lmb: false, rmb: false, mmb: false }, // předchozí stav pro hrany
  };
}

// Aplikuj přijatý stav vstupu na input objekt + spočítej hrany
function applyClientInput(inp, msg) {
  inp.dx = msg.dx | 0; inp.dy = msg.dy | 0;
  inp.shift = !!msg.shift; inp.keys.Space = !!msg.space;
  inp.lmb = !!msg.lmb; inp.rmb = !!msg.rmb; inp.mmb = !!msg.mmb;
  if (typeof msg.aim === 'number') inp.aim = msg.aim;
  if (typeof msg.aimDist === 'number') inp.aimDist = msg.aimDist;
}

function computeEdges(inp) {
  inp.lmbJustPressed  = inp.lmb && !inp._p.lmb;
  inp.lmbJustReleased = !inp.lmb && inp._p.lmb;
  inp.rmbJustPressed  = inp.rmb && !inp._p.rmb;
  inp.mmbJustPressed  = inp.mmb && !inp._p.mmb;
  inp._p.lmb = inp.lmb; inp._p.rmb = inp.rmb; inp._p.mmb = inp.mmb;
}

function _updateAim(p, rawAim, dt) {
  const d = p.aimDist ?? 100;
  const rate = clamp(d / 35, 0.12, 1) * 28;
  p.aimAngle = lerpAngle(p.aimAngle, rawAim, Math.min(1, rate * dt));
}

function leadAim(from, target, speed) {
  let tx = target.x, ty = target.y;
  if (target.isPlayer) { const a = target.aimAngle ?? 0; tx += Math.cos(a) * 16; ty += Math.sin(a) * 16; }
  const dist = Math.hypot(tx - from.x, ty - from.y) || 1;
  const t = dist / speed;
  return Math.atan2((ty + (target.vy || 0) * t) - from.y, (tx + (target.vx || 0) * t) - from.x);
}

function nearestOther(p, match) {
  let best = null, bd = Infinity;
  for (const o of match.players.values()) {
    if (o === p) continue;
    const d = Math.hypot(o.x - p.x, o.y - p.y);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}

// Autoritativní akce hráče (charge/střela/přihrávka/aim) — z game._tick
function playerActions(p, inp, dt, match) {
  p.aimDist = inp.aimDist;
  _updateAim(p, inp.aim, dt);

  if (inp.lmbJustPressed) { p._chargeCancelled = false; p._oneTimer = !p.hasPuck; }
  if (!inp.lmb) p._chargeBlocked = false;

  if (inp.rmb && !p.hasPuck && p.charge > 0) {
    p.charge = 0; p._chargeDecaying = false; p.overcharged = false; p._oneTimer = false;
  }

  if (inp.lmb && !p._chargeBlocked && !(inp.rmb && !p.hasPuck)) {
    if (!p._chargeDecaying) {
      const cap = (p.hasPuck && !p._oneTimer) ? 1 : 0.95;
      p.charge = Math.min(cap, p.charge + CHARGE_RATE * dt);
      if (p.charge >= 1 && p.hasPuck && !p._oneTimer) { p._chargeDecaying = true; p.overcharged = true; }
    } else if (p.hasPuck) {
      p.charge = Math.max(0, p.charge - CHARGE_RATE * 1.8 * dt);
      if (p.charge <= 0) { p.shoot(match.puck, 0.12); p.charge = 0; p._chargeDecaying = false; p.overcharged = false; }
    } else { p._chargeDecaying = false; p.overcharged = false; }
  }

  const rmbCancelledCharge = inp.rmbJustPressed && p.hasPuck && p.charge > 0;
  if (inp.lmbJustReleased && !rmbCancelledCharge) {
    if (p.hasPuck && !p._chargeCancelled) p.shoot(match.puck, p.charge);
    p.charge = 0; p._chargeDecaying = false; p.overcharged = false; p._chargeCancelled = false; p._oneTimer = false;
  }

  if (inp.rmbJustPressed && p.hasPuck) {
    if (p.charge > 0.08) { p.charge = 0; p._chargeDecaying = false; p.overcharged = false; p._chargeBlocked = true; p._chargeCancelled = true; }
    else { p.charge = 0; const tgt = nearestOther(p, match); const lead = tgt ? leadAim(p.stickTip, tgt, PUCK.passSpeed) : null; p.pass(match.puck, lead); }
  }

  if (inp.mmbJustPressed && !p.hasPuck) p.passReq = 0.9;
}

function rebuildEntities(match) {
  match.world.entities = [match.rink, ...match.players.values(), match.goalieL, match.goalieR, match.puck];
}

function faceoff(match) {
  let i = 0;
  for (const p of match.players.values()) {
    p.x = p.team === 'home' ? RINK.centerX - 70 : RINK.centerX + 70;
    p.y = RINK.h / 2 + (i++ ? 40 : -40) * 0; // 1v1: na střed; víc hráčů rozprostřeme později
    p.y = RINK.h / 2;
    p.vx = p.vy = 0; p.hasPuck = false; p.charge = 0;
    p._chargeDecaying = false; p._oneTimer = false;
    const fa = Math.atan2(RINK.h / 2 - p.y, RINK.centerX - p.x);
    p.bodyAngle = p.skateAngle = p.aimAngle = p.carryAngle = fa;
  }
  match.puck.reset();
  match.world._goalLock = false;
}

function createMatch(roomId) {
  const rink = new Rink();
  const puck = new Puck();
  const goalieL = new Goalie('left');
  const goalieR = new Goalie('right');
  const world = new World([rink, goalieL, goalieR, puck]);
  world.authoritative = true;
  const match = {
    roomId, world, rink, puck, goalieL, goalieR,
    players: new Map(),   // socketId -> Player
    inputs:  new Map(),   // socketId -> input obj
    score: { home: 0, away: 0 },
    tick: 0, _goalAt: 0, loop: null,
  };
  world.onGoal = (result) => {
    if (result === 'goal-away') match.score.away++; else match.score.home++;
    io.to(roomId).emit('goal', { text: result === 'goal-away' ? 'GOAL! 🔴' : 'GOAL! 🔵' });
    match._goalAt = Date.now();
  };
  match.loop = setInterval(() => stepMatch(match), 1000 / TICK_HZ);
  return match;
}

function stepMatch(match) {
  match.tick++;

  // Faceoff po gólu (oslava 1.2 s)
  if (match.world._goalLock && match._goalAt && Date.now() - match._goalAt >= 1200) {
    match._goalAt = 0;
    faceoff(match);
  }

  // Akce hráčů z jejich vstupů (autoritativně)
  for (const [id, p] of match.players) {
    const inp = match.inputs.get(id);
    if (!inp) continue;
    computeEdges(inp);
    if (!match.world._goalLock) playerActions(p, inp, DT, match);
  }

  match.world.update(DT);

  if (match.tick % Math.round(TICK_HZ / SNAP_HZ) === 0) broadcast(match);
}

function broadcast(match) {
  const players = [];
  for (const [id, p] of match.players) {
    players.push({
      id, team: p.team, nm: p.name || '',
      x: r1(p.x), y: r1(p.y), ba: r3(p.bodyAngle), aa: r3(p.aimAngle), ca: r3(p.carryAngle),
      sd: r3(p._stickDisp), dr: r1(p._dispReach), dc: r2(p._dispCharge),
      fh: p.forehand ? 1 : 0, hp: p.hasPuck ? 1 : 0, ch: r2(p.charge),
      hd: p.handed, cc: p.crossCheck ? 1 : 0, ln: r2(p._lean),
    });
  }
  const g = (gg) => ({ x: r1(gg.x), y: r1(gg.y), t: r3(gg._tilt), h: gg._holdTimer > 0 ? 1 : 0,
                       st: gg._saveType, sf: r2(gg._saveFlash), sm: r2(gg._saveFlashMax), sc: r2(gg._screen) });
  io.to(match.roomId).emit('snap', {
    n: match.tick,
    players,
    puck: { x: r1(match.puck.x), y: r1(match.puck.y), z: r1(match.puck.z) },
    gl: g(match.goalieL), gr: g(match.goalieR),
    score: match.score,
    lock: match.world._goalLock ? 1 : 0,
  });
}

const r1 = n => Math.round(n * 10) / 10;
const r2 = n => Math.round((n || 0) * 100) / 100;
const r3 = n => Math.round((n || 0) * 1000) / 1000;

// ── Socket.io ────────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  socket.on('join', ({ room, name, hand }) => {
    let roomId = (room || '').toUpperCase();
    let match = rooms.get(roomId);
    if (match && match.players.size >= 2) { socket.emit('room-full'); return; }
    if (!match) { match = createMatch(roomId); rooms.set(roomId, match); }

    const team = match.players.size === 0 ? 'home' : 'away';
    const p = new Player(socket.id, team, makeInput());
    p.name = (name || '').slice(0, 12);
    p.handed = (hand === -1 || hand === 1) ? hand : (team === 'away' ? -1 : 1);
    match.players.set(socket.id, p);
    match.inputs.set(socket.id, p.input);
    rebuildEntities(match);
    faceoff(match);

    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.emit('joined', { id: socket.id, team });
  });

  socket.on('input', (msg) => {
    const match = rooms.get(socket.data.roomId);
    if (!match) return;
    const inp = match.inputs.get(socket.id);
    if (inp) applyClientInput(inp, msg);
  });

  socket.on('disconnect', () => {
    const match = rooms.get(socket.data.roomId);
    if (!match) return;
    match.players.delete(socket.id);
    match.inputs.delete(socket.id);
    rebuildEntities(match);
    socket.to(match.roomId).emit('peer-left');
    if (match.players.size === 0) { clearInterval(match.loop); rooms.delete(match.roomId); }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`→ listening on :${PORT}`));
