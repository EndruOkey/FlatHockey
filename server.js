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
import { botTarget, clampBots } from './bot-target.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { mountDev } from './dev-gate.js';
import authRouter, { linkRouter, verifySession, requireAuth, bearerToken, createGuestAccount } from './auth.js';
import { updateStats, updateRankAndCredits, getRankPosition, getLeaderboard, getStoreItems, getUserUnlocks, buyItem, getPuckCredits, getActiveSeason, logMetric, cleanOldMetrics, recordReferral, rewardReferralIfPending, isFounder, getUserById, userBadge } from './db.js';

import { World } from './public/js/world.js';
import { Player } from './public/js/entities/Player.js';
import { _detectFx, createMatch as coreCreateMatch, stepMatch, makeInput, applyClientInput, computeEdges, playerActions, rebuildEntities, faceoffAt, faceoff, pendingFlags, ms2ticks } from './public/js/match-core.js';
import { weekRuleFor, weekBonus } from './public/js/weekly.js';   // hlášky (kombo/skill) — sdílený detektor
import { Puck } from './public/js/entities/Puck.js';
import { Goalie } from './public/js/entities/Goalie.js';
import { Rink } from './public/js/entities/Rink.js';
import { RINK, PUCK, TEMPO, passSpeedFor } from './public/js/constants.js';
import { lerpAngle, clamp } from './public/js/utils.js';
import { botThink, makeBotBrain, hashSeed } from './public/js/bot.js';
import { makeRng } from './public/js/rng.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');   // za Caddy (127.0.0.1) věř X-Forwarded-For, jinak ne

// ── Rate limit (fixed window, in-memory, klíč = IP + skupina) ──────────────
const rlHits = new Map();   // klíč → { n, reset }
function rateLimit(group, max, windowMs = 60_000) {
  return (req, res, next) => {
    const now = Date.now(), key = group + '|' + req.ip;
    let h = rlHits.get(key);
    if (!h || h.reset <= now) { h = { n: 0, reset: now + windowMs }; rlHits.set(key, h); }
    if (++h.n > max) {
      res.set('Retry-After', String(Math.ceil((h.reset - now) / 1000)));
      return res.status(429).json({ error: 'rate_limited' });
    }
    next();
  };
}
setInterval(() => { const now = Date.now(); for (const [k, h] of rlHits) if (h.reset <= now) rlHits.delete(k); }, 60_000).unref();

// ── CSRF: stavové POSTy jen ze stejného originu (Origin, jinak Referer) ───
const ALLOWED_HOSTS = new Set(['flathockey.fun', 'www.flathockey.fun', 'localhost', '127.0.0.1']);
function sameOrigin(req, res, next) {
  // Bearer auth: CSRF se netýká (prohlížeč Authorization hlavičku cizí stránce sám nepřidá) → jen platný token obejde kontrolu
  const bt = bearerToken(req);
  if (bt && verifySession(bt)) return next();
  const src = req.get('origin') || req.get('referer');
  let host = null;
  try { if (src) host = new URL(src).host; } catch { /* neplatné → zamítnout */ }
  const ok = host && (host === req.get('host') || ALLOWED_HOSTS.has(host.replace(/:\d+$/, '')));
  if (!ok) return res.status(403).json({ error: 'bad_origin' });
  next();
}
// CORS pro klienty hostované na itch.io / CrazyGames (bez cookies → jen Bearer; wrappery dnes iframují flathockey.fun, tedy same-origin)
const EMBED_ORIGIN_RE = /^https:\/\/([a-z0-9-]+\.)*(itch\.zone|itch\.io|crazygames\.com)$/;
app.use(['/api', '/auth'], (req, res, next) => {
  const o = req.get('origin');
  if (o && EMBED_ORIGIN_RE.test(o)) {
    res.set({ 'Access-Control-Allow-Origin': o, 'Vary': 'Origin',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' });
    if (req.method === 'OPTIONS') return res.sendStatus(204);
  }
  next();
});
app.post(['/auth/*splat', '/api/store/buy', '/api/link/*splat'], sameOrigin);

app.use(express.json());
app.use(cookieParser());
app.use('/auth', rateLimit('auth', 20), authRouter);
app.use('/api/link/code', rateLimit('linkcode', 5));
app.use('/api/link/redeem', rateLimit('linkredeem', 10));
app.use('/api/link', linkRouter);
app.use('/api/me', rateLimit('read', 120));
app.use('/api/leaderboard', rateLimit('read', 120));
app.use('/api/store/buy', rateLimit('buy', 10));
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: EMBED_ORIGIN_RE },
  maxHttpBufferSize: 8 * 1024,   // vstupy jsou drobné → obří payloady rovnou zahodíme
  pingTimeout: 20000,
  connectTimeout: 10000,
});

mountDev(app, express, path.join(__dirname, 'public'), rateLimit('devlogin', 8));   // /dev — playground pod heslem (dev-gate.js)

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Vložení jen z vlastního webu a herních portálů (itch.io hostuje HTML hry na itch.zone)
    res.setHeader('Content-Security-Policy', "frame-ancestors 'self' https://*.itch.io https://*.itch.zone https://*.crazygames.com https://app.crazygames.com capacitor://app.crazygames.com" + (process.env.ALLOW_LOCAL_EMBED ? ' http://localhost:*' : ''));
    res.setHeader('Referrer-Policy', 'no-referrer');
  },
}));

