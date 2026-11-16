// Vzorek entity z jitter-bufferu (klient, game.js _interp). Čisté funkce → deterministický test scripts/test_net_teleport.mjs.
// TELEPORT (2026-11-16, Ondřej: „když se hráči teleportují na buly … občas se z nich stane roztažená šmouha"): dřív se mezi snímkem
// před a po buly interpolovalo → hráč přejel kluziště za ~33 ms rychlostí ~9 000 px/s (stopa sprintu, náklon, nohy) a při podtečení
// bufferu se navíc extrapoloval touto rychlostí až 0,22 s daleko mimo. Skok rychlejší než TP_SPEED = teleport → hned nová poloha, v = 0.
import { lerpAngle } from './utils.js';

export const TP_SPEED = 600;   // px/s; hráč jezdí ≤ ~200 (PLAYER.speed 165 + odraz), puk ≤ 470 se tu nevzorkuje
const ANG = ['ba', 'aa', 'ca', 'sd', 'tilt'];
export const isTeleport = (a, b, iv) => Math.hypot(b.x - a.x, b.y - a.y) > TP_SPEED * Math.max(iv, 1 / 30);

// mezi dvěma snímky (iv = jejich rozestup v s, alpha 0..1)
export function lerpSample(a, b, alpha, iv) {
  if (isTeleport(a, b, iv)) return { ...b, vx: 0, vy: 0, tp: true };
  const r = { x: a.x + (b.x - a.x) * alpha, y: a.y + (b.y - a.y) * alpha, vx: (b.x - a.x) / iv, vy: (b.y - a.y) / iv };
  for (const k of ANG) if (a[k] != null && b[k] != null) r[k] = lerpAngle(a[k], b[k], alpha);
  return r;
}
// za nejnovějším snímkem (podtečení bufferu): lineární extrapolace o ahead s
export function extrapSample(a, b, iv, ahead) {
  if (!a || iv <= 0 || isTeleport(a, b, iv)) return { ...b, vx: 0, vy: 0 };
  const vx = (b.x - a.x) / iv, vy = (b.y - a.y) / iv;
  return { ...b, x: b.x + vx * ahead, y: b.y + vy * ahead, vx, vy };
}
