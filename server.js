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
const CHARGE_RATE = 1.4;       // pomalejší nápřah → slap shot je cítit jako wind-up
const TICK_HZ = 60;
const SNAP_HZ = 60;            // snapshot každý tick (ostřejší soupeř)
const DT = 1 / TICK_HZ;
const MAX_PLAYERS = 10;        // strop hráčů v lobby (5v5)

function makeInput() {
  return {
    dx: 0, dy: 0, lmb: false, rmb: false, mmb: false,
    aim: 0, aimDist: 100, keys: { Space: false },
    lmbJustPressed: false, lmbJustReleased: false, rmbJustPressed: false, mmbJustPressed: false,
    _p: { lmb: false, rmb: false, mmb: false }, // předchozí stav pro hrany
  };
}

// Aplikuj přijatý stav vstupu na input objekt + spočítej hrany
function applyClientInput(inp, msg) {
  inp.dx = msg.dx | 0; inp.dy = msg.dy | 0;
  inp.keys.Space = !!msg.space;
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

function nearestTeammate(p, match) {
  let best = null, bd = Infinity;
  for (const o of match.players.values()) {
    if (o === p || o.team !== p.team) continue;
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
    else { p.charge = 0; const tgt = nearestTeammate(p, match); const lead = tgt ? leadAim(p.stickTip, tgt, PUCK.passSpeed) : null; p.pass(match.puck, lead); }
  }

  if (inp.mmbJustPressed && !p.hasPuck) p.passReq = 0.9;
}

function rebuildEntities(match) {
  match.world.entities = [match.rink, ...match.players.values(), match.goalieL, match.goalieR, match.puck];
}

function faceoff(match) {
  // Rozmísti každý tým do svislé řady na své půlce, čelem ke středu (N hráčů)
  const home = [], away = [];
  for (const p of match.players.values()) (p.team === 'home' ? home : away).push(p);
  const place = (arr, x) => {
    const n = arr.length;
    arr.forEach((p, i) => {
      p.x = x;
      p.y = clamp(RINK.h / 2 + (i - (n - 1) / 2) * 64, 28, RINK.h - 28);
      p.vx = p.vy = 0; p.hasPuck = false; p.charge = 0;
      p._chargeDecaying = false; p._oneTimer = false;
      const fa = Math.atan2(RINK.h / 2 - p.y, RINK.centerX - p.x);
      p.bodyAngle = p.skateAngle = p.aimAngle = p.carryAngle = fa;
    });
  };
  place(home, RINK.centerX - 70);
  place(away, RINK.centerX + 70);
  match.puck.reset();
  match.world._goalLock = false;
}

function createMatch(lobbyId) {
  const rink = new Rink();
  const puck = new Puck();
  const goalieL = new Goalie('left');
  const goalieR = new Goalie('right');
  const world = new World([rink, goalieL, goalieR, puck]);
  world.authoritative = true;
  const match = {
    room: 'lobby:' + lobbyId, world, rink, puck, goalieL, goalieR,
    players: new Map(),   // socketId -> Player
    inputs:  new Map(),   // socketId -> input obj
    score: { home: 0, away: 0 },
    tick: 0, _goalAt: 0, loop: null,
  };
  world.onGoal = (result) => {
    if (result === 'goal-away') match.score.away++; else match.score.home++;
    io.to(match.room).emit('goal', { text: result === 'goal-away' ? 'GOAL! 🔴' : 'GOAL! 🔵' });
    match._goalAt = Date.now();
  };
  match.loop = setInterval(() => stepMatch(match), 1000 / TICK_HZ);
  return match;
}

// Sestav zápas z členů lobby (týmy + dresy z nastavení, číslo z profilu)
function startMatch(lobby) {
  const match = createMatch(lobby.id);
  for (const [sid, m] of lobby.members) {
    const p = new Player(sid, m.team, makeInput());
    p.name   = m.name;
    p.handed = m.handed;
    p.num    = m.number;
    const ts = lobby.settings.teams[m.team] || {};
    p.color  = ts.color || null;
    p.jersey = ts.style || 'solid';
    p.helmet = m.helmet; p.gloves = m.gloves; p.tape = m.tape;
    match.players.set(sid, p);
    match.inputs.set(sid, p.input);
  }
  // Gólmani v barvě svého týmu (levá branka = home, pravá = away)
  match.goalieL.color = lobby.settings.teams.home.color;
  match.goalieR.color = lobby.settings.teams.away.color;
  rebuildEntities(match);
  faceoff(match);
  lobby.match  = match;
  lobby.state  = 'playing';
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
      col: p.color || null, num: p.num, js: p.jersey || 'solid',
      hc: p.helmet || null, gc: p.gloves || null, tc: p.tape || null,
    });
  }
  const g = (gg) => ({ x: r1(gg.x), y: r1(gg.y), t: r3(gg._tilt), h: gg._holdTimer > 0 ? 1 : 0,
                       st: gg._saveType, sf: r2(gg._saveFlash), sm: r2(gg._saveFlashMax), sc: r2(gg._screen),
                       col: gg.color || null });
  io.to(match.room).emit('snap', {
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

// ── Lobby systém ───────────────────────────────────────────────────────────
const lobbies = new Map();  // id -> lobby

function genId() {
  let id; do { id = Math.random().toString(36).slice(2, 7).toUpperCase(); } while (lobbies.has(id));
  return id;
}
function teamCfg(d, dn, dc) {
  d = d || {};
  return {
    name:  String(d.name || dn).slice(0, 16),
    color: /^#[0-9a-fA-F]{6}$/.test(d.color) ? d.color : dc,
    style: ['solid', 'stripes', 'shoulder'].includes(d.style) ? d.style : 'solid',
  };
}
function sanitizeSettings(s) {
  s = s || {};
  const t = s.teams || {};
  return {
    name:    String(s.name || 'Lobby').slice(0, 24),
    teams:   { home: teamCfg(t.home, 'Domácí', '#3a9fff'), away: teamCfg(t.away, 'Hosté', '#ff4455') },
    periods: [1, 3].includes(s.periods) ? s.periods : 3,
    minutes: [5, 10, 15].includes(s.minutes) ? s.minutes : 10,
    rules:   !!s.rules,
    max:     [2, 4, 6, 8, 10].includes(s.max) ? s.max : 10,
  };
}
const hex = (c, d) => (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c)) ? c : d;
function makeMember(profile, team) {
  profile = profile || {};
  return {
    name:   String(profile.name || '').slice(0, 12),
    handed: (profile.handed === -1 || profile.handed === 1) ? profile.handed : 1,
    number: Number.isInteger(profile.number) ? Math.max(0, Math.min(99, profile.number)) : null,
    helmet: hex(profile.helmet, '#eef2f8'),  // osobní doplňky (helma/rukavice/páska)
    gloves: hex(profile.gloves, '#242c38'),
    tape:   hex(profile.tape,   '#111111'),
    team,
  };
}
function balanceTeam(l) {
  let h = 0, a = 0;
  for (const m of l.members.values()) (m.team === 'home' ? h++ : a++);
  return h <= a ? 'home' : 'away';
}
function lobbySummary(l) {
  return { id: l.id, name: l.settings.name, count: l.members.size, max: l.settings.max, state: l.state,
           home: l.settings.teams.home.name, away: l.settings.teams.away.name };
}
function lobbyState(l) {
  return {
    id: l.id, hostId: l.hostId, state: l.state, settings: l.settings,
    players: [...l.members.entries()].map(([id, m]) => ({ id, name: m.name, team: m.team, number: m.number })),
  };
}
function sendLobbyList(socket) {
  const list = [...lobbies.values()].filter(l => l.state === 'waiting').map(lobbySummary);
  (socket || io).emit('lobby:list', list);
}
const broadcastLobby = (l) => io.to('lobby:' + l.id).emit('lobby:state', lobbyState(l));

function leaveCurrentLobby(socket) {
  const id = socket.data.lobbyId;
  if (!id) return;
  socket.data.lobbyId = null;
  socket.leave('lobby:' + id);
  const l = lobbies.get(id);
  if (!l) return;
  l.members.delete(socket.id);
  if (l.match) { l.match.players.delete(socket.id); l.match.inputs.delete(socket.id); rebuildEntities(l.match); }
  socket.to('lobby:' + id).emit('peer-left');
  if (l.members.size === 0) {
    if (l.match) clearInterval(l.match.loop);
    lobbies.delete(id);
  } else {
    if (l.hostId === socket.id) l.hostId = l.members.keys().next().value; // předej hostování
    broadcastLobby(l);
  }
  sendLobbyList();
}

io.on('connection', (socket) => {
  socket.on('lobby:list', () => sendLobbyList(socket));

  socket.on('lobby:create', ({ settings, profile }) => {
    leaveCurrentLobby(socket);
    const id = genId();
    const l = { id, hostId: socket.id, state: 'waiting', settings: sanitizeSettings(settings), members: new Map(), match: null };
    l.members.set(socket.id, makeMember(profile, 'home'));
    lobbies.set(id, l);
    socket.join('lobby:' + id);
    socket.data.lobbyId = id;
    socket.emit('lobby:joined', lobbyState(l));
    sendLobbyList();
  });

  socket.on('lobby:join', ({ id, profile }) => {
    const l = lobbies.get(id);
    if (!l || l.state !== 'waiting') { socket.emit('lobby:error', 'Lobby není dostupné.'); return; }
    if (l.members.size >= l.settings.max) { socket.emit('lobby:error', 'Lobby je plné.'); return; }
    leaveCurrentLobby(socket);
    l.members.set(socket.id, makeMember(profile, balanceTeam(l)));
    socket.join('lobby:' + id);
    socket.data.lobbyId = id;
    socket.emit('lobby:joined', lobbyState(l));
    broadcastLobby(l);
    sendLobbyList();
  });

  socket.on('lobby:team', ({ team }) => {
    const l = lobbies.get(socket.data.lobbyId); if (!l || l.state !== 'waiting') return;
    const m = l.members.get(socket.id); if (!m) return;
    if (team === 'home' || team === 'away') { m.team = team; broadcastLobby(l); }
  });

  socket.on('lobby:settings', ({ settings }) => {
    const l = lobbies.get(socket.data.lobbyId);
    if (!l || l.hostId !== socket.id || l.state !== 'waiting') return;
    l.settings = sanitizeSettings(settings);
    broadcastLobby(l);
    sendLobbyList();
  });

  socket.on('lobby:start', () => {
    const l = lobbies.get(socket.data.lobbyId);
    if (!l || l.hostId !== socket.id || l.state !== 'waiting' || l.members.size === 0) return;
    startMatch(l);
    io.to('lobby:' + l.id).emit('lobby:start', { settings: l.settings });
    sendLobbyList();
  });

  socket.on('lobby:leave', () => leaveCurrentLobby(socket));

  socket.on('input', (msg) => {
    const l = lobbies.get(socket.data.lobbyId);
    if (!l || !l.match) return;
    const inp = l.match.inputs.get(socket.id);
    if (inp) applyClientInput(inp, msg);
  });

  socket.on('disconnect', () => leaveCurrentLobby(socket));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`→ listening on :${PORT}`));