// ── Limity proti zneužití (DoS / vyčerpání zdrojů) ──────────────────────
const MAX_LOBBIES = 200;   // strop počtu lobby
const MAX_MATCHES = 60;    // strop souběžných zápasů (každý = 60Hz smyčka)
const MAX_CONN    = 400;   // strop souběžných spojení
let   connCount   = 0;

// uncaughtException = neznámý stav procesu → zaloguj a skonči; systemd (Restart=always) ho nahodí čistý.
// Smyčka zápasu má vlastní try/catch per tick, takže běžné chyby simulace sem nedoletí.
process.on('uncaughtException', (e) => { console.error('FATAL uncaughtException:', e); process.exit(1); });
process.on('unhandledRejection', (reason, promise) => console.error('unhandledRejection (pokračuji):', reason, 'promise:', promise));

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
const PERFECT_WIN = 0.3;      // s — okno přesné rány po plném nabití (pak puk ujede)
const CHARGE_RATE = 1.2;       // pomalejší nápřah → slap shot je cítit jako wind-up (méně twitchy)
const TICK_HZ = 60;
const SNAP_HZ = 30;            // 30 snapshotů/s (klient plynule interpoluje v game.js _interp) — 60/s
                              // zahlcovalo slabší/kolísavá připojení = trhání „jak internet"; 30 je odolnější a půlí provoz
const DT = 1 / TICK_HZ;
const MAX_PLAYERS = 10;        // strop hráčů v lobby (5v5)


// Aplikuj přijatý stav vstupu na input objekt + spočítej hrany.
// Vše je tvrdě validované: směr jen -1/0/1, úhly/vzdálenosti musí být konečné číslo
// (jinak by NaN/Infinity „otrávil" celou simulaci → NaN pozice pro všechny).




// Vstup, akce hráče, přihrávky, buly a pravidla (icing/offside) jsou ve sdíleném public/js/match-core.js.

// Zápas = SDÍLENÁ simulace match-core (createMatch/stepMatch) + serverové háčky (síť, DB). Dřív server měl vlastní kopii simulace
// (rozjížděla se s offline hrou: oprava jen v jednom souboru). scripts/chain_restart.mjs, test/determinism.test.mjs.
function createMatch(lobbyId, seed) {
  const room = 'lobby:' + lobbyId;
  const match = coreCreateMatch(seed, {
    goal: (result, scoringTeam) => serverGoalHook(match, lobbyId, result, scoringTeam),
    whistle: (rule, lineX) => io.to(room).emit('whistle', { rule, lineX, color: rule === 'offside' ? '#2a6bff' : '#ff3344' }),
    period: (period) => io.to(room).emit('period', { period }),
    gameover: () => serverGameOver(match),
  });
  match.room = room;
  // Pevný krok s doháněním: setInterval je nepřesný (Windows volá ~37×/s místo 60 — změřeno) →
  // dorovnej podle skutečně uplynulého času, ať hra běží 60 ticků/s všude. Strop 250 ms = po zaseknutí nedohání donekonečna.
  const STEP_MS = 1000 / TICK_HZ;
  const SNAP_MS = 1000 / SNAP_HZ;
  let last = performance.now(), acc = 0, lastSnap = 0;
  match.loop = setInterval(() => {
    const now = performance.now();
    acc += Math.min(now - last, 250); last = now;
    try {
      while (acc >= STEP_MS) { stepMatch(match); acc -= STEP_MS; }
      // Snapshot ROVNOMĚRNĚ: max 1× za fire, škrceno na SNAP_HZ wall-clockem → žádné bursty
      // ani když dohánění udělalo víc kroků naráz (to byl zdroj „jak internet" trhání).
      if (now - lastSnap >= SNAP_MS - 2) { broadcast(match); lastSnap = now; }
    }
    catch (e) { acc = 0; console.error('stepMatch error (lobby ' + lobbyId + '):', e); }
  }, STEP_MS);
  return match;
}

// Gól (háček match-core goal): týdenní bonus, střelec/asistence/plus-minus, síťová událost — dřív v serverové kopii createMatch
function serverGoalHook(match, lobbyId, result, scoringTeam) {
const goalsBefore = match.score.home + match.score.away - 1;   // hook běží PO připsání gólu
// Týdenní pravidlo (jen rychlá hra): bonusový bod
const bonus = match.weekRule ? weekBonus(match.weekRule, { team: scoringTeam, shot: match._lastShot, clock: match.clock, lastPeriod: match.period >= match.periods, goalsBefore }) : 0;
if (bonus) { match.score[scoringTeam] += bonus; (match._fx || (match._fx = [])).push({ k: 'bonus', id: match._lastTouchSid, team: scoringTeam }); }

const isHuman = (sid) => sid && !sid.startsWith('bot:');   // boti se nepočítají do střelce/MVP
const scorerMem = match._lastTouchSid ? lobbies.get(lobbyId)?.members.get(match._lastTouchSid) : null;

// Střelec: jen když se naposled dotkl hráč SKÓRUJÍCÍHO týmu (vlastní gól nikomu gól nepřipíše)
if (!match._goalScorers) match._goalScorers = [];
if (isHuman(match._lastTouchSid) && scorerMem?.team === scoringTeam) match._goalScorers.push(match._lastTouchSid);

// Asistence: předchozí dotyk ze stejného týmu jako střelec
if (!match._assists) match._assists = [];
if (match._prevTouchSid && match._prevTouchSid !== match._lastTouchSid && isHuman(match._prevTouchSid)) {
  const prevMem = lobbies.get(lobbyId)?.members.get(match._prevTouchSid);
  if (prevMem?.team === scoringTeam) match._assists.push(match._prevTouchSid);
}

// Plus/minus: +1 pro tým který vstřelil, -1 pro druhý
if (!match._plusMinus) match._plusMinus = new Map();
const endLobbyPM = lobbies.get(lobbyId);
if (endLobbyPM) {
  for (const [sid, mem] of endLobbyPM.members) {
    match._plusMinus.set(sid, (match._plusMinus.get(sid) || 0) + (mem.team === scoringTeam ? 1 : -1));
  }
}

{ const sh = match.puck._shot, sp = sh ? match.players.get(sh.id) : null, scorer = sp && sp.team === scoringTeam ? String(sp.name || '').slice(0, 24) : '';
  io.to(match.room).emit('goal', { text: result === 'goal-away' ? 'GOAL! 🔴' : 'GOAL! 🔵', side: scoringTeam, scorer }); }
}

