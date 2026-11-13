// DETERMINISTICKÉ PROHLEDÁVÁNÍ parametrů bruslení K4 proti všem rubrikám najednou (2026-11-14).
// node scripts/k4_search.mjs [--grid=JSON] [--par=8] [--out=soubor.json]
// Každá kombinace → FH_K4 (Player.js ji načte do SKATE_K4 jen v Node) → spustí měřicí skripty jako podprocesy:
//   leg_flap_metrics (F1 rozkmit ≤ 9 px), skate_anim_metrics (R1–R11), body_unity_metrics (N1–N4), skate_stop_metrics (S1–S5),
//   hip_pants_metrics (V1/V2). Kombinace „projde", když projdou VŠECHNY kontroly K4. Řazení: počet splněných, pak menší rozkmit.
import { execFile } from 'child_process';
import { writeFileSync } from 'fs';
const ARG = Object.fromEntries(process.argv.slice(2).map(a => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.length ? v.join('=') : true]; }));
const GRID = ARG.grid ? JSON.parse(ARG.grid) : {
  back: [0.8, 0.95, 1.1], hold: [0.62, 0.68], latW: [0.35, 0.51], glide: [0.15, 0.3], cx: [0, 0.15], ampK: [0.8, 0.9, 1], hip: [0.7, 1.0],
};
const PAR = +(ARG.par || 8);
const combos = Object.entries(GRID).reduce((acc, [k, vs]) => acc.flatMap(c => vs.map(v => ({ ...c, [k]: v }))), [{}]);
const run = (script, args, env) => new Promise(res => execFile(process.execPath, [script, ...args], { env: { ...process.env, ...env }, maxBuffer: 1 << 22 }, (e, so) => res(String(so || ''))));
async function evalCombo(c) {
  const env = { FH_K4: JSON.stringify(c) };
  const [flap, anim, uni, stop, hip] = await Promise.all([
    run('scripts/leg_flap_metrics.mjs', ['--k=4'], env), run('scripts/skate_anim_metrics.mjs', ['--k=4'], env),
    run('scripts/body_unity_metrics.mjs', ['--k=4'], env), run('scripts/skate_stop_metrics.mjs', [], env), run('scripts/hip_pants_metrics.mjs', [], env)]);
  const f1 = +(flap.match(/max ([\d.]+) px/) || [0, 99])[1];
  const frac = (txt, re) => { const m = txt.match(re); return m ? [+m[1], +m[2]] : [0, 1]; };
  const a = frac(anim, /== K4\s*—\s*(\d+)\/(\d+)/), u = frac(uni, /== K4 — (\d+)\/(\d+)/), s = frac(stop, /== K4 obrat — (\d+)\/(\d+)/);
  const hl = hip.split('\n').filter(l => /V[12]/.test(l)); const h = [hl.filter(l => /^\s*OK/.test(l)).length, hl.length || 1];
  const fails = [...anim.split('\n'), ...uni.split('\n')].filter(l => /^\s*NE /.test(l)).map(l => l.trim().slice(3, 18).trim());
  const okN = (f1 <= 9) + a[0] + u[0] + s[0] + h[0], totN = 1 + a[1] + u[1] + s[1] + h[1];
  return { c, f1, anim: a.join('/'), uni: u.join('/'), stop: s.join('/'), hip: h.join('/'), okN, totN, pass: okN === totN, fails };
}
const t0 = Date.now(), res = []; let i = 0;
await Promise.all(Array.from({ length: PAR }, async () => { while (i < combos.length) { const c = combos[i++]; res.push(await evalCombo(c)); } }));
res.sort((x, y) => (y.okN - x.okN) || (x.f1 - y.f1) || JSON.stringify(x.c).localeCompare(JSON.stringify(y.c)));
const pass = res.filter(r => r.pass);
console.log(`kombinací ${combos.length}, prošlo všechno ${pass.length}, čas ${((Date.now() - t0) / 1000).toFixed(0)} s`);
for (const r of res.slice(0, 8)) console.log(`${r.pass ? 'PROŠLO' : `${r.okN}/${r.totN}`} F1 ${r.f1} anim ${r.anim} uni ${r.uni} stop ${r.stop} hip ${r.hip} ${JSON.stringify(r.c)} ${r.fails.join(',')}`);
if (ARG.out) writeFileSync(ARG.out, JSON.stringify(res, null, 1));
