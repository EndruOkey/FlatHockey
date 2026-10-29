// Report anonymní metriky (read-only). Použití: npm run metrics  (DB_PATH=... pro jinou DB)
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const file = process.env.DB_PATH || path.join(__dirname, '..', 'flathockey.db');
const db = new Database(file, { readonly: true, fileMustExist: true });
const one = (sql, ...a) => db.prepare(sql).get(...a);
const all = (sql, ...a) => db.prepare(sql).all(...a);
const pct = (n, d) => d ? (100 * n / d).toFixed(1) + ' %' : 'n/a';
const DAY = 86400000;
const dnum = s => Date.parse(s + 'T00:00:00Z') / DAY;
const today = new Date().toISOString().slice(0, 10);

const players = one("SELECT COUNT(DISTINCT pid) n FROM metric_events WHERE type='visit'").n;
const started = one("SELECT COUNT(*) n FROM metric_events WHERE type='match_start'").n;
const ended = one("SELECT COUNT(*) n FROM metric_events WHERE type='match_end'").n;

// Retence: první návštěva = nejmenší den; kohorta = první návštěva před >=7 dny.
const first = new Map(), days = new Map();
for (const r of all("SELECT pid, day FROM metric_events WHERE type='visit' ORDER BY pid, day")) {
  if (!first.has(r.pid)) first.set(r.pid, r.day);
  (days.get(r.pid) || days.set(r.pid, []).get(r.pid)).push(dnum(r.day));
}
let cohort = 0, d1 = 0, d7 = 0;
for (const [pid, f] of [...first].sort()) {
  if (dnum(today) - dnum(f) < 7) continue;
  cohort++;
  const offs = days.get(pid).map(x => x - dnum(f));
  if (offs.includes(1)) d1++;
  if (offs.some(o => o >= 1 && o <= 7)) d7++;
}

console.log(`DB: ${file}`);
console.log(`Today (UTC): ${today}\n`);
console.log(`Unique players:     ${players}`);
console.log(`Matches started:    ${started}  (per human)`);
console.log(`Matches completed:  ${ended}  (per human)`);
console.log(`Return cohort (first visit >=7 d ago): ${cohort}`);
console.log(`D1 return:          ${d1}/${cohort} = ${pct(d1, cohort)}`);
console.log(`D7 return (days 1-7): ${d7}/${cohort} = ${pct(d7, cohort)}`);

console.log('\nBy source (first reported source per player):');
const src = all(`SELECT COALESCE(s.detail,'(none)') AS source, COUNT(*) AS players FROM
  (SELECT DISTINCT pid FROM metric_events WHERE type='visit') v
  LEFT JOIN (SELECT pid, detail FROM metric_events WHERE type='source' AND id IN
    (SELECT MIN(id) FROM metric_events WHERE type='source' GROUP BY pid)) s ON s.pid = v.pid
  GROUP BY 1 ORDER BY players DESC, source ASC`);
for (const r of src) console.log(`  ${r.source.padEnd(24)} ${r.players}`);

console.log('\nPer day (UTC):');
console.log('  day         visitors  started  completed');
for (const r of all(`SELECT day, SUM(type='visit') v, SUM(type='match_start') s, SUM(type='match_end') e
  FROM metric_events WHERE type IN ('visit','match_start','match_end') GROUP BY day ORDER BY day`))
  console.log(`  ${r.day}  ${String(r.v).padStart(8)}  ${String(r.s).padStart(7)}  ${String(r.e).padStart(9)}`);
console.log(`\nRule: >=300 started AND D7 >= 10 %: ${started >= 300 ? 'started OK' : 'started LOW'}`);