// Konec zápasu (háček match-core gameover): síť, statistiky, odměny, auto-rematch — přesunuto ze serverového stepMatch (2026-11-12)
function serverGameOver(match) {
  io.to(match.room).emit('gameover', { score: match.score });
  const lobbyId = match.room.replace('lobby:', '');
  // Aktualizuj statistiky přihlášených hráčů
  const endLobby = lobbies.get(lobbyId);
  if (endLobby) {
    for (const sid of endLobby.members.keys()) logMetric(io.sockets.sockets.get(sid)?.data?.reconnectToken, 'match_end');
    const winTeam = match.score.home > match.score.away ? 'home' :
                    match.score.away > match.score.home ? 'away' : null;
  
    // Najdi MVP: hráč s nejvyšším počtem gólů+asistencí
    const scorers = match._goalScorers || [];
    const assisters = match._assists || [];
    const contributions = new Map();
    for (const sid of [...scorers, ...assisters])
      contributions.set(sid, (contributions.get(sid) || 0) + 1);
    let mvpSid = null, mvpScore = 0;
    for (const [sid, n] of contributions)
      if (n > mvpScore) { mvpScore = n; mvpSid = sid; }
  
    const paidUsers = new Set();   // jeden účet = jedna odměna (dvě záložky nefarmí dvojmo)
    for (const [sid, mem] of endLobby.members) {
      const sock = io.sockets.sockets.get(sid);
      const userId = sock?.data?.userId;
      if (!userId) continue;
      // Eligibilita přes userId (přežije reconnect); fallback na sid pro jistotu.
      if (!(match._startUserIds?.has(userId) || match._startSids?.has(sid))) continue;   // pozdě příchozí: bez odměny
      if (paidUsers.has(userId)) continue;
      paidUsers.add(userId);
  
      const goals   = scorers.filter(s => s === sid).length;
      const assists = assisters.filter(s => s === sid).length;
      const saves   = (match._blocks?.get(sid)) || 0;   // zblokované střely (polní „save")
      const isWin   = !!(winTeam && mem.team === winTeam);
      const isLoss  = !!(winTeam && mem.team !== winTeam);
      const isMVP   = sid === mvpSid;
      const pm      = (match._plusMinus?.get(sid)) || 0;
  
      // NHL-style rank delta
      const rankDelta = (isWin ? 20 : isLoss ? -10 : 0)
        + goals * 5 + assists * 3 + pm * 2 + (isMVP ? 10 : 0);
  
      // Puck Credits earned
      const creditsDelta = 5
        + (isWin ? 50 : isLoss ? 10 : 15)
        + goals * 15 + assists * 10;
  
      let founderUnlocked = false;
      try {
        updateStats(userId, { goals, assists, saves, games_played: 1, wins: isWin ? 1 : 0, losses: isLoss ? 1 : 0 });
        updateRankAndCredits(userId, { rankDelta, creditsDelta, plusMinusDelta: pm });
        // Pozvaný dohrál zápas → odměna Founder oběma (jednou). Referrera notifikuj živě, je-li online.
        const rr = rewardReferralIfPending(userId);
        if (rr) {
          founderUnlocked = true;
          for (const [, s] of io.sockets.sockets) {
            if (s.data?.userId === rr.referrerId) { s.emit('founder_unlocked', { role: 'referrer' }); break; }
          }
        }
      } catch {}
  
      // Pošli hráči výsledek s jeho odměnami
      sock.emit('match_rewards', { goals, assists, isWin, isMVP, rankDelta, creditsDelta, pm, founderUnlocked });
    }
  }
  match.rematchTimer = setTimeout(() => {
    const lb = lobbies.get(lobbyId);
    if (lb && lb.match === match) autoRematch(lb);
  }, 10000);
}

// Vytvoř Player entitu z člena lobby (týmy + dresy z nastavení, doplňky z profilu)
function buildPlayer(lobby, sid, m) {
  const p = new Player(sid, m.team, makeInput());
  p.name   = m.name;
  p._badge = m.badge || '';
  p.handed = m.handed;
  p.num    = m.number;
  const ts = lobby.settings.teams[m.team] || {};
  p.color  = ts.color || null;
  p.jersey = ts.style || 'solid';
  p.helmet = m.helmet; p.shorts = m.shorts; p.gloves = m.gloves; p.tape = m.tape; p.trail = m.trail;
  p.stick = m.stick; p.tapeStyle = m.tapeStyle; p.helmetType = m.helmetType; p.visor = m.visor;
  return p;
}

