import { readFileSync } from 'fs';
// Načti .env před všemi ostatními importy
try {
  const env = readFileSync(new URL('.env', import.meta.url), 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] ??= m[2].trim();
  }
} catch { /* .env neexistuje na produkci — proměnné nastaveny jinak */ }

import express from 'express';
import http from 'http';
import crypto from 'crypto';
import cookieParser from 'cookie-parser';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import authRouter, { verifySession } from './auth.js';
import { updateStats } from './db.js';

import { World } from './public/js/world.js';
import { Player } from './public/js/entities/Player.js';
import { Puck } from './public/js/entities/Puck.js';
import { Goalie } from './public/js/entities/Goalie.js';
import { Rink } from './public/js/entities/Rink.js';
import { RINK, PUCK } from './public/js/constants.js';
import { lerpAngle, clamp } from './public/js/utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.disable('x-powered-by');
app.use(express.json());
app.use(cookieParser());
app.use('/auth', authRouter);
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 8 * 1024,   // vstupy jsou drobné → obří payloady rovnou zahodíme
  pingTimeout: 20000,
  connectTimeout: 10000,
});

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
  },
}));

// ── Limity proti zneužití (DoS / vyčerpání zdrojů) ──────────────────────
const MAX_LOBBIES = 200;   // strop počtu lobby
const MAX_MATCHES = 60;    // strop souběžných zápasů (každý = 60Hz smyčka)
const MAX_CONN    = 400;   // strop souběžných spojení
let   connCount   = 0;

// Server nesmí spadnout kvůli jednomu vadnému paketu / výjimce
process.on('uncaughtException',  (e) => console.error('uncaughtException:', e));
process.on('unhandledRejection', (e) => console.error('unhandledRejection:', e));

// Jednoduchý per-socket rate limit (min. rozestup mezi akcemi daného typu)
function rateOk(socket, key, minMs) {
  const now = Date.now();
  const rl = socket.data._rl || (socket.data._rl = {});
  if (now - (rl[key] || 0) < minMs) return false;
  rl[key] = now;
  return true;
}
const countMatches = () => [...lobbies.values()].filter(l => l.match).length;

// ── Authoritativní simulace ──────────────────────────────────────────────
const CHARGE_RATE = 1.2;       // pomalejší nápřah → slap shot je cítit jako wind-up (méně twitchy)
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

// Aplikuj přijatý stav vstupu na input objekt + spočítej hrany.
// Vše je tvrdě validované: směr jen -1/0/1, úhly/vzdálenosti musí být konečné číslo
// (jinak by NaN/Infinity „otrávil" celou simulaci → NaN pozice pro všechny).
const dir1 = v => (v > 0 ? 1 : v < 0 ? -1 : 0);
function applyClientInput(inp, msg) {
  if (!msg || typeof msg !== 'object') return;
  inp.dx = dir1(msg.dx); inp.dy = dir1(msg.dy);
  inp.keys.Space = !!msg.space;
  inp.lmb = !!msg.lmb; inp.rmb = !!msg.rmb; inp.mmb = !!msg.mmb;
  if (Number.isFinite(msg.aim))     inp.aim     = msg.aim;
  if (Number.isFinite(msg.aimDist)) inp.aimDist = clamp(msg.aimDist, 0, 4000);
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
  // Předvídání kam spoluhráč dojede — TLUMENÉ (0.6), aby rychlá změna směru nepřepálila pas.
  const dist = Math.hypot(target.x - from.x, target.y - from.y) || 1;
  const t = (dist / speed) * 0.6;
  const tx = target.x + (target.vx || 0) * t;
  const ty = target.y + (target.vy || 0) * t;
  return Math.atan2(ty - from.y, tx - from.x);
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
    else {
      // Nahrávka JEN spoluhráči — když nikdo není (sám na mapě), puk si necháš.
      const tgt = nearestTeammate(p, match);
      if (tgt) {
        p.charge = 0;
        const tip = p.stickTip;
        const dist = Math.hypot(tgt.x - tip.x, tgt.y - tip.y);
        // Přeměřená síla: dojede ke spoluhráči s rozumným tempem (nepřepálí, neztratí se).
        const sp = clamp(Math.sqrt(2 * PUCK.decel * dist) + 45, 175, PUCK.maxPassSpeed);
        p.pass(match.puck, leadAim(tip, tgt, sp), sp);
      }
    }
  }

  if (inp.mmbJustPressed && !p.hasPuck) p.passReq = 0.9;
}

