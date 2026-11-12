// Linearita pohybu VŠECH botů (s pukem i bez), server sim, seedy 1..S, 5 min, FH_TEAM na tým. Deterministické.
// Použití: node scripts/bot_linearity.mjs [S=6]      (env FH_TEAM, FH_MV, FH_BOTCURVE … se propisují)
// Metriky (jen živá hra, jen ticky, kdy bot jede ≥ 40 % top):
//  rovně %   = podíl ticků, kdy se kurz za posledních 0,5 s změnil < 5° (dlouhé přímky = „lineární")
//  osa45 %   = podíl ticků, kdy kurz leží do 2° od násobku 45° (8směrové zuby; náhodný kurz ≈ 8,9 %)
//  úsek s    = průměrná délka souvislé přímky (s)
//  zatáčení  = medián |změny kurzu| °/s
import { tmpdir } from 'os'; import { join } from 'path';
process.env.PORT = '4637'; process.env.DB_PATH = join(tmpdir(), `fh-lin-${process.pid}.db`);
const { __test } = await import('../server.js');
const { makeBotBrain, hashSeed } = await import('../public/js/bot.js');
const { PLAYER } = await import('../public/js/constants.js');
const { lobbies, startMatch, stepMatch, makeMember, sanitizeSettings } = __test;
const S = +(process.argv[2] || 6), TEAM = +(process.env.FH_TEAM || 2), WIN = 30, D2R = Math.PI / 180;
const G = { puck: { n: 0, str: 0, ax: 0, runs: 0, runT: 0, rates: [] }, off: { n: 0, str: 0, ax: 0, runs: 0, runT: 0, rates: [] } };
const ad = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
for (let s = 1; s <= S; s++) {
  const l = { id: 'bl' + s, hostId: 'h0', state: 'waiting', settings: sanitizeSettings({ rules: false, minutes: 5, periods: 1 }), members: new Map(), matchSeq: s - 1 };
  for (let i = 0; i < TEAM; i++) l.members.set('h' + i, makeMember({ name: 'H' + i }, 'home'));
  for (let i = 0; i < TEAM; i++) l.members.set('a' + i, makeMember({ name: 'A' + i }, 'away'));
  lobbies.set(l.id, l); startMatch(l); const m = l.match; clearInterval(m.loop);
  for (const [id, p] of m.players) { p.isBot = true; p.brain = makeBotBrain(hashSeed(l.id + id)); }
  const H = new Map();   // id → { hist: [kurz], run }
  while (!m.ended) {
    stepMatch(m);
    const live = !(m.setup || m.stoppage || m.world._goalLock);
    for (const [id, p] of m.players) {
      const st = H.get(id) || { hist: [], run: 0, prev: null }; H.set(id, st);
      const v = Math.hypot(p.vx, p.vy), hd = Math.atan2(p.vy, p.vx);
      const g = p.hasPuck ? G.puck : G.off;
      if (!live || v < 0.4 * PLAYER.speed) { if (st.run >= 6) { g.runs++; g.runT += st.run / 60; } st.hist = []; st.run = 0; st.prev = null; continue; }
      st.hist.push(hd); if (st.hist.length > WIN) st.hist.shift();
      if (st.prev != null) g.rates.push(ad(hd, st.prev) * 60 / D2R);
      st.prev = hd;
      if (st.hist.length < WIN) continue;
      g.n++;
      const straight = ad(st.hist[0], hd) < 5 * D2R;
      if (straight) { g.str++; st.run++; } else { if (st.run >= 6) { g.runs++; g.runT += st.run / 60; } st.run = 0; }
      const q = Math.round(hd / (Math.PI / 4)) * (Math.PI / 4); if (ad(hd, q) < 2 * D2R) g.ax++;
    }
  }
  lobbies.delete(l.id);
}
const med = a => { const b = [...a].sort((x, y) => x - y); return b.length ? b[b.length >> 1] : 0; };
const out = {};
for (const [k, g] of Object.entries(G)) out[k] = { rovne_pct: +(100 * g.str / g.n).toFixed(1), osa45_pct: +(100 * g.ax / g.n).toFixed(1), usek_s: +(g.runT / Math.max(1, g.runs)).toFixed(2), zataceni_dps: +med(g.rates).toFixed(1), n: g.n };
console.log(`TEAM=${TEAM} seedy 1..${S}`);
for (const [k, o] of Object.entries(out)) console.log(`  ${k === 'puck' ? 's pukem ' : 'bez puku'} | rovně ${o.rovne_pct} % | osa45 ${o.osa45_pct} % | úsek ${o.usek_s} s | zatáčení ${o.zataceni_dps} °/s | n=${o.n}`);
process.exit(0);
