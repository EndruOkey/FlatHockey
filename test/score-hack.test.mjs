// Pokusy hacknout skóre a odměny — ověřuje, že server žádný z nich nezapočítá.
// Spuštění: node test/score-hack.test.mjs  (npm run test:scorehack). Dočasná DB, bez sítě.
import { tmpdir } from 'os';
import { join } from 'path';
import { rmSync } from 'fs';

process.env.DB_PATH = join(tmpdir(), `fh-scorehack-${Date.now()}.db`);
process.env.JWT_SECRET = 'test';
const { __test } = await import('../server.js');
const { lobbies, startMatch } = __test;

let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'OK   ' : 'FAIL ') + msg); if (!ok) fails++; };

// Lobby se 2 lidmi (home H1, away A1) + nech boty vypnuté nastavením max
function freshMatch() {
  for (const k of [...lobbies.keys()]) lobbies.delete(k);
  const members = new Map([
    ['H1', { name: 'H', team: 'home', number: 10 }],
    ['A1', { name: 'A', team: 'away', number: 20 }],
  ]);
  const lobby = { id: 'SCOR', hostId: 'H1', state: 'waiting',
    settings: { teams: { home: {}, away: {} }, periods: 1, minutes: 5, rules: false, max: 2 }, members, match: null };
  lobbies.set('SCOR', lobby);
  startMatch(lobby);
  clearInterval(lobby.match.loop);   // řídíme ručně, bez reálné smyčky
  return lobby.match;
}

// 1) Gól po konci zápasu se nezapočítá
let m = freshMatch();
m.ended = true;
const before = m.score.home;
m._lastTouchSid = 'H1';
m.world.onGoal('goal-home');
check(m.score.home === before, `gól po konci zápasu nezvýší skóre (${before} → ${m.score.home})`);

// 2) Vlastní gól (home se naposled dotkl, ale skóroval away) → home hráči se NEpřipíše gól
m = freshMatch();
m._lastTouchSid = 'H1';
m.world.onGoal('goal-away');
check(!(m._goalScorers || []).includes('H1'), `vlastní gól nepřipíše střelci gól (scorers=${JSON.stringify(m._goalScorers || [])})`);
check(m.score.away === 1, 'vlastní gól se počítá soupeři do skóre');

// 3) Bot jako poslední dotek → není uznán jako střelec
m = freshMatch();
m._lastTouchSid = 'bot:home:1';
m.world.onGoal('goal-home');
check(!(m._goalScorers || []).some(s => s.startsWith('bot:')), `bot není uznán jako střelec (scorers=${JSON.stringify(m._goalScorers || [])})`);

// 4) Platný gól se správně připíše
m = freshMatch();
m._lastTouchSid = 'H1';
m.world.onGoal('goal-home');
check((m._goalScorers || []).includes('H1'), 'platný gól připíše střelce');
check(m.score.home === 1, 'platný gól zvýší skóre');

for (const k of [...lobbies.keys()]) { const lb = lobbies.get(k); if (lb.match) clearInterval(lb.match.loop); lobbies.delete(k); }
try { rmSync(process.env.DB_PATH); } catch {}
console.log(fails ? `\n${fails} FAIL` : '\nVŠE OK');
process.exit(fails ? 1 : 0);