function rebuildEntities(match) {
  match.world.entities = [match.rink, ...match.players.values(), match.goalieL, match.goalieR, match.puck];
}

function faceoffAt(match, fx, fy) {
  // Realistické rozestavení na buly: centr přímo na bodě, křídla po stranách, obránci vzadu.
  // Každý tým stojí na své OBRANNÉ straně bodu (home brání vlevo, away vpravo), čelem k bodu.
  const home = [], away = [];
  for (const p of match.players.values()) (p.team === 'home' ? home : away).push(p);
  // [vzdálenost ZA bodem (k vlastní brance), odchylka do strany] relativně k buly bodu
  const SPOTS = [
    [16,   0],   // centr — na buly bodě
    [26, -54],   // křídlo
    [26,  54],   // křídlo
    [86, -34],   // obránce
    [86,  34],   // obránce
  ];
  const place = (arr, dir) => {   // dir: home = +1 (útočí vpravo), away = -1
    arr.forEach((p, i) => {
      const spot = SPOTS[Math.min(i, SPOTS.length - 1)];
      const back = spot[0] + (i >= SPOTS.length ? (i - SPOTS.length + 1) * 26 : 0);
      const sideMul = i >= SPOTS.length ? ((i % 2) ? 1 : -1) : 1;
      p.x = clamp(fx - dir * back, 16, RINK.w - 16);
      p.y = clamp(fy + spot[1] * sideMul, 24, RINK.h - 24);
      p.vx = p.vy = 0; p.hasPuck = false; p.charge = 0;
      p._chargeDecaying = false; p._oneTimer = false;
      const fa = Math.atan2(fy - p.y, fx - p.x);   // čelem k buly bodu
      p.bodyAngle = p.skateAngle = p.aimAngle = p.carryAngle = fa;
    });
  };
  place(home, 1);
  place(away, -1);
  match.puck.reset();
  match.puck.x = fx; match.puck.y = fy; match.puck.prevX = fx; match.puck.prevY = fy;
  match.lastTouch = null; match.touchX = fx;
  match.icing = null; match.offside = null; match._goalAt = 0; match.stoppage = false; match._whistleAt = 0;
  // "Set" — lehká prodleva při vhazování: vše zmrazené, hráči čelem k puku, pak živé
  match.setup = true;
  match.faceoffUntil = Date.now() + 900;
  match.world._goalLock = true;
}
function faceoff(match) { faceoffAt(match, RINK.centerX, RINK.h / 2); }