// Boti doplní prázdná místa: menší tým dorovná na velikost většího (min. 1 hráč na tým).
// Žijí jen v zápase (ne v lobby.members) → nepočítají se do statistik ani do kapacity lobby.
function syncBots(lobby, match) {
  const humans = { home: 0, away: 0 };
  for (const m of lobby.members.values()) humans[m.team]++;
  const target = botTarget(humans, lobby.settings);   // {home, away} = cílový počet hráčů v týmu
  for (const team of ['home', 'away']) {
    const bots = [...match.players.values()].filter(p => p.isBot && p.team === team);
    const need = Math.max(0, target[team] - humans[team]);
    while (bots.length > need) {
      const b = bots.pop();
      match.players.delete(b.id); match.inputs.delete(b.id);
    }
    while (bots.length < need) {
      const id = `bot:${team}:${match._botSeq = (match._botSeq || 0) + 1}`;
      const p = buildPlayer(lobby, id, makeMember({ name: 'BOT' }, team));
      p.isBot = true;
      p.brain = makeBotBrain(hashSeed(lobby.id + id));
      match.players.set(id, p); match.inputs.set(id, p.input);
      bots.push(p);
    }
  }
  rebuildEntities(match);
}

// Sestav zápas z členů lobby (týmy + dresy z nastavení, číslo z profilu)
function shuffleTeams(lobby) {
  const rng = makeRng(hashSeed(lobby.id + ':shuffle:' + (lobby.matchSeq || 0)));   // seedované → opakovatelné
  const ids = [...lobby.members.keys()];
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
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
  lobby.matchSeq = (lobby.matchSeq || 0) + 1;
  const seed = hashSeed(lobby.id + ':match:' + lobby.matchSeq);   // deterministický seed zápasu
  console.log(`match start lobby=${lobby.id} #${lobby.matchSeq} seed=${seed}`);
  const match = createMatch(lobby.id, seed);
  for (const [sid, m] of lobby.members) {
    const p = buildPlayer(lobby, sid, m);
    const uid = io.sockets.sockets.get(sid)?.data?.userId;
    p._founder = uid ? isFounder(uid) : false;   // korunka u jména (spočítáno jednou při startu, do snapshotu)
    match.players.set(sid, p);
    match.inputs.set(sid, p.input);
  }
  syncBots(lobby, match);
  match._startSids = new Set(lobby.members.keys());   // pozdě příchozí bez odměny (sid snímek)
  // Stabilní klíč odměny = userId (přežije reconnect, kdy se socket.id změní). Bez něj by
  // reconnectnutý hráč na konci nedostal góly/rank/kredity (sid už není v _startSids).
  match._startUserIds = new Set();
  for (const sid of lobby.members.keys()) {
    const uid = io.sockets.sockets.get(sid)?.data?.userId;
    if (uid) match._startUserIds.add(uid);
  }
  // Gólmani v barvě svého týmu (levá branka = home, pravá = away)
  match.goalieL.color = lobby.settings.teams.home.color;
  match.goalieR.color = lobby.settings.teams.away.color;
  // Časomíra
  match.periods = lobby.settings.periods;
  match.minutes = lobby.settings.minutes;
  match.period  = 1;
  match.clock   = match.minutes * 60;   // sekundy do konce třetiny
  match.weekRule = lobby.settings.quick ? weekRuleFor(new Date()) : null;
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
  for (const sid of lobby.members.keys()) logMetric(io.sockets.sockets.get(sid)?.data?.reconnectToken, 'match_start');
}


function snapPlayers(match) {
  const players = [];
  for (const [id, p] of match.players) {
    const inp = match.inputs.get(id);
    players.push({
      id, team: p.team, nm: p.name || '', fn: p._founder ? 1 : 0, bg: p._badge || '', sq: (inp && inp._sq) || 0,
      x: r1(p.x), y: r1(p.y), ba: r3(p.bodyAngle), aa: r3(p.aimAngle), ca: r3(p.carryAngle),
      sd: r3(p._stickDisp), dr: r1(p._dispReach), dc: r2(p._dispCharge),
      fh: p.forehand ? 1 : 0, hp: p.hasPuck ? 1 : 0, ch: r2(p.charge),
      hd: p.handed, cc: p.crossCheck ? 1 : 0, ln: r2(p._lean), ...(p.isDown || p._stagT > 0 ? { kd: [r2(p._downT), r2(p._upT), r2(p._fallA), r2(p._stagT), p._fallN, r2(p._fallB)] } : {}), ...(p._shieldT > 0 ? { shd: r2(p._shieldA) } : {}), ...(p._kickFx > 0 || p._kickSw > 0 ? { kk: [r2(Math.max(0, p._kickFx || 0)), r2(Math.max(0, p._kickSw || 0)), r1(p._kickOx || 0), r1(p._kickOy || 0), p._kickSide || 1, p._kickN || 0, p._kickSwN || 0] } : {}),
      col: p.color || null, num: p.num, js: p.jersey || 'solid',
      hc: p.helmet || null, sh: p.shorts || null, gc: p.gloves || null, tc: p.tape || null,
      sk: p.stick || null, ty: p.tapeStyle || 'full', hy: p.helmetType || 'visor', vc: p.visor || null,
    });
  }
  return players;
}

