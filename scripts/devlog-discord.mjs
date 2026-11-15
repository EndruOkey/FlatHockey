// Pošle nejnovější zápis devlogu na Discord jako embed (webhook). Bez závislostí, deterministické.
// Použití:
//   node scripts/devlog-discord.mjs --dry                 vypíše JSON zprávy, nic neposílá
//   node scripts/devlog-discord.mjs --since <git-sha>     pošle jen když je nejnovější zápis jiný než v <sha> (CI po nasazení)
//   node scripts/devlog-discord.mjs --force               pošle nejnovější zápis vždy
// Webhook: env DISCORD_WEBHOOK_URL (GitHub secret). Bez něj skript jen oznámí přeskočení a skončí s kódem 0.
// Pravidla: obrázek = náhled (clips/<k>.jpg) PRVNÍHO bodu s ukázkou v zápisu, jinak obal hry; z každé kategorie
// max. 4 body (+ „a další N"), popis max. 4000 znaků.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const SITE = 'https://flathockey.fun';
const FILE = 'public/devlog/index.html';
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const arg = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };

const strip = (h) => h.replace(/<span class="(new|clip-ic)"[^>]*>.*?<\/span>/g, '').replace(/<strong>(.*?)<\/strong>/g, '**$1**')
  .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

export function newest(html) {
  const art = html.match(/<article>([\s\S]*?)<\/article>/);
  if (!art) throw new Error('v devlogu není žádný <article>');
  const a = art[1];
  const time = a.match(/<time[^>]*data-do="([^"]+)"[^>]*>([\s\S]*?)<\/time>/);
  const title = strip(a.match(/<h2[^>]*>([\s\S]*?)<\/h2>/)[1]);
  const lead = strip(a.match(/<p>([\s\S]*?)<\/p>/)[1]);
  const cats = [...a.matchAll(/<section class="cat"[^>]*><h3[^>]*>([\s\S]*?)<\/h3><ul>([\s\S]*?)<\/ul><\/section>/g)]
    .map(m => ({ name: strip(m[1]), items: [...m[2].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map(x => strip(x[1])) }));
  const clip = a.match(/data-clip="([a-z0-9-]+)"/);
  return { id: time ? time[1] : title, date: time ? strip(time[2]) : '', title, lead, cats, image: clip ? `${SITE}/devlog/clips/${clip[1]}.jpg` : `${SITE}/release-cover.png` };
}

export function payload(e) {
  let desc = e.lead + '\n';
  for (const c of e.cats) {
    const shown = c.items.slice(0, 4).map(i => '• ' + i);
    if (c.items.length > 4) shown.push(`• …a další ${c.items.length - 4}`);
    desc += `\n**${c.name}**\n${shown.join('\n')}\n`;
  }
  desc += `\n[Celý devlog →](${SITE}/devlog/) · [Hrát FlatHockey](${SITE}/)`;
  if (desc.length > 4000) desc = desc.slice(0, 3990) + '…';
  return {
    username: 'FlatHockey',
    allowed_mentions: { parse: [] },
    embeds: [{ title: `Devlog: ${e.title}`, url: `${SITE}/devlog/`, description: desc, color: 0xE4002B,
               image: { url: e.image }, footer: { text: e.date } }],
  };
}

const cur = newest(readFileSync(FILE, 'utf8'));
const body = payload(cur);
if (flag('--dry')) { console.log(JSON.stringify(body, null, 2)); process.exit(0); }

const since = arg('--since');
if (!flag('--force')) {
  if (!since || /^0+$/.test(since)) { console.log('bez --since/--force: nic neposílám'); process.exit(0); }
  let prevId = null;
  try { prevId = newest(execFileSync('git', ['show', `${since}:${FILE}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).id; } catch { /* soubor dřív nebyl */ }
  if (prevId === cur.id) { console.log(`zápis ${cur.id} už byl v ${since.slice(0, 7)} → nic nového, neposílám`); process.exit(0); }
}
const url = process.env.DISCORD_WEBHOOK_URL;
if (!url) { console.log('DISCORD_WEBHOOK_URL není nastaven → přeskakuji'); process.exit(0); }
const r = await fetch(url + (url.includes('?') ? '&' : '?') + 'wait=true', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
if (!r.ok) { console.error(`Discord odmítl: ${r.status} ${await r.text()}`); process.exit(1); }
console.log(`odesláno: ${body.embeds[0].title} (${cur.id})`);