// ── Pravidla: icing + offside ──────────────────────────────────────────
function anyInZone(match, team, pred) {
  for (const p of match.players.values()) if (p.team === team && pred(p)) return true;
  return false;
}
function callStoppage(match, rule, lineX, fx, fy) {
  match.stoppage = true;
  match._whistleAt = Date.now();
  match._faceoff = { x: fx, y: fy };
  match.world._goalLock = true;              // zmraz interakce (jako u gólu)
  match.puck.vx = match.puck.vy = 0;
  io.to(match.room).emit('whistle', { rule, lineX, color: rule === 'offside' ? '#2a6bff' : '#ff3344' });
}
function checkRules(match) {
  const pk = match.puck, px = pk.x, ppx = pk.prevX ?? pk.x, cx = RINK.centerX;
  const gy1 = RINK.goalY, gy2 = RINK.goalY + RINK.goalH;
  const inMouthY = pk.y > gy1 && pk.y < gy2;
  const dotY = pk.y < RINK.h / 2 ? 114 : RINK.h - 114;

  // OFFSIDE — útočník v útočném pásmu dřív než puk (home útočí vpravo, away vlevo).
  // Píšťalka NEhned: puk necháme dojet (jako icing), zmrazíme jen interakce.
  if (match.lastTouch === 'home' && ppx < RINK.blueLineRight && px >= RINK.blueLineRight &&
      anyInZone(match, 'home', p => p.x > RINK.blueLineRight + 8)) {
    match.offside = { side: 'home', lineX: RINK.blueLineRight, fx: RINK.blueLineRight - 30, fy: dotY, t: Date.now() };
    match.world._goalLock = true; return;
  }
  if (match.lastTouch === 'away' && ppx > RINK.blueLineLeft && px <= RINK.blueLineLeft &&
      anyInZone(match, 'away', p => p.x < RINK.blueLineLeft - 8)) {
    match.offside = { side: 'away', lineX: RINK.blueLineLeft, fx: RINK.blueLineLeft + 30, fy: dotY, t: Date.now() };
    match.world._goalLock = true; return;
  }

  // ICING — vyhození zpoza půlky přes soupeřovu brankovou čáru (mimo branku), bez dotyku.
  // Píšťalka NEhned: puk necháme dojet (physics běží), zmrazíme jen interakce.
  if (match.lastTouch === 'home' && match.touchX < cx && ppx < RINK.goalLineRight && px >= RINK.goalLineRight && !inMouthY) {
    match.icing = { side: 'home', lineX: RINK.goalLineRight, fx: 248, fy: dotY, t: Date.now() };
    match.world._goalLock = true; return;     // buly v obr. pásmu home (vlevo)
  }
  if (match.lastTouch === 'away' && match.touchX > cx && ppx > RINK.goalLineLeft && px <= RINK.goalLineLeft && !inMouthY) {
    match.icing = { side: 'away', lineX: RINK.goalLineLeft, fx: RINK.w - 248, fy: dotY, t: Date.now() };
    match.world._goalLock = true; return;     // buly v obr. pásmu away (vpravo)
  }
}

// Předběžné varování (pulsující čára) — offside pozice / icing v běhu. Bitmask:
// 1=offside pravá modrá, 2=offside levá modrá, 4=icing pravá brank. čára, 8=icing levá
function pendingFlags(match) {
  if (!match.rules || match.stoppage) return 0;
  const cx = RINK.centerX, pk = match.puck;
  let f = 0;
  // OFFSIDE — během dojezdu drž čáru zvýrazněnou, jinak předběžné varování
  if (match.offside) {
    f |= (match.offside.side === 'home' ? 1 : 2);
  } else if (!match.world._goalLock) {
    if (pk.x <= RINK.blueLineRight && anyInZone(match, 'home', p => p.x > RINK.blueLineRight + 4)) f |= 1;
    if (pk.x >= RINK.blueLineLeft  && anyInZone(match, 'away', p => p.x < RINK.blueLineLeft - 4))  f |= 2;
  }
  if (match.icing) {
    f |= (match.icing.side === 'home' ? 4 : 8);
  } else if (!match.world._goalLock) {
    if (match.lastTouch === 'home' && match.touchX < cx && pk.x > cx && pk.vx > 30 && pk.x < RINK.goalLineRight) f |= 4;
    if (match.lastTouch === 'away' && match.touchX > cx && pk.x < cx && pk.vx < -30 && pk.x > RINK.goalLineLeft) f |= 8;
  }
  return f;
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
    if (match.offside || match.icing) return;   // gól během dojezdu offside/icing neplatí
    if (result === 'goal-away') match.score.away++; else match.score.home++;
    if (match._lastTouchSid) {
      if (!match._goalScorers) match._goalScorers = [];
      match._goalScorers.push(match._lastTouchSid);
    }
    io.to(match.room).emit('goal', { text: result === 'goal-away' ? 'GOAL! 🔴' : 'GOAL! 🔵' });
    match._goalAt = Date.now();
  };
  match.loop = setInterval(() => {
    try { stepMatch(match); }
    catch (e) { console.error('stepMatch error (lobby ' + lobbyId + '):', e); }
  }, 1000 / TICK_HZ);
  return match;
}

