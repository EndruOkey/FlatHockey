// Kontrola textů menu podle pravidel v COPY.md. node scripts/copy_lint.mjs  (exit 1 = porušení)
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../public/js/i18n.js', import.meta.url), 'utf8');
const DICT = new Function(src.slice(src.indexOf('const DICT'), src.indexOf('\n};', src.indexOf('const DICT')) + 3) + '; return DICT;')();

// Položky menu: [label, sub, kicker, text, chips] — stejné klíče jako data-* v index.html (#v-main)
const MENU = [
  ['play', 'play_sub', 'm_k_play', 'm_t_play', 'm_c_play'],
  ['off_title', 'm_s_off', 'm_k_off', 'm_t_off', 'm_c_off'],
  ['browse_title', 'm_s_browse', 'm_k_browse', 'm_t_browse', 'm_c_browse'],
  ['create_title', 'm_s_create', 'm_k_create', 'm_t_create', 'm_c_create'],
  ['training', 'm_s_train', 'm_k_train', 'm_t_train', 'm_c_train'],
  ['tutorial', 'm_s_tut', 'm_k_tut', 'm_t_tut', 'm_c_tut'],
  ['nav_locker', 'm_s_locker', 'm_k_locker', 'm_t_locker', 'm_c_locker'],
  ['nav_stats', 'm_s_stats', 'm_k_stats', 'm_t_stats', 'm_c_stats'],
  ['nav_store', 'm_s_store', 'm_k_store', 'm_t_store', 'm_c_store'],
];
const LIMIT = { label: 16, sub: 24, kicker: 18, text: 95, chip: 18, chips: 3 };
const BANNED = /\b(offline|latenc\w*|síť\w*|network|sekání|lag|server\w*|bully)\b/i;
const EXTRA = ['splash_welcome_a', 'splash_welcome_b', 'splash_first_text', 'vm_eyebrow'];

const errs = [];
for (const lang of ['cs', 'en']) {
  const d = DICT[lang];
  const chk = (key, max, kind) => {
    const v = d[key];
    if (v == null) return errs.push(`${lang}.${key}: chybí`);
    if (max && v.length > max) errs.push(`${lang}.${key} (${kind}) ${v.length}/${max} znaků: „${v}“`);
    if (BANNED.test(v)) errs.push(`${lang}.${key}: zakázané slovo „${v.match(BANNED)[0]}“`);
  };
  for (const [l, s, k, t, c] of MENU) {
    chk(l, LIMIT.label, 'label'); chk(s, LIMIT.sub, 'sub'); chk(k, LIMIT.kicker, 'kicker'); chk(t, LIMIT.text, 'text'); chk(c, 0, 'chips');
    const chips = (d[c] || '').split('|');
    if (chips.length > LIMIT.chips) errs.push(`${lang}.${c}: ${chips.length} štítků (max ${LIMIT.chips})`);
    for (const ch of chips) if (ch.length > LIMIT.chip) errs.push(`${lang}.${c}: štítek „${ch}“ ${ch.length}/${LIMIT.chip}`);
  }
  for (const k of EXTRA) chk(k, 0, 'extra');
}
const ck = Object.keys(DICT.cs), ek = new Set(Object.keys(DICT.en));
const onlyCs = ck.filter(k => !ek.has(k)), onlyEn = [...ek].filter(k => !DICT.cs[k]);
const items = MENU.length * 5 * 2;
console.log(`texty menu: ${items} položek (CZ+EN) | porušení: ${errs.length} | klíče jen CZ: ${onlyCs.length} | jen EN: ${onlyEn.length}`);
for (const e of errs) console.log('  ✗ ' + e);
process.exit(errs.length ? 1 : 0);