function broadcast(match) {
  const players = snapPlayers(match);
  const g = (gg) => ({ x: r1(gg.x), y: r1(gg.y), t: r3(gg._tilt), h: gg._holdTimer > 0 ? 1 : 0,
                       st: gg._saveType, sf: r2(gg._saveFlash), sm: r2(gg._saveFlashMax), sc: r2(gg._screen),
                       ps: gg.stance || 'stand', pd: gg._side || 1, pt: r2(Math.min(1, gg._stanceT || 0)),   // postoj gólmana (vizuál)
                       pk: gg._pkK > 0 ? [r2(gg._pkK), r1(gg._pkX), r1(gg._pkY)] : 0,   // výpad hokejkou (vizuál)
                       hit: gg._hit ? [r1(gg._hit.x), r1(gg._hit.y), gg._hit.n, gg._hit.part] : null,   // místo dotyku (záblesk + ruka)
                       col: gg.color || null });
  io.to(match.room).emit('snap', {
    n: match.tick,
    players,
    puck: { x: r1(match.puck.x), y: r1(match.puck.y), z: r1(match.puck.z), tc: match.puck.trailColor || null, ev: match.puck._ev || 0, ph: match.puck._postHit ? [r1(match.puck._postHit.x), r1(match.puck._postHit.y), match.puck._postHit.n, match.puck._postHit.k] : null },
    gl: g(match.goalieL), gr: g(match.goalieR),
    score: match.score,
    lock: match.world._goalLock ? 1 : 0,
    clk: Math.max(0, Math.ceil(match.clock)), per: match.period, pers: match.periods, end: match.ended ? 1 : 0,
    pnd: pendingFlags(match),
    ...(match.weekRule ? { wr: match.weekRule } : {}),
    ...(match._fx && match._fx.length ? { fx: match._fx.splice(0) } : {}),
  });
}

const r1 = n => Math.round(n * 10) / 10;
const r2 = n => Math.round((n || 0) * 100) / 100;
const r3 = n => Math.round((n || 0) * 1000) / 1000;

// ── Lobby systém ───────────────────────────────────────────────────────────
const lobbies = new Map();  // id -> lobby
// Pending reconnects: key = 'u:{userId}' or 't:{reconToken}', 15s grace window
const pendingReconnects = new Map();

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
    quick:   !!s.quick,   // rychlá hra (HRÁT) → týdenní pravidlo
    max:     [2, 4, 6, 8, 10].includes(s.max) ? s.max : 10,
    botFill: s.botFill === undefined ? 1 : clampBots(s.botFill),   // doplnit tým na N hráčů boty (0–5; default 1 = původní auto-dorovnání)
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
// Člen lobby za socket: jméno VŽDY z účtu (jedinečné, db.js claimName) — ne z prohlížeče; + ikonka původu.
function memberFor(socket, profile, team) {
  const m = makeMember(profile, team), uid = socket.data.userId;
  if (uid) { try { const u = getUserById(uid); if (u?.display_name) m.name = u.display_name; m.badge = userBadge(uid); } catch {} }
  return m;
}
function makeMember(profile, team) {
  profile = profile || {};
  return {
    name:   String(profile.name || '').slice(0, 12),
    sponsor: isSponsorCode(profile.code),
    handed: (profile.handed === -1 || profile.handed === 1) ? profile.handed : 1,
    number: Number.isInteger(profile.number) ? Math.max(0, Math.min(99, profile.number)) : null,
    helmet: hex(profile.helmet, '#eef2f8'),  // osobní doplňky (helma/rukavice/páska)
    shorts: hex(profile.shorts, '#df2626'),
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
    players: [...l.members.entries()].map(([id, m]) => ({ id, name: m.name, team: m.team, number: m.number, dc: m.disconnected || false })),
  };
}
function sendLobbyList(socket) {
  const list = [...lobbies.values()].filter(l => l.state === 'waiting' || l.state === 'playing').map(lobbySummary);
  (socket || io).emit('lobby:list', list);
}
const broadcastLobby = (l) => io.to('lobby:' + l.id).emit('lobby:state', lobbyState(l));

function _removeFromLobby(lobbyId, socketId) {
  const l = lobbies.get(lobbyId);
  if (!l) return;
  l.members.delete(socketId);
  if (l.match) {
    l.match.players.delete(socketId); l.match.inputs.delete(socketId);
    if (l.members.size > 0) syncBots(l, l.match); else rebuildEntities(l.match);   // odešel člověk → doplní bot
  }
  io.to('lobby:' + lobbyId).emit('peer-left');
  if (l.members.size === 0) {
    if (l.match) { clearInterval(l.match.loop); clearTimeout(l.match.rematchTimer); }
    lobbies.delete(lobbyId);
  } else {
    if (l.hostId === socketId) l.hostId = l.members.keys().next().value;
    broadcastLobby(l);
  }
  sendLobbyList();
}

function leaveCurrentLobby(socket) {
  const id = socket.data.lobbyId;
  if (!id) return;
  socket.data.lobbyId = null;
  socket.leave('lobby:' + id);
  _removeFromLobby(id, socket.id);
}