// Vytvoř Player entitu z člena lobby (týmy + dresy z nastavení, doplňky z profilu)
function buildPlayer(lobby, sid, m) {
  const p = new Player(sid, m.team, makeInput());
  p.name   = m.name;
  p.handed = m.handed;
  p.num    = m.number;
  const ts = lobby.settings.teams[m.team] || {};
  p.color  = ts.color || null;
  p.jersey = ts.style || 'solid';
  p.helmet = m.helmet; p.gloves = m.gloves; p.tape = m.tape; p.trail = m.trail;
  p.stick = m.stick; p.tapeStyle = m.tapeStyle; p.helmetType = m.helmetType; p.visor = m.visor;
  return p;
}

// Sestav zápas z členů lobby (týmy + dresy z nastavení, číslo z profilu)
function shuffleTeams(lobby) {
  const ids = [...lobby.members.keys()];
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  const half = Math.ceil(ids.length / 2);
  ids.forEach((id, i) => {
    const m = lobby.members.get(id);
    if (m) m.team = i < half ? 'home' : 'away';
  });
}

function autoRematch(lobby) {
  if (!lobby || lobby.members.size === 0) return;
  if (lobby.match) { clearInterval(lobby.match.loop); lobby.match = null; }
  lobby.state = 'waiting';
  shuffleTeams(lobby);
  startMatch(lobby);
  io.to('lobby:' + lobby.id).emit('lobby:start', { settings: lobby.settings });
  sendLobbyList();
}

