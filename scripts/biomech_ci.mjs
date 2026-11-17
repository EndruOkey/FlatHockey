// CI: audit pohybu těla pro obě varianty (hráči VIS.w 0, /dev VIS.w 1) s rozpočtem = stav 2026-11-17. Zlepšení → rozpočet snížit.
import { execFileSync } from 'child_process';
const RUNS = [['w0', 816], ['w1', 0]];   // 2026-11-17: + A13 (obě nohy za tělem); hráči bokem opraveno (shX): 815 − 0 + A10 couvání 1 = 816
let fail = 0;
for (const [v, n] of RUNS) {
  try { const o = execFileSync(process.execPath, ['scripts/biomech_audit.mjs', `--budget=${n}`], { env: { ...process.env, FH_VIS: v }, encoding: 'utf8' }); console.log(`${v}: ${o.trim().split('\n').pop()}`); }
  catch (e) { fail++; console.log(`${v}: ${String(e.stdout || '').trim().split('\n').slice(-3).join(' | ')}`); }
}
console.log(fail ? 'NEPROŠLO' : 'VŠE OK'); process.exit(fail ? 1 : 0);
