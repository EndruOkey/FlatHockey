// Měří, jestli přihrávka dorazí jedoucímu příjemci DO STRIDE (na hokejku), nebo "za něj".
// Podélný offset: + = puk dorazí PŘED příjemce (do jízdy, dobře), − = ZA něj (musí couvnout).
// Reprodukce pass_test setup. Env: FH_LEADK. Spuštění: node scripts/pass_stride.mjs
import { tmpdir } from 'os'; import { join } from 'path';
process.env.PORT = process.env.PORT || '4677';
process.env.DB_PATH = join(tmpdir(), `fh-stride-${process.pid}.db`);
const { __test } = await import('../server.js');
const { RINK } = await import('../public/js/constants.js');
const { lobbies, startMatch, stepMatch, makeMember, sanitizeSettings } = __test;
const DIRS = [[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1],[0,-1],[1,-1]];

let ok = 0, n = 0; const alongs = [], lats = [], recvSpeeds = [];
for (const dist of [100, 180, 260]) for (let di = 0; di < DIRS.length; di++) {
  const id = `S${dist}_${di}`;
  const l = { id, hostId: 'h0', state: 'waiting', settings: sanitizeSettings({ minutes: 5, periods: 1 }), members: new Map(), matchSeq: 0 };
  l.members.set('h0', makeMember({ name: 'A' }, 'home')); l.members.set('h1', makeMember({ name: 'B' }, 'home'));
  lobbies.set(id, l); startMatch(l); const m = l.match; clearInterval(m.loop);
  while (m.setup) stepMatch(m);
  const a = m.players.get('h0'), b = m.players.get('h1');
  for (const p of m.players.values()) if (p.team === 'away') { p.isBot = false; p.x = 40; p.y = 40; p.vx = p.vy = 0; }
  const cx = RINK.centerX, cy = RINK.h / 2;
  a.x = cx - dist / 2; a.y = cy; a.vx = a.vy = 0; a.hasPuck = true; a._possT = 99; m.puck.x = a.x + 12; m.puck.y = a.y;
  const [dx, dy] = DIRS[di]; const dl = Math.hypot(dx, dy); const hx = dx / dl, hy = dy / dl;   // heading příjemce
  b.x = cx + dist / 2; b.y = cy; b.vx = hx * 180; b.vy = hy * 180; b.hasPuck = false;
  const ia = m.inputs.get('h0'), ib = m.inputs.get('h1');
  let passed = false, got = false, minD = 1e9, alongAtMin = 0, latAtMin = 0, recvSp = 0;
  for (let t = 0; t < 150; t++) {
    ib.dx = dx; ib.dy = dy; ib.aim = Math.atan2(a.y - b.y, a.x - b.x); ib.aimDist = 40; ib._stamp = 0;
    ia.dx = ia.dy = 0; ia.aim = Math.atan2(b.y - a.y, b.x - a.x); ia.aimDist = 40; ia._stamp = 0;
    ia.rmb = (t === 10);
    stepMatch(m);
    if (t === 10) passed = !a.hasPuck;
    if (passed && !got) {
      // offset puku vůči příjemci, rozložený do směru jízdy (along) a kolmo (lat)
      const rx = m.puck.x - b.x, ry = m.puck.y - b.y, d = Math.hypot(rx, ry);
      if (d < minD) { minD = d; alongAtMin = rx * hx + ry * hy; latAtMin = rx * -hy + ry * hx; recvSp = (b.vx * hx + b.vy * hy); }
    }
    if (b.hasPuck) { got = true; break; }
  }
  n++; if (got) ok++;
  if (passed) { alongs.push(alongAtMin); lats.push(Math.abs(latAtMin)); recvSpeeds.push(recvSp); }
  lobbies.delete(id);
}
const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const behind = alongs.filter(v => v < -3).length;
console.log(`LEAD_K=${process.env.FH_LEADK || '0.7'}`);
console.log(`převzato: ${Math.round(100*ok/n)} %   (z ${n})`);
console.log(`podélný offset Ø: ${avg(alongs).toFixed(1)} px  (+ = do jízdy před příjemce, − = ZA něj)`);
console.log(`  z toho "za ním" (<−3px): ${behind}/${alongs.length} přihrávek`);
console.log(`boční offset Ø: ${avg(lats).toFixed(1)} px   |  rychlost příjemce při příjmu Ø: ${avg(recvSpeeds).toFixed(0)}/180 px/s`);
process.exit(0);