function startMatch(lobby) {
  const match = createMatch(lobby.id);
  for (const [sid, m] of lobby.members) {
    const p = buildPlayer(lobby, sid, m);
    match.players.set(sid, p);
    match.inputs.set(sid, p.input);
  }
  // Gólmani v barvě svého týmu (levá branka = home, pravá = away)
  match.goalieL.color = lobby.settings.teams.home.color;
  match.goalieR.color = lobby.settings.teams.away.color;
  // Časomíra
  match.periods = lobby.settings.periods;
  match.minutes = lobby.settings.minutes;
  match.period  = 1;
  match.clock   = match.minutes * 60;   // sekundy do konce třetiny
  match.ended   = false;
  // Pravidla (icing/offside)
  match.rules     = !!lobby.settings.rules;
  match.lastTouch = null;               // tým, který se naposled dotkl puku
  match.touchX    = RINK.centerX;       // x puku při posledním držení (origin pro icing)
  match.stoppage  = false;              // přerušení (píšťalka) → buly
  match._whistleAt = 0;
  match._faceoff  = null;
  match.icing     = null;               // icing v běhu (puk dojíždí před píšťalkou)
  match.offside   = null;               // offside v běhu (puk dojíždí před píšťalkou)
  match.setup     = false;              // buly "set" (lehká prodleva, vše zmrazené)
  match.faceoffUntil = 0;
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
  // Buly po přerušení (offside/icing) — píšťalka 1.3 s, pak vhazování na bodě
  if (match.stoppage && Date.now() - match._whistleAt >= 1300) {
    match.stoppage = false;
    faceoffAt(match, match._faceoff.x, match._faceoff.y);
  }
  // Buly "set" — lehká prodleva při vhazování (vše zmrazené, hráči čelem k puku), pak živé
  if (match.setup) {
    if (Date.now() >= match.faceoffUntil) { match.setup = false; match.world._goalLock = false; }
    else { if (match.tick % Math.round(TICK_HZ / SNAP_HZ) === 0) broadcast(match); return; }
  }
  // Icing v běhu — puk necháme dojet; píšťalka až když zpomalí nebo po timeoutu
  if (match.icing && !match.stoppage) {
    const sp = Math.hypot(match.puck.vx, match.puck.vy);
    if (sp < 45 || Date.now() - match.icing.t > 2600) {
      const ic = match.icing; match.icing = null;
      callStoppage(match, 'icing', ic.lineX, ic.fx, ic.fy);
    }
  }
  // Offside v běhu — stejně jako icing: puk necháme dojet, pak píšťalka
  if (match.offside && !match.stoppage) {
    const sp = Math.hypot(match.puck.vx, match.puck.vy);
    if (sp < 45 || Date.now() - match.offside.t > 2000) {
      const off = match.offside; match.offside = null;
      callStoppage(match, 'offside', off.lineX, off.fx, off.fy);
    }
  }

  // Časomíra — běží, když se nehraje oslava gólu a zápas neskončil
  if (!match.ended && !match.world._goalLock) {
    match.clock -= DT;
    if (match.clock <= 0) {
      if (match.period < match.periods) {
        match.period++;
        match.clock = match.minutes * 60;
        faceoff(match);
        io.to(match.room).emit('period', { period: match.period });
      } else {
        match.clock = 0;
        match.ended = true;
        io.to(match.room).emit('gameover', { score: match.score });
        const lobbyId = match.room.replace('lobby:', '');
        // Aktualizuj statistiky přihlášených hráčů
        const endLobby = lobbies.get(lobbyId);
        if (endLobby) {
          const winTeam = match.score.home > match.score.away ? 'home' :
                          match.score.away > match.score.home ? 'away' : null;
          for (const [sid, mem] of endLobby.members) {
            const sock = io.sockets.sockets.get(sid);
            const userId = sock?.data?.userId;
            if (!userId) continue;
            const goals = (match._goalScorers || []).filter(s => s === sid).length;
            const isWin = !!(winTeam && mem.team === winTeam);
            const isLoss = !!(winTeam && mem.team !== winTeam);
            try { updateStats(userId, { goals, games_played: 1, wins: isWin ? 1 : 0, losses: isLoss ? 1 : 0 }); } catch {}
          }
        }
        match.rematchTimer = setTimeout(() => {
          const lb = lobbies.get(lobbyId);
          if (lb && lb.match === match) autoRematch(lb);
        }, 10000);
      }
    }
  }

  // Akce hráčů z jejich vstupů (autoritativně)
  for (const [id, p] of match.players) {
    const inp = match.inputs.get(id);
    if (!inp) continue;
    computeEdges(inp);
    if (!match.world._goalLock) playerActions(p, inp, DT, match);
  }

  match.world.update(DT);

  // Sleduj poslední dotek (tým + hráč + origin pro icing)
  for (const [sid, p] of match.players) if (p.hasPuck) { match.lastTouch = p.team; match.touchX = match.puck.x; match._lastTouchSid = sid; }
  // Kontrola pravidel (jen když je zapnuto a hraje se)
  if (match.rules && !match.stoppage && !match.world._goalLock && !match.ended) checkRules(match);

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
      sk: p.stick || null, ty: p.tapeStyle || 'full', hy: p.helmetType || 'visor', vc: p.visor || null,
    });
  }
  const g = (gg) => ({ x: r1(gg.x), y: r1(gg.y), t: r3(gg._tilt), h: gg._holdTimer > 0 ? 1 : 0,
                       st: gg._saveType, sf: r2(gg._saveFlash), sm: r2(gg._saveFlashMax), sc: r2(gg._screen),
                       col: gg.color || null });
  io.to(match.room).emit('snap', {
    n: match.tick,
    players,
    puck: { x: r1(match.puck.x), y: r1(match.puck.y), z: r1(match.puck.z), tc: match.puck.trailColor || null, ev: match.puck._ev || 0 },
    gl: g(match.goalieL), gr: g(match.goalieR),
    score: match.score,
    lock: match.world._goalLock ? 1 : 0,
    clk: Math.max(0, Math.ceil(match.clock)), per: match.period, pers: match.periods, end: match.ended ? 1 : 0,
    pnd: pendingFlags(match),
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
    password: String(s.password || '').slice(0, 24),   // prázdné = bez hesla
  };
}
const hex = (c, d) => (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c)) ? c : d;