function disconnectWithGrace(socket) {
  const lobbyId = socket.data.lobbyId;
  if (!lobbyId) return;
  const l = lobbies.get(lobbyId);
  if (!l || !l.match || l.match.ended) { leaveCurrentLobby(socket); return; }
  const member = l.members.get(socket.id);
  if (!member) { leaveCurrentLobby(socket); return; }

  member.disconnected = true;
  socket.leave('lobby:' + lobbyId);
  socket.data.lobbyId = null;

  // Freeze input so disconnected player doesn't drift
  const inp = l.match.inputs.get(socket.id);
  if (inp) { inp.dx = 0; inp.dy = 0; inp.lmb = false; inp.rmb = false; }

  broadcastLobby(l);

  const key = socket.data.userId ? `u:${socket.data.userId}`
    : (socket.data.reconnectToken ? `t:${socket.data.reconnectToken}` : null);

  if (key) {
    const timer = setTimeout(() => {
      pendingReconnects.delete(key);
      _removeFromLobby(lobbyId, socket.id);
    }, 15_000);
    pendingReconnects.set(key, { lobbyId, oldSid: socket.id, timer });
  } else {
    _removeFromLobby(lobbyId, socket.id);
  }
}

const broadcastOnline = () => io.emit('online_count', { count: connCount });

// Limit zakládání hostů na IP (ochrana proti zaplevelení DB); za Caddy je remote loopback → poslední X-Forwarded-For
const guestHits = new Map();
function socketIp(socket) {
  const a = socket.handshake.address || '';
  if (a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1') {
    // Cloudflare Tunnel (cloudflared → localhost) posílá skutečnou IP hráče v CF-Connecting-IP
    const cf = String(socket.handshake.headers['cf-connecting-ip'] || '').trim();
    if (cf) return cf;
    const xff = String(socket.handshake.headers['x-forwarded-for'] || '').split(',').pop().trim();
    if (xff) return xff;
  }
  return a;
}
function guestQuotaOk(ip, max = 60, windowMs = 3_600_000) {
  const now = Date.now();
  let h = guestHits.get(ip);
  if (!h || h.reset <= now) { h = { n: 0, reset: now + windowMs }; guestHits.set(ip, h); }
  return ++h.n <= max;
}
setInterval(() => { const now = Date.now(); for (const [k, h] of guestHits) if (h.reset <= now) guestHits.delete(k); }, 60_000).unref();

