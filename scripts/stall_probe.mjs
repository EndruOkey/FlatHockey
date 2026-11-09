// Diagnostika stall testu: co dělá bot (režim, vzdálenost k nosiči / puku, krytí). node scripts/stall_probe.mjs
const { stallTest } = await import('../test/balance-metrics.mjs');
const modes = {}, near = [0, 0, 0]; let n = 0, exposedSum = 0, nearN = 0;
const st = stallTest(1, 120, (m, h) => {
  const b = [...m.players.values()].find(p => p !== h); n++;
  modes[b._botMode] = (modes[b._botMode] || 0) + 1;
  const d = Math.hypot(b.stickTip.x - m.puck.x, b.stickTip.y - m.puck.y);
  near[d < 12 ? 0 : d < 40 ? 1 : 2]++;
  if (h.hasPuck && d < 40) { const qx = m.puck.x - h.x, qy = m.puck.y - h.y, ox = b.x - h.x, oy = b.y - h.y;
    exposedSum += (qx * ox + qy * oy) / ((Math.hypot(qx, qy) || 1) * (Math.hypot(ox, oy) || 1)); nearN++; }
});
console.log('stall', (100 * st.held / st.liveT).toFixed(1), '| režimy bota', JSON.stringify(modes), '| špička–puk <12/12–40/>40 px:', near.join('/'), '| průměrné krytí (cos) když blízko:', nearN ? (exposedSum / nearN).toFixed(2) : '-');
process.exit(0);