// Tajný sponsor kód — zadává se ve skrytém poli (ne v nicku, nikde se nezobrazí).
// V repu je jen SOLENÝ HASH → samotný kód z kódu hry nezjistíš.
const SPONSOR_SALT = 'FH_sp_v1::';
const SPONSOR_HASH = '6ca63a5475d6396dc2c544b9b236d22eac7bced69b2a88c24135dccf292424d1';
const isSponsorCode = (code) => typeof code === 'string' && code.length > 0 &&
  crypto.createHash('sha256').update(SPONSOR_SALT + code.trim().toUpperCase()).digest('hex') === SPONSOR_HASH;
function makeMember(profile, team) {
  profile = profile || {};
  return {
    name:   String(profile.name || '').slice(0, 12),
    sponsor: isSponsorCode(profile.code),
    handed: (profile.handed === -1 || profile.handed === 1) ? profile.handed : 1,
    number: Number.isInteger(profile.number) ? Math.max(0, Math.min(99, profile.number)) : null,
    helmet: hex(profile.helmet, '#eef2f8'),  // osobní doplňky (helma/rukavice/páska)
    gloves: hex(profile.gloves, '#242c38'),
    tape:   hex(profile.tape,   '#111111'),
    trail:  hex(profile.trail,  '#9aa3b2'),
    stick:  hex(profile.stick,  '#1a1f29'),
    visor:  hex(profile.visor,  '#bfe0ff'),
    tapeStyle:  ['full','toe','heel','candy'].includes(profile.tapeStyle) ? profile.tapeStyle : 'full',
    helmetType: ['visor','none','shield','cage'].includes(profile.helmetType) ? profile.helmetType : 'visor',
    team,
  };
}
function balanceTeam(l) {
  let h = 0, a = 0;
  for (const m of l.members.values()) (m.team === 'home' ? h++ : a++);
  return h <= a ? 'home' : 'away';
}
function lobbySummary(l) {
  const s = { id: l.id, name: l.settings.name, count: l.members.size, max: l.settings.max, state: l.state,
              home: l.settings.teams.home.name, away: l.settings.teams.away.name,
              hp: !!l.settings.password };
  if (l.state === 'playing' && l.match) {                 // živý stav u rozehraných
    s.score = l.match.score;
    s.clk   = Math.max(0, Math.ceil(l.match.clock));
    s.per   = l.match.period; s.pers = l.match.periods;
    s.end   = l.match.ended ? 1 : 0;
  }
  return s;
}
function lobbyState(l) {
  return {
    id: l.id, hostId: l.hostId, state: l.state, settings: l.settings,
    players: [...l.members.entries()].map(([id, m]) => ({ id, name: m.name, team: m.team, number: m.number })),
  };
}
function sendLobbyList(socket) {
  const list = [...lobbies.values()].filter(l => l.state === 'waiting' || l.state === 'playing').map(lobbySummary);
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
    if (l.match) { clearInterval(l.match.loop); clearTimeout(l.match.rematchTimer); }
    lobbies.delete(id);
  } else {
    if (l.hostId === socket.id) l.hostId = l.members.keys().next().value; // předej hostování
    broadcastLobby(l);
  }
  sendLobbyList();
}

