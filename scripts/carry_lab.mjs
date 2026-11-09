// LABORATOŘ DRŽENÍ PUKU — deterministické scénáře (lidský vstup, žádní boti). Každý scénář × 5 seedů:
// liší-li se výsledek mezi seedy, rozhoduje KOSTKA, ne hráč. Spuštění s přepínači FH_SOFT / FH_FIGHT.
//  A) OTOČKA: nosič (stojí / jede 120 px/s) otočí kurzor o 90° nebo 180° za T s; kurzor blízko (40) / daleko (120).
//  B) SOUBOJ: nosič stojí/jede; útočník má čepel na puku zepředu-z boku a buď drží hůl (static),
//     nebo šmudlá (kurzor kmitá ±A° s frekvencí f). Měří čas do obrání (max 3 s).
// node scripts/carry_lab.mjs
const { createMatch, makeInput, rebuildEntities, stepMatch, DT } = await import('../public/js/match-core.js');
const { Player } = await import('../public/js/entities/Player.js');
const { RINK, PLAYER } = await import('../public/js/constants.js');
const SEEDS = [1, 2, 3, 4, 5];

function setup(seed) {
  const m = createMatch(seed); m.clock = 999; m.period = 1; m.periods = 1; m.minutes = 99; m.setup = false; m.stoppage = false;
  const H = new Player('h', 'home', makeInput()), A = new Player('a', 'away', makeInput());
  m.players.set('h', H); m.players.set('a', A); m.inputs.set('h', H.input); m.inputs.set('a', A.input); rebuildEntities(m);
  m.goalieL.x = -999; m.goalieR.x = -999;
  H.x = RINK.centerX - 150; H.y = RINK.h / 2; H.aimAngle = H.carryAngle = H.bodyAngle = H.skateAngle = 0;
  H.input.aim = 0; H.input.aimDist = 40; H.hasPuck = true; H._possT = 99; m.puck.ownerId = 'h';
  A.x = -500; A.y = -500;   // mimo hru, dokud ho scénář nepostaví
  for (let i = 0; i < 20; i++) stepMatch(m);
  return { m, H, A };
}

// A) otočka: vrací ticky do ztráty (−1 = udržel)
function turn(seed, { deg, T, dist, move }) {
  const { m, H } = setup(seed); const n = Math.max(1, Math.round(T / DT)), tot = deg * Math.PI / 180;
  H.input.aimDist = dist;
  for (let t = 0; t < n + 30; t++) {
    H.input.dx = move ? 1 : 0; H.input.aim = tot * Math.min(1, t / n);
    stepMatch(m); if (!H.hasPuck) return t;
  }
  return -1;
}

// C) kličky: nosič stojí/jede, kurzor kmitá ±amp° kolem směru jízdy frekvencí f (ruce: forhend↔bekhend)
function dribble(seed, { amp, f, dist, move }) {
  const { m, H } = setup(seed); H.input.aimDist = dist;
  for (let t = 0; t < 120; t++) { H.input.dx = move ? 1 : 0; H.input.aim = Math.sin(t * DT * Math.PI * 2 * f) * amp * Math.PI / 180; stepMatch(m); if (!H.hasPuck) return t; }
  return -1;
}

// B) souboj: vrací ticky do obrání (−1 = neobral za 3 s)
function fight(seed, { mode, A: amp = 0, f = 0, move }) {
  const { m, H, A } = setup(seed);
  const side = Math.PI * 0.35;                       // útočník zepředu-z boku (puk na jeho straně těla nosiče)
  const P = m.puck; A.x = P.x + Math.cos(side) * 20; A.y = P.y + Math.sin(side) * 20; A.vx = A.vy = 0;
  for (let t = 0; t < 180; t++) {
    H.input.dx = move ? 1 : 0;
    const dx = P.x - A.x, dy = P.y - A.y, d = Math.hypot(dx, dy), base = Math.atan2(dy, dx);
    A.input.dx = move ? 1 : 0;                        // jede vedle nosiče
    A.input.aim = base + (mode === 'sweep' ? Math.sin(t * DT * Math.PI * 2 * f) * amp * Math.PI / 180 : 0);
    A.input.aimDist = Math.max(20, d);
    stepMatch(m); if (!H.hasPuck) return t;
  }
  return -1;
}

const fmt = rs => { const same = rs.every(r => r === rs[0]); const s = rs.map(r => r < 0 ? '—' : (r * DT).toFixed(2)).join(' ');
  return `${same ? 'DET ' : 'KOST'} ${s}`; };
const mode = `SOFT=${PLAYER.softCarry} FIGHT=${PLAYER.fight}`;
let dice = 0, rows = [];
console.log(`== ${mode}   (sloupce = seedy 1–5; čas ztráty v s, — = udržel/neobral; KOST = výsledek závisí na seedu)`);
console.log('A) OTOČKA');
for (const move of [false, true]) for (const dist of [40, 120]) for (const deg of [90, 180]) for (const T of [0.15, 0.3, 0.6]) {
  const rs = SEEDS.map(s => turn(s, { deg, T, dist, move })); if (!rs.every(r => r === rs[0])) dice++;
  console.log(`  ${move ? 'jede ' : 'stojí'} kurzor ${String(dist).padStart(3)} ${String(deg).padStart(3)}° za ${T.toFixed(2)} s  ${fmt(rs)}`);
}
console.log('B) SOUBOJ HOLÍ');
for (const move of [false, true]) for (const sc of [{ mode: 'static' }, { mode: 'sweep', A: 15, f: 2 }, { mode: 'sweep', A: 30, f: 3 }, { mode: 'sweep', A: 45, f: 4 }]) {
  const rs = SEEDS.map(s => fight(s, { ...sc, move })); if (!rs.every(r => r === rs[0])) dice++;
  console.log(`  ${move ? 'jede ' : 'stojí'} ${(sc.mode === 'static' ? 'drží hůl' : `šmudlá ±${sc.A}° ${sc.f} Hz`).padEnd(18)} ${fmt(rs)}`);
}
console.log('C) KLIČKY (2 s)');
for (const move of [false, true]) for (const dist of [40, 120]) for (const [amp, f] of [[40, 1.5], [40, 3], [60, 3], [60, 5]]) {
  const rs = SEEDS.map(s => dribble(s, { amp, f, dist, move })); if (!rs.every(r => r === rs[0])) dice++;
  console.log(`  ${move ? 'jede ' : 'stojí'} kurzor ${String(dist).padStart(3)} ±${amp}° ${f} Hz  ${fmt(rs)}`);
}
console.log(`Scénářů s kostkou: ${dice}`);