io.on('connection', (socket) => {
  if (connCount >= MAX_CONN) { socket.disconnect(true); return; }
  connCount++;
  broadcastOnline();
  // Bezpečné handlery: vadná zpráva od klienta (chybná data) smí shodit jen svůj handler, NE celý server.
  // (socket.io chyby v listeneru nechytá → bez tohoto by `emit('lobby:create')` bez dat spadl proces.)
  const rawOn = socket.on.bind(socket);
  socket.on = (ev, fn) => rawOn(ev, (...args) => {
    try { return fn(...args); }
    catch (e) { console.error(`handler ${ev} selhal (socket ${socket.id}):`, e?.message); }
  });
  // Přečti JWT cookie a ulož userId pro tracking statistik
  const rawCookie = socket.handshake.headers.cookie || '';
  const cm = rawCookie.match(/(?:^|;\s*)fh_session=([^;]+)/);
  // Token (handshake.auth.token) má přednost jako u API; jinak cookie; jinak vytvoř hosta a pošli klientovi nový token
  socket.data.userId = verifySession(socket.handshake.auth?.token)
    ?? (cm ? verifySession(decodeURIComponent(cm[1])) : null);
  if (!socket.data.userId && guestQuotaOk(socketIp(socket))) {
    try {
      // původ hosta z odkazu/refereru (itch.io / CrazyGames iframe) — ikonka u jména; ODHAD: referrer iframe = stránka portálu
      const ref = String(socket.handshake.auth?.ref || '').toLowerCase();
      const g = createGuestAccount(ref.includes('itch') ? 'itch' : ref.includes('crazygames') ? 'cg' : 'web');
      socket.data.userId = g.userId;
      socket.emit('device_token', { token: g.token });
    } catch (err) { console.error('guest create failed', err); }
  }
  // rt vybírá klient (náhodné UUID z localStorage) → jen formát [A-Za-z0-9_-]{8,64}, jinak null.
  // Neuhodnutelnost 128bit náhodného tokenu je jediná ochrana slotu; přihlášený hráč se páruje přes userId (u:...).
  { const rt = socket.handshake.auth?.rt;
    socket.data.reconnectToken = typeof rt === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(rt) ? rt : null; }
  // Anonymní metrika: pid = reconnect token (perzistentní v localStorage)
  { const pid = socket.data.reconnectToken, ref = socket.handshake.auth?.ref;
    if (pid) { logMetric(pid, 'visit'); if (typeof ref === 'string' && ref) logMetric(pid, 'source', ref); } }

  // Reconnect: obnov hráče v lobby pokud má platný pending slot
  const rKey = socket.data.userId ? `u:${socket.data.userId}`
    : (socket.data.reconnectToken ? `t:${socket.data.reconnectToken}` : null);
  if (rKey && pendingReconnects.has(rKey)) {
    const pend = pendingReconnects.get(rKey);
    clearTimeout(pend.timer);
    pendingReconnects.delete(rKey);
    const l = lobbies.get(pend.lobbyId);
    if (l) {
      const member = l.members.get(pend.oldSid);
      if (member) {
        member.disconnected = false;
        l.members.delete(pend.oldSid);
        l.members.set(socket.id, member);
        if (l.hostId === pend.oldSid) l.hostId = socket.id;
        if (l.match) {
          const player = l.match.players.get(pend.oldSid);
          if (player) {
            l.match.players.delete(pend.oldSid); l.match.inputs.delete(pend.oldSid);
            const newInp = makeInput();
            l.match.players.set(socket.id, player);
            l.match.inputs.set(socket.id, newInp);
            player.input = newInp;
            rebuildEntities(l.match);
          }
        }
        socket.join('lobby:' + l.id);
        socket.data.lobbyId = l.id;
        if (l.match && !l.match.ended) {
          socket.emit('lobby:start', { settings: l.settings, reconnected: true });
        } else {
          socket.emit('lobby:joined', lobbyState(l));
          broadcastLobby(l);
        }
        sendLobbyList();
      }
    }
  }

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
    l.members.set(socket.id, memberFor(socket, profile, 'home'));
    lobbies.set(id, l);
    socket.join('lobby:' + id);
    socket.data.lobbyId = id;
    socket.emit('lobby:joined', lobbyState(l));
    sendLobbyList();
  });

  socket.on('lobby:join', ({ id, profile, password, invited }) => {
    if (!rateOk(socket, 'join', 500)) return;
    if (typeof id !== 'string') return;
    const l = lobbies.get(id);
    if (!l || (l.state !== 'waiting' && l.state !== 'playing')) { socket.emit('lobby:error', 'err_unavailable'); return; }
    if (l.settings.password && l.settings.password !== String(password || '')) { socket.emit('lobby:error', 'err_password'); return; }
    if (l.members.size >= l.settings.max) { socket.emit('lobby:error', 'err_full'); return; }
    // Pozvánka kamaráda: přišel přes sdílený odkaz (?join=…). Zvoucí = hostitel lobby.
    // Zapíšeme vztah; odměna (titul Founder oběma) padne, až pozvaný dohraje zápas.
    if (invited) {
      const hostUserId = io.sockets.sockets.get(l.hostId)?.data?.userId;
      if (hostUserId && socket.data.userId) { try { recordReferral(socket.data.userId, hostUserId); } catch {} }
    }
    leaveCurrentLobby(socket);
    const m = memberFor(socket, profile, balanceTeam(l));
    l.members.set(socket.id, m);
    socket.join('lobby:' + id);
    socket.data.lobbyId = id;
    if (l.state === 'playing' && l.match) {
      // Připojení do běžícího zápasu — přidej hráče a hoď ho rovnou do hry
      const p = buildPlayer(l, socket.id, m);
      p._founder = socket.data.userId ? isFounder(socket.data.userId) : false;
      p.x = m.team === 'home' ? RINK.w * 0.3 : RINK.w * 0.7;
      p.y = RINK.h / 2;
      l.match.players.set(socket.id, p);
      l.match.inputs.set(socket.id, p.input);
      syncBots(l, l.match);   // přišel člověk → bot uvolní místo
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
    if (team !== 'home' && team !== 'away') return;
    if (m.team === team) return;
    // Strop na tým = polovina kapacity lobby → zabrání nevyváženým týmům (dřív šlo 10v0).
    const teamCap = Math.max(1, Math.ceil(l.settings.max / 2));
    let onTeam = 0; for (const o of l.members.values()) if (o.team === team) onTeam++;
    if (onTeam >= teamCap) { socket.emit('lobby:error', 'err_team_full'); return; }
    m.team = team; broadcastLobby(l);
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

  socket.on('lobby:leave', () => { socket.data._voluntaryLeave = true; leaveCurrentLobby(socket); });

  // Divák (2026-11-02): sleduje běžící zápas — dostává snímky místnosti, ale nemá hráče, vstupy
  // ani místo v lobby (nepočítá se do kapacity, odměn ani statistik). Pro mobil i PC.
  const MAX_WATCHERS = 50;
  const stopWatching = () => { const w = socket.data.watchId; if (!w) return; socket.data.watchId = null; socket.leave('lobby:' + w); const l = lobbies.get(w); if (l) l.watchers = Math.max(0, (l.watchers || 1) - 1); };
  socket.on('lobby:watch', ({ id, password } = {}) => {
    if (!rateOk(socket, 'watch', 500)) return;
    if (typeof id !== 'string') return;
    const l = lobbies.get(id);
    if (!l || l.state !== 'playing' || !l.match) { socket.emit('lobby:error', 'err_unavailable'); return; }
    if (l.settings.password && l.settings.password !== String(password || '')) { socket.emit('lobby:error', 'err_password'); return; }
    if ((l.watchers || 0) >= MAX_WATCHERS) { socket.emit('lobby:error', 'err_full'); return; }
    leaveCurrentLobby(socket); stopWatching();
    socket.data.watchId = id; l.watchers = (l.watchers || 0) + 1;
    socket.join('lobby:' + id);
    socket.emit('lobby:start', { settings: l.settings, spectate: true });
  });
  socket.on('lobby:unwatch', stopWatching);
  socket.on('disconnect', stopWatching);

  // Síťová telemetrie z klienta (FPS, jitter snapshotů) — pro diagnostiku plynulosti, read-only v /api/netstat
  socket.on('netstat', (d) => {
    if (!rateOk(socket, 'netstat', 2000) || !d) return;
    const num = (v, max) => { v = Number(v); return Number.isFinite(v) ? Math.max(0, Math.min(max, Math.round(v))) : 0; };
    netStats.push({ t: Date.now(), fps: num(d.fps, 999), frameMax: num(d.frameMax, 9999), snapAvg: num(d.snapAvg, 9999), snapMax: num(d.snapMax, 9999), stalls: num(d.stalls, 9999), buf: num(d.buf, 9999) });
    while (netStats.length > 60) netStats.shift();
  });

  socket.on('input', (msg) => {
    // Strop ~150 vstupů/s na socket (legitimní je ~60) → blokuje záplavu vstupů
    const now = Date.now();
    const rl = socket.data._inrl || (socket.data._inrl = { t: now, n: 0 });
    if (now - rl.t > 1000) { rl.t = now; rl.n = 0; }
    if (++rl.n > 150) return;
    const l = lobbies.get(socket.data.lobbyId);
    if (!l || !l.match) return;
    const inp = l.match.inputs.get(socket.id);
    if (inp) { applyClientInput(inp, msg); inp._stamp = now; }
  });

  socket.on('disconnect', () => {
    connCount--;
    broadcastOnline();
    if (socket.data._voluntaryLeave || !socket.data.lobbyId) {
      leaveCurrentLobby(socket);
    } else {
      disconnectWithGrace(socket);
    }
  });
});

// ── API: Leaderboard ──────────────────────────────────────────────────────────
app.get('/api/leaderboard', (_req, res) => {
  try { res.json(getLeaderboard(100)); }
  catch { res.status(500).json({ error: 'db_error' }); }
});

// ── API: Season ───────────────────────────────────────────────────────────────
app.get('/api/season', (_req, res) => {
  try { res.json(getActiveSeason() ?? null); }
  catch { res.status(500).json({ error: 'db_error' }); }
});

// ── API: Rank pozice přihlášeného hráče ──────────────────────────────────────
app.get('/api/me/rank', requireAuth, (req, res) => {
  try { res.json(getRankPosition(req.userId) ?? { rank_points: 1000, position: null }); }
  catch { res.status(500).json({ error: 'db_error' }); }
});

// ── API: Puck Credits ─────────────────────────────────────────────────────────
app.get('/api/me/credits', requireAuth, (req, res) => {
  try { res.json({ puck_credits: getPuckCredits(req.userId) }); }
  catch { res.status(500).json({ error: 'db_error' }); }
});

// ── API: Store items + co hráč vlastní ───────────────────────────────────────
app.get('/api/store', requireAuth, (req, res) => {
  try {
    const items = getStoreItems();
    const owned = getUserUnlocks(req.userId);
    const credits = getPuckCredits(req.userId);
    res.json({ items, owned, puck_credits: credits });
  } catch { res.status(500).json({ error: 'db_error' }); }
});

// ── API: Nákup položky ────────────────────────────────────────────────────────
app.post('/api/store/buy', requireAuth, (req, res) => {
  const item_id = parseInt(req.body?.item_id, 10);
  if (!item_id) return res.status(400).json({ error: 'missing_item_id' });
  try {
    const result = buyItem(req.userId, item_id);
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  } catch { res.status(500).json({ error: 'db_error' }); }
});

// ── Produkční zpevnění: validace env, /health, graceful shutdown ──
if (!process.env.JWT_SECRET) console.warn('⚠ JWT_SECRET není nastaven — přihlášení (Discord i host účet) nebude fungovat.');
if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET) console.warn('⚠ DISCORD_* není nastaveno — Discord login vypnutý (host mód funguje).');