io.on('connection', (socket) => {
  if (connCount >= MAX_CONN) { socket.disconnect(true); return; }
  connCount++;
  // Přečti JWT cookie a ulož userId pro tracking statistik
  const rawCookie = socket.handshake.headers.cookie || '';
  const cm = rawCookie.match(/(?:^|;\s*)fh_session=([^;]+)/);
  socket.data.userId = cm ? verifySession(decodeURIComponent(cm[1])) : null;

  socket.on('lobby:list', () => { if (rateOk(socket, 'list', 500)) sendLobbyList(socket); });

  socket.on('sponsor:check', (code) => {        // ověř tajný sponsor kód → odemkne vzhled
    if (!rateOk(socket, 'spcheck', 250)) return;
    socket.emit('sponsor:result', isSponsorCode(code));
  });

  socket.on('lobby:create', ({ settings, profile }) => {
    if (!rateOk(socket, 'create', 1000)) return;
    if (lobbies.size >= MAX_LOBBIES) { socket.emit('lobby:error', 'err_server_full'); return; }
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

  socket.on('lobby:join', ({ id, profile, password }) => {
    if (!rateOk(socket, 'join', 500)) return;
    if (typeof id !== 'string') return;
    const l = lobbies.get(id);
    if (!l || (l.state !== 'waiting' && l.state !== 'playing')) { socket.emit('lobby:error', 'err_unavailable'); return; }
    if (l.settings.password && l.settings.password !== String(password || '')) { socket.emit('lobby:error', 'err_password'); return; }
    if (l.members.size >= l.settings.max) { socket.emit('lobby:error', 'err_full'); return; }
    leaveCurrentLobby(socket);
    const m = makeMember(profile, balanceTeam(l));
    l.members.set(socket.id, m);
    socket.join('lobby:' + id);
    socket.data.lobbyId = id;
    if (l.state === 'playing' && l.match) {
      // Připojení do běžícího zápasu — přidej hráče a hoď ho rovnou do hry
      const p = buildPlayer(l, socket.id, m);
      p.x = m.team === 'home' ? RINK.w * 0.3 : RINK.w * 0.7;
      p.y = RINK.h / 2;
      l.match.players.set(socket.id, p);
      l.match.inputs.set(socket.id, p.input);
      rebuildEntities(l.match);
      socket.emit('lobby:start', { settings: l.settings });
    } else {
      socket.emit('lobby:joined', lobbyState(l));
      broadcastLobby(l);
    }
    sendLobbyList();
  });

  socket.on('lobby:team', ({ team }) => {
    const l = lobbies.get(socket.data.lobbyId); if (!l || l.state !== 'waiting') return;
    const m = l.members.get(socket.id); if (!m) return;
    if (team === 'home' || team === 'away') { m.team = team; broadcastLobby(l); }
  });

  socket.on('lobby:settings', ({ settings }) => {
    if (!rateOk(socket, 'settings', 200)) return;
    const l = lobbies.get(socket.data.lobbyId);
    if (!l || l.hostId !== socket.id || l.state !== 'waiting') return;
    l.settings = sanitizeSettings(settings);
    broadcastLobby(l);
    sendLobbyList();
  });

  socket.on('lobby:start', () => {
    if (!rateOk(socket, 'start', 1000)) return;
    const l = lobbies.get(socket.data.lobbyId);
    if (!l || l.hostId !== socket.id || l.state !== 'waiting' || l.members.size === 0) return;
    if (countMatches() >= MAX_MATCHES) { socket.emit('lobby:error', 'err_too_many'); return; }
    startMatch(l);
    io.to('lobby:' + l.id).emit('lobby:start', { settings: l.settings });
    sendLobbyList();
  });

  socket.on('lobby:leave', () => leaveCurrentLobby(socket));

  socket.on('input', (msg) => {
    // Strop ~150 vstupů/s na socket (legitimní je ~60) → blokuje záplavu vstupů
    const now = Date.now();
    const rl = socket.data._inrl || (socket.data._inrl = { t: now, n: 0 });
    if (now - rl.t > 1000) { rl.t = now; rl.n = 0; }
    if (++rl.n > 150) return;
    const l = lobbies.get(socket.data.lobbyId);
    if (!l || !l.match) return;
    const inp = l.match.inputs.get(socket.id);
    if (inp) applyClientInput(inp, msg);
  });

  socket.on('disconnect', () => { connCount--; leaveCurrentLobby(socket); });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`→ listening on :${PORT}`));
