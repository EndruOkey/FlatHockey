// Podklad pro nový zápis devlogu: vypíše změny pro hráče od data posledního zápisu.
// Použití: node scripts/devlog-draft.mjs [YYYY-MM-DD]   (bez data = den po nejnovějším data-do="…" v public/devlog/index.html; data-do = poslední den, který zápis pokrývá)
// Deterministické: stejný git stav = stejný výstup (pevné pořadí, pevný filtr).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const SKIP = /^(Merge |Revert|chore|debug|WIP|assets:|CI:|Dev:)|jen \/dev|do dev playground|Dev playground|Měřicí skripty|Skript ověření|Měření |Stav projektu|rtt_probe/i;

let since = process.argv[2];
if (!since) {
  const html = readFileSync(new URL('../public/devlog/index.html', import.meta.url), 'utf8');
  const dates = [...html.matchAll(/data-do="(\d{4}-\d{2}-\d{2})"/g)].map(m => m[1]).sort();
  const d = new Date(dates.at(-1) + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + 1);
  since = d.toISOString().slice(0, 10);
}
const out = execFileSync('git', ['log', 'origin/main', '--reverse', '--date=short', `--since=${since} 00:00`, '--format=%ad|%h|%s'], { encoding: 'utf8' });
const rows = out.split('\n').filter(Boolean).map(l => l.split('|'));
const keep = rows.filter(([, , s]) => !SKIP.test(s));
console.log(`Od ${since}: ${keep.length} změn pro hráče (vyřazeno ${rows.length - keep.length} interních)\n`);
for (const [d, h, s] of keep) console.log(`${d} ${h}  ${s}`);