const netStats = [];   // ring buffer poslední síťové telemetrie z klientů (FPS/jitter) pro /api/netstat
app.get('/health', (req, res) => res.json({ ok: true, lobbies: lobbies.size, matches: countMatches(), uptime: Math.round(process.uptime()) }));
app.get('/api/netstat', (req, res) => {   // read-only diagnostika plynulosti (bez PII)
  const a = netStats.slice(-30);
  const avg = (k) => a.length ? Math.round(a.reduce((s, x) => s + x[k], 0) / a.length) : 0;
  res.json({ count: a.length, avg: { fps: avg('fps'), frameMax: avg('frameMax'), snapAvg: avg('snapAvg'), snapMax: avg('snapMax') }, recent: a });
});

// Retence metrik: úklid při startu + jednou denně (DB jinak bobtná)
try { cleanOldMetrics(); } catch {}
setInterval(() => { try { cleanOldMetrics(); } catch {} }, 24 * 3600 * 1000).unref();

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`→ listening on :${PORT}`));

let _shuttingDown = false;
function shutdown(sig) {
  if (_shuttingDown) return; _shuttingDown = true;
  console.log(`\n${sig} → graceful shutdown`);
  try { io.close(); } catch {}
  server.close(() => { console.log('server zavřen'); process.exit(0); });
  setTimeout(() => process.exit(0), 5000).unref();   // pojistka, kdyby close visel
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// Jen pro testy (test/determinism.test.mjs) — krokování zápasu bez sítě
export const __test = { lobbies, startMatch, stepMatch, makeMember, sanitizeSettings, snapPlayers };
