// ŠATNA v3 (2026-11-17, Ondřej: „předělat šatnu — bordel, postava moc místa, přebarvování nikdo nevyužije").
// Rozbor: ve hře shora je vidět dres 43 %, helma 16 %, páska 11 %, rukavice 10 %; kalhoty 1 %, tkaničky 0,3 % (měřeno rendererem)
// → hotové sady + editor vlastní sady (jen viditelné části), velikost (herní volba), profil (banner, profilovka, titul).
// Vrstva nad stávajícím stavem: zapisuje do původních ovládacích prvků (api.*) → uložení, profil i server beze změny.
// Banner / profilovka / titul / vlastní sady zatím jen v prohlížeči (localStorage 'fh_lk3'); na server až s profilem v žebříčku.
import { Player } from './entities/Player.js';
import { PLAYER, PUCK, SIZES } from './constants.js';

const KITS = [   // [název cs, en, dres, pruh+helma, rukavice+kalhoty] — jen barvy z PALETTE (jinak je swatch.set ignoruje)
  ['Klasik', 'Classic', '#1b4fd1', '#f4f7fb', '#1a1f29'], ['Oheň', 'Fire', '#ff4455', '#1a1f29', '#1a1f29'], ['Noc', 'Night', '#1a1f29', '#ffcf3a', '#1a1f29'],
  ['Led', 'Ice', '#f4f7fb', '#1b4fd1', '#1b4fd1'], ['Les', 'Forest', '#0c7a4a', '#f4f7fb', '#1a1f29'], ['Švestka', 'Plum', '#9b5cff', '#f4f7fb', '#1a1f29'],
  ['Slunce', 'Sun', '#ff8a1e', '#1a1f29', '#1a1f29'], ['Retro', 'Retro', '#b81d3a', '#f4f7fb', '#1b4fd1']];
const HELMS = [['visor', 'Kšilt', 'Visor'], ['cage', 'Mřížka', 'Cage'], ['shield', 'Plexi', 'Shield'], ['none', 'Bez', 'None']];
const PIPS = [[4, 5, 2, 1], [3, 3, 3, 3], [2, 1, 4, 5]];
const BANNERS = [
  { id: 'ice', cs: 'Led', en: 'Ice', bg: 'linear-gradient(120deg,#cfe7f2,#7fb6d9 60%,#2c5d8c)' },
  { id: 'bolt', cs: 'Blesk', en: 'Bolt', bg: 'repeating-linear-gradient(115deg,#1b4fd1 0 18px,#3a9fff 18px 22px)' },
  { id: 'night', cs: 'Noc', en: 'Night', bg: 'radial-gradient(circle at 85% 25%,#ffcf3a 0 5px,transparent 6px),linear-gradient(160deg,#141b31,#050811)' },
  { id: 'retro', cs: 'Retro', en: 'Retro', bg: 'repeating-linear-gradient(90deg,#b81d3a 0 14px,#f4f7fb 14px 20px,#1b4fd1 20px 34px)' },
  { id: 'gun', cs: 'Kanonýr', en: 'Sniper', bg: 'linear-gradient(120deg,#ff4455,#1a1f29)', need: s => (s.goals ?? 0) >= 100, how: ['100 gólů', '100 goals'] },
  { id: 'vet', cs: 'Veterán', en: 'Veteran', bg: 'linear-gradient(120deg,#e2b25a,#7a5015)', need: s => (s.games_played ?? 0) >= 100, how: ['100 zápasů', '100 games'] }];
const TITLES = [   // odemčení jen ze statistik, které server už vede (stats: goals, assists, saves, games_played, wins)
  { id: 'rookie', cs: 'Nováček', en: 'Rookie', need: () => true },
  { id: 'scorer', cs: 'Střelec', en: 'Scorer', need: s => (s.goals ?? 0) >= 25, how: ['25 gólů', '25 goals'] },
  { id: 'setup', cs: 'Nahrávač', en: 'Playmaker', need: s => (s.assists ?? 0) >= 25, how: ['25 asistencí', '25 assists'] },
  { id: 'winner', cs: 'Vítěz', en: 'Winner', need: s => (s.wins ?? 0) >= 25, how: ['25 výher', '25 wins'] },
  { id: 'vet', cs: 'Veterán', en: 'Veteran', need: s => (s.games_played ?? 0) >= 50, how: ['50 zápasů', '50 games'] },
  { id: 'gun', cs: 'Kanonýr', en: 'Sniper', need: s => (s.goals ?? 0) >= 100, how: ['100 gólů', '100 goals'] }];
const CS = { tabs: ['Výbava', 'Vzhled', 'Profil'], eyebrow: 'Šatna', title: 'Tvůj hráč', sub: 'Výbava mění hru (vyvážené), vzhled a profil jsou pro radost',
  size: 'Velikost', sizes: ['Malý', 'Střední', 'Velký'], roles: ['Rychlík', 'Univerzál', 'Tank'], num: 'Číslo', grip: 'Držení', name: 'Jméno',
  st: ['Rychlost', 'Obratnost', 'Rána', 'Souboj'], kits: 'Hotové sady — jedním kliknutím, vždy ladí', helm: 'Helma', mine: 'Moje sady', create: '+ vytvořit',
  edit: 'Vytvoř si vzhled', parts: ['Dres', 'Pruh a helma', 'Rukavice a kalhoty', 'Hokejka', 'Páska'], save: 'Uložit sadu', rnd: 'Náhodně', close: 'Zavřít',
  editNote: 'Ve hře shora je nejvíc vidět dres, helma, páska a rukavice — kalhoty a tkaničky skoro vůbec, proto jdou s rukavicemi.',
  banner: 'Banner', avatar: 'Profilovka', avs: ['Hráč', 'Číslo', 'Discord'], ttl: 'Titul', locked: 'Získáš za', lbPrev: 'Takhle tě uvidí ostatní v žebříčku',
  guest: 'Vlastní vzhled je pro hráče s účtem — velikost a profil můžeš měnit i jako host.', stats: ['Góly', 'Asist.', '+/−', 'Výhry'], hand: ['L', 'R'],
  unlocked: 'odemčeno' };
const EN = { tabs: ['Gear', 'Look', 'Profile'], eyebrow: 'Locker room', title: 'Your player', sub: 'Gear changes play (balanced); look and profile are just for fun',
  size: 'Size', sizes: ['Small', 'Medium', 'Big'], roles: ['Speedster', 'All-rounder', 'Tank'], num: 'Number', grip: 'Grip', name: 'Name',
  st: ['Speed', 'Agility', 'Shot', 'Checking'], kits: 'Ready-made kits — one click, always match', helm: 'Helmet', mine: 'My kits', create: '+ create',
  edit: 'Make your look', parts: ['Jersey', 'Stripe & helmet', 'Gloves & pants', 'Stick', 'Tape'], save: 'Save kit', rnd: 'Random', close: 'Close',
  editNote: 'From above you mostly see the jersey, helmet, tape and gloves — pants and laces barely, so they go with the gloves.',
  banner: 'Banner', avatar: 'Avatar', avs: ['Player', 'Number', 'Discord'], ttl: 'Title', locked: 'Unlock with', lbPrev: 'This is how others see you on the leaderboard',
  guest: 'Custom looks are for players with an account — size and profile work for guests too.', stats: ['Goals', 'Assists', '+/−', 'Wins'], hand: ['L', 'R'],
  unlocked: 'unlocked' };
const STORE = 'fh_lk3';
const load = () => { try { return JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch { return {}; } };
const save = o => { try { localStorage.setItem(STORE, JSON.stringify(o)); } catch {} };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const CSS = `
#lk3{position:absolute;inset:0;overflow:auto;padding:84px 48px 28px;color:#e8ecf8;font-family:Barlow,system-ui,sans-serif;z-index:2}
#lk3 *{box-sizing:border-box}#lk3 button{font:inherit;color:inherit;cursor:pointer}
#lk3 .g{display:grid;grid-template-columns:380px minmax(0,1fr);gap:28px;max-width:1280px;margin:0 auto}
#lk3 .k{font:600 11px/1 'JetBrains Mono',monospace;letter-spacing:.14em;text-transform:uppercase;color:#c9a6d8}
#lk3 .k2{font:600 10px/1.35 'JetBrains Mono',monospace;letter-spacing:.06em;color:#8b93b5}
#lk3 .h{font:italic 900 46px/.9 'Barlow Condensed',sans-serif;text-transform:uppercase}
#lk3 .pnl{background:rgba(21,27,46,.92);border:1px solid rgba(182,196,255,.12);border-radius:8px;padding:14px 16px}
#lk3 .card{align-self:start;position:relative;overflow:hidden;padding:18px;border-radius:12px;background:linear-gradient(160deg,#1d2a4d,#111729 70%);border:2px solid rgba(58,159,255,.45)}
#lk3 .cban{position:absolute;left:0;right:0;top:0;height:64px;opacity:.9}
#lk3 .chip{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border-radius:999px;background:#3a9fff;color:#fff;font:italic 800 14px/1 'Barlow Condensed';letter-spacing:.06em;text-transform:uppercase}
#lk3 .ttl{font:italic 700 18px/1 'Barlow Condensed';color:#ffcf3a;letter-spacing:.04em;text-transform:uppercase}
#lk3 .pips{display:grid;grid-template-columns:78px 1fr 78px 1fr;column-gap:8px;row-gap:6px;align-items:center;font:600 10px/1 'JetBrains Mono';letter-spacing:.08em;color:#aeb6d6;text-transform:uppercase}
#lk3 .pips i{display:flex;gap:3px}#lk3 .pips i s{width:14px;height:6px;border-radius:2px;background:rgba(182,196,255,.15)}#lk3 .pips i s.f{background:#3a9fff}
#lk3 .st4{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}#lk3 .st4 div{padding:8px;background:rgba(10,14,30,.55);border-radius:6px}
#lk3 .st4 b{display:block;font:italic 900 26px/1 'Barlow Condensed'}#lk3 .st4 span{font:600 9px/1 'JetBrains Mono';letter-spacing:.1em;color:#8b93b5;text-transform:uppercase}
#lk3 .av{flex:none;width:52px;height:52px;border-radius:50%;overflow:hidden;background:#1b2440;border:2px solid rgba(182,196,255,.25);display:grid;place-items:center;font:italic 900 22px/1 'Barlow Condensed'}
#lk3 .av img,#lk3 .av svg{width:100%;height:100%;display:block;object-fit:cover}
#lk3 .tabs{display:flex;gap:4px;border-bottom:1px solid rgba(182,196,255,.14)}#lk3 .tabs button{background:none;border:0;padding:10px 18px;font:italic 800 17px/1 'Barlow Condensed';letter-spacing:.06em;text-transform:uppercase;color:#8b93b5;border-bottom:3px solid transparent}
#lk3 .tabs button[aria-selected=true]{color:#fff;border-color:#3a9fff}
#lk3 .seg{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:6px}#lk3 .seg button{padding:9px 0;border:1px solid rgba(182,196,255,.18);border-radius:4px;background:rgba(10,14,30,.4);font:italic 800 15px/1 'Barlow Condensed';letter-spacing:.06em;color:#aeb6d6;text-transform:uppercase}
#lk3 .seg button.on{background:#3a9fff;border-color:#3a9fff;color:#fff}
#lk3 .tiles{display:grid;gap:6px}#lk3 .tile{padding:4px 0 6px;border-radius:6px;background:rgba(10,14,30,.55);border:1px solid rgba(182,196,255,.1);text-align:center;font:600 10px/1 'JetBrains Mono';letter-spacing:.06em;color:#aeb6d6;text-transform:uppercase}
#lk3 .tile.on{border-color:#3a9fff;box-shadow:0 0 0 1px #3a9fff inset;color:#fff}#lk3 .tile canvas{display:block;margin:0 auto 2px;width:58px;height:50px}
#lk3 .tile:disabled{opacity:.45;cursor:not-allowed}
#lk3 .inp{width:100%;background:rgba(10,14,30,.55);border:1px solid rgba(182,196,255,.18);border-radius:4px;padding:8px 10px;font:italic 900 24px/1 'Barlow Condensed';text-transform:uppercase;color:#fff}
#lk3 .ban{height:56px;border-radius:6px;position:relative;overflow:hidden;border:1px solid rgba(182,196,255,.12);text-align:left;padding:0}
#lk3 .ban span{position:absolute;left:8px;bottom:6px;font:600 10px/1 'JetBrains Mono';letter-spacing:.08em;color:#fff;text-transform:uppercase;text-shadow:0 1px 2px #000}
#lk3 .ban.on{outline:2px solid #3a9fff;outline-offset:2px}#lk3 .ban:disabled{filter:grayscale(1) brightness(.55)}
#lk3 .lbrow{display:grid;grid-template-columns:52px 1fr auto;align-items:center;gap:12px;padding:10px 14px;border-radius:8px;position:relative;overflow:hidden}
#lk3 .note{padding:10px 12px;border-radius:6px;background:rgba(255,207,58,.08);border:1px solid rgba(255,207,58,.3);font:500 13px/1.3 Barlow;color:#ffe7a3}
#lk3 .mod{position:fixed;inset:0;z-index:50;background:rgba(5,8,16,.65);display:grid;place-items:center;padding:20px}
#lk3 .modc{width:min(980px,100%);background:#121829;border:1px solid rgba(58,159,255,.35);border-radius:10px;padding:20px;display:grid;grid-template-columns:330px minmax(0,1fr);gap:22px}
#lk3 .part{display:grid;grid-template-columns:150px minmax(0,1fr);gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid rgba(182,196,255,.08)}
#lk3 .part b{font:italic 800 15px/1 'Barlow Condensed';text-transform:uppercase}
#lk3 .sw{display:flex;gap:6px;flex-wrap:wrap}#lk3 .sw button{width:26px;height:26px;border-radius:4px;border:1px solid rgba(255,255,255,.18);padding:0}#lk3 .sw button.on{outline:2px solid #fff;outline-offset:2px}
#lk3 .btn{padding:11px 16px;border-radius:6px;background:#3a9fff;border:0;color:#fff;font:italic 800 16px/1 'Barlow Condensed';letter-spacing:.06em;text-transform:uppercase}
#lk3 .btn.o{background:transparent;border:1px solid rgba(182,196,255,.25);color:#d7dcf0}
#lk3 :focus-visible{outline:2px solid #fff;outline-offset:2px}
@media (max-width:900px){#lk3{padding:72px 16px 20px}#lk3 .g{grid-template-columns:1fr}#lk3 .modc{grid-template-columns:1fr}}
`;

export function initLocker3(host, api) {
  if (!host) return { show() {}, hide() {} };
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  const root = document.createElement('div'); root.id = 'lk3'; host.appendChild(root);
  let S = load(), tab = S.tab ?? 0, stats = {}, rank = null, raf = null, editor = null;
  S.slots = S.slots || [null, null, null];
  const L = () => (api.t('lk_p_size') === 'Size' ? EN : CS), en = () => L() === EN;
  const persist = () => save(S);
  const mkPlayer = (id, k, size) => { const p = new Player(id, 'home', null); p._dispReach = PLAYER.stickLen; p.charge = 0; p._dispCharge = 0; p.passReq = 0; p.crossCheck = false; p.name = ''; applyTo(p, k); p.size = size; return p; };
  const applyTo = (p, k) => { p.color = k.jersey; p.stripe = k.stripe; p.helmet = k.helmet; p.gloves = k.gloves; p.shorts = k.shorts; p.stick = k.stick; p.tape = k.tape; p.visor = k.visor; p.helmetType = k.helmetType; };
  const kitOf = i => { const K = KITS[i], c = api.get().kit; return { ...c, jersey: K[2], stripe: K[3], helmet: K[3], gloves: K[4], shorts: K[4] }; };
  const curKit = () => api.get().kit;
  const sameKit = (a, b) => ['jersey', 'stripe', 'helmet', 'gloves'].every(k => (a[k] || '').toLowerCase() === (b[k] || '').toLowerCase());

  function cardHTML() {
    const s = api.get(), l = L(), ban = BANNERS.find(b => b.id === S.banner) || BANNERS[1], ti = TITLES.find(x => x.id === S.title && x.need(stats)) || TITLES[0];
    const pips = l.st.map((n, i) => `<span>${n}</span><i>${[0, 1, 2, 3, 4].map(k => `<s class="${k < PIPS[s.size][i] ? 'f' : ''}"></s>`).join('')}</i>`).join('');
    const g = stats.games_played || 0, wp = g ? Math.round(100 * (stats.wins || 0) / g) + ' %' : '—', pm = stats.plus_minus ?? 0;
    const elo = rank?.rank_points ?? 1000, pos = rank?.position ? ' · #' + rank.position : '';
    return `<div class="card"><div class="cban" style="background:${ban.bg}"></div>
      <canvas id="lk3-hero" width="680" height="400" style="position:relative;width:340px;height:200px;display:block;margin:44px 0 12px;border-radius:8px;background:#dfeaf3"></canvas>
      <div style="display:flex;align-items:center;gap:12px">${avatarHTML()}<div class="h">${esc(s.name || '—')}</div><div class="h" style="color:#3a9fff">${esc(s.num ?? '')}</div></div>
      <div class="ttl" style="margin:8px 0 10px">„${en() ? ti.en : ti.cs}"</div>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px"><span class="chip">● ${l.sizes[s.size]} · ${l.roles[s.size]}</span><span class="k2">${s.hand === -1 ? 'L' : 'R'} · ELO ${elo}${pos}</span></div>
      <div class="pips">${pips}</div>
      <div class="st4" style="margin-top:12px"><div><b>${stats.goals ?? 0}</b><span>${l.stats[0]}</span></div><div><b>${stats.assists ?? 0}</b><span>${l.stats[1]}</span></div><div><b>${pm > 0 ? '+' + pm : pm}</b><span>${l.stats[2]}</span></div><div><b>${wp}</b><span>${l.stats[3]}</span></div></div></div>`;
  }
  function avatarHTML(big) {
    const s = api.get(), a = S.avatar || 'head', u = api.getUser?.();
    if (a === 'discord' && u?.avatar_url) return `<div class="av"${big ? ' style="width:46px;height:46px"' : ''}><img src="${esc(u.avatar_url)}" alt=""></div>`;
    if (a === 'num') return `<div class="av" style="background:${esc(s.kit.jersey)};color:${esc(s.kit.stripe)}">${esc(s.num ?? '#')}</div>`;
    return `<div class="av" data-head="1"></div>`;
  }
  function fillHeads() {   // profilovka = hlava postavy ze šatny (SVG #hero-stage, už obarvené podle výbavy)
    const svg = document.querySelector('#hero-stage svg');
    root.querySelectorAll('[data-head]').forEach(d => { if (!svg) { d.textContent = '🏒'; return; } const c = svg.cloneNode(true); c.removeAttribute('id'); c.setAttribute('viewBox', '232 10 380 380'); c.setAttribute('width', '100%'); c.setAttribute('height', '100%'); d.replaceChildren(c); });
  }
  function tabVybava() {
    const s = api.get(), l = L();
    return `<div class="pnl" style="display:grid;grid-template-columns:minmax(0,1.3fr) 90px 150px;gap:14px;align-items:end">
      <label><div class="k2" style="margin-bottom:6px">${l.name}</div><input class="inp" id="lk3-name" maxlength="14" value="${esc(s.name)}" ${api.isGuest() ? 'disabled' : ''}></label>
      <label><div class="k2" style="margin-bottom:6px">${l.num}</div><input class="inp" id="lk3-num" type="number" min="0" max="99" value="${esc(s.num ?? '')}" ${api.isGuest() ? 'disabled' : ''}></label>
      <div><div class="k2" style="margin-bottom:6px">${l.grip}</div><div class="seg">${[-1, 1].map((h, i) => `<button type="button" data-hand="${h}" class="${s.hand === h ? 'on' : ''}">${l.hand[i]}</button>`).join('')}</div></div></div>
     <div class="pnl"><div class="k2" style="margin-bottom:8px">${l.size}</div><div class="seg">${l.sizes.map((n, i) => `<button type="button" data-size="${i}" class="${s.size === i ? 'on' : ''}">${n}</button>`).join('')}</div>
      <div class="k2" style="margin-top:10px">${[en() ? 'Speedster — outskates and dangles, but bounces off in a hit.' : 'Rychlík — ujede, prokličkuje, ale v souboji odletí.', en() ? 'All-rounder — does it all, no weak spot.' : 'Univerzál — umí všechno, nic mu nechybí.', en() ? 'Tank — slower, but whoever gets hit stays down.' : 'Tank — pomalejší, ale koho trefí, ten leží.'][s.size]}</div></div>`;
  }
  function tabVzhled() {
    const l = L(), c = curKit(), g = api.isGuest();
    const kits = KITS.map((K, i) => `<button type="button" class="tile ${sameKit(c, kitOf(i)) ? 'on' : ''}" data-kit="${i}" ${g ? 'disabled' : ''}><canvas data-tk="${i}" width="116" height="100"></canvas>${en() ? K[1] : K[0]}</button>`).join('');
    const helms = HELMS.map(([v, cs, e]) => `<button type="button" class="tile ${c.helmetType === v ? 'on' : ''}" data-helm="${v}" ${g ? 'disabled' : ''} style="padding:10px 0">${en() ? e : cs}</button>`).join('');
    const slots = S.slots.map((k, i) => k ? `<button type="button" class="tile ${sameKit(c, k) ? 'on' : ''}" data-slot="${i}" ${g ? 'disabled' : ''}><canvas data-ts="${i}" width="116" height="100"></canvas>${en() ? 'Mine' : 'Moje'} #${i + 1}</button>`
      : `<button type="button" class="tile" data-new="${i}" ${g ? 'disabled' : ''} style="border-style:dashed;padding:20px 0">${l.create}</button>`).join('');
    return `${g ? `<div class="note">${l.guest}</div>` : ''}
     <div class="pnl"><div class="k2" style="margin-bottom:8px">${l.kits}</div><div class="tiles" style="grid-template-columns:repeat(8,minmax(0,1fr))">${kits}</div></div>
     <div class="pnl" style="display:grid;grid-template-columns:1fr 1.3fr;gap:16px"><div><div class="k2" style="margin-bottom:8px">${l.helm}</div><div class="tiles" style="grid-template-columns:repeat(4,minmax(0,1fr))">${helms}</div></div>
      <div><div class="k2" style="margin-bottom:8px">${l.mine}</div><div class="tiles" style="grid-template-columns:repeat(3,minmax(0,1fr))">${slots}</div></div></div>`;
  }
  function tabProfil() {
    const l = L(), u = api.getUser?.(), s = api.get(), ban = BANNERS.find(b => b.id === S.banner) || BANNERS[1], ti = TITLES.find(x => x.id === S.title && x.need(stats)) || TITLES[0];
    const bans = BANNERS.map(b => { const ok = !b.need || b.need(stats); return `<button type="button" class="ban ${b.id === ban.id ? 'on' : ''}" data-ban="${b.id}" style="background:${b.bg}" ${ok ? '' : 'disabled'} title="${ok ? '' : esc(l.locked + ' ' + b.how[en() ? 1 : 0])}"><span>${ok ? '' : '🔒 '}${en() ? b.en : b.cs}${ok ? '' : ' · ' + b.how[en() ? 1 : 0]}</span></button>`; }).join('');
    const avs = ['head', 'num', 'discord'].map((a, i) => `<button type="button" class="tile ${(S.avatar || 'head') === a ? 'on' : ''}" data-av="${a}" ${a === 'discord' && !u?.avatar_url ? 'disabled' : ''} style="padding:10px 0">${l.avs[i]}</button>`).join('');
    const tis = TITLES.map(x => { const ok = x.need(stats); return `<button type="button" class="tile ${x.id === ti.id ? 'on' : ''}" data-ttl="${x.id}" ${ok ? '' : 'disabled'} style="padding:10px 4px">${ok ? '' : '🔒 '}${en() ? x.en : x.cs}${ok ? '' : `<div class="k2" style="margin-top:4px">${x.how[en() ? 1 : 0]}</div>`}</button>`; }).join('');
    const nOk = BANNERS.filter(b => !b.need || b.need(stats)).length + TITLES.filter(x => x.need(stats)).length;
    return `<div class="pnl" style="display:grid;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr);gap:18px">
      <div><div style="display:flex;justify-content:space-between;margin-bottom:8px"><div class="k2">${l.banner}</div><div class="k2">${nOk} / ${BANNERS.length + TITLES.length} ${l.unlocked}</div></div><div class="tiles" style="grid-template-columns:repeat(3,minmax(0,1fr))">${bans}</div></div>
      <div><div class="k2" style="margin-bottom:8px">${l.avatar}</div><div class="tiles" style="grid-template-columns:repeat(3,minmax(0,1fr))">${avs}</div></div></div>
     <div class="pnl"><div class="k2" style="margin-bottom:8px">${l.ttl}</div><div class="tiles" style="grid-template-columns:repeat(6,minmax(0,1fr))">${tis}</div></div>
     <div><div class="k2" style="margin-bottom:6px">${l.lbPrev}</div><div class="lbrow" style="background:${ban.bg}"><div style="position:absolute;inset:0;background:linear-gradient(90deg,rgba(10,14,30,.2),rgba(10,14,30,.85) 40%)"></div>
      <div style="position:relative">${avatarHTML(true)}</div><div style="position:relative"><div class="h" style="font-size:26px">${esc(s.name || '—')} <span style="color:#3a9fff">${esc(s.num ?? '')}</span></div><div class="ttl" style="font-size:14px">„${en() ? ti.en : ti.cs}"</div></div>
      <b style="position:relative;font:italic 900 24px/1 'Barlow Condensed'">${rank?.rank_points ?? 1000}</b></div></div>`;
  }
  function editorHTML() {
    const l = L(), k = editor.kit, P = api.PALETTE, SP = api.STICK_PALETTE;
    const rows = [['jersey', P], ['stripe', P], ['gloves', P], ['stick', SP], ['tape', P]].map(([key, pal], i) =>
      `<div class="part"><b>${l.parts[i]}</b><div class="sw">${pal.map(c => `<button type="button" data-ek="${key}" data-ec="${c}" class="${(k[key] || '').toLowerCase() === c ? 'on' : ''}" style="background:${c}" aria-label="${c}"></button>`).join('')}</div></div>`).join('');
    return `<div class="mod" id="lk3-mod" role="dialog" aria-modal="true" aria-label="${l.edit}"><div class="modc">
      <div><div class="k" style="margin-bottom:8px">${l.mine} #${editor.slot + 1}</div><canvas id="lk3-ed" width="660" height="520" style="width:100%;aspect-ratio:660/520;display:block;border-radius:8px;background:#dfeaf3"></canvas><div class="k2" style="margin-top:10px">${l.editNote}</div></div>
      <div><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><div class="h" style="font-size:30px">${l.edit}</div><button type="button" class="btn o" data-eclose="1">${l.close}</button></div>${rows}
       <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px"><button type="button" class="btn" data-esave="1">${l.save}</button><button type="button" class="btn o" data-ernd="1">${l.rnd}</button></div></div></div></div>`;
  }
  function render() {
    const l = L();
    root.innerHTML = `<div class="g">${cardHTML()}<div style="display:grid;align-content:start;gap:12px;min-width:0">
      <div style="display:flex;align-items:end;justify-content:space-between;gap:12px"><div><div class="k" style="margin-bottom:6px">${l.eyebrow}</div><div class="h">${l.title}</div></div><div class="k2" style="text-align:right;max-width:280px">${l.sub}</div></div>
      <div class="tabs" role="tablist">${l.tabs.map((n, i) => `<button type="button" role="tab" aria-selected="${i === tab}" data-tab="${i}">${n}</button>`).join('')}</div>
      ${[tabVybava, tabVzhled, tabProfil][tab]()}</div></div>${editor ? editorHTML() : ''}`;
    fillHeads(); drawStatic();
  }
  function drawTile(c, k, S0 = 3.9) {
    const g = c.getContext('2d'), p = mkPlayer('lk3t', k, 1);
    for (let f = 0; f < 3; f++) { g.clearRect(0, 0, c.width, c.height); p.x = 500; p.y = 200; p.bodyAngle = p.skateAngle = -Math.PI / 2; p.vx = 0; p.vy = -60; p.aimAngle = p.carryAngle = p._stickDisp = -Math.PI / 2 + 0.6; p.num = api.get().num;
      try { p.draw(g, { scale: S0, ox: c.width / 2 - 500 * S0, oy: c.height * .58 - 200 * S0, dt: 1 / 60 }); } catch {} }
  }
  function drawStatic() {
    root.querySelectorAll('canvas[data-tk]').forEach(c => drawTile(c, kitOf(+c.dataset.tk)));
    root.querySelectorAll('canvas[data-ts]').forEach(c => drawTile(c, S.slots[+c.dataset.ts]));
  }
  const heroP = { p: null, a: 0 };
  function loop() {
    raf = requestAnimationFrame(loop);
    for (const [id, k, R] of [['lk3-hero', curKit(), 3], ['lk3-ed', editor?.kit, 0]]) {
      const c = document.getElementById(id); if (!c || !k) continue;
      const g = c.getContext('2d'), s = api.get();
      if (!c._p) c._p = mkPlayer(id, k, s.size);
      const p = c._p; applyTo(p, k); p.size = s.size; p.num = s.num; p.handed = s.hand;
      heroP.a += 0.012; const a = heroP.a, S0 = c.height / 46, hd = a + Math.PI / 2;
      g.fillStyle = '#dfeaf3'; g.fillRect(0, 0, c.width, c.height); g.strokeStyle = 'rgba(204,34,51,.45)'; g.lineWidth = c.width / 120; g.beginPath(); g.moveTo(c.width / 2, 0); g.lineTo(c.width / 2, c.height); g.stroke();
      g.strokeStyle = 'rgba(30,79,209,.35)'; g.beginPath(); g.arc(c.width / 2, c.height / 2, c.height * .3, 0, 7); g.stroke();
      p.x = 500 + Math.cos(a) * R; p.y = 200 + Math.sin(a) * R; p.bodyAngle = p.skateAngle = hd; p.vx = Math.cos(hd) * 110; p.vy = Math.sin(hd) * 110; p.aimAngle = p.carryAngle = p._stickDisp = hd + 0.5; p.hasPuck = true;
      const cam = { scale: S0, ox: c.width / 2 - 500 * S0, oy: c.height / 2 - 200 * S0, dt: 1 / 60 };
      try { p.draw(g, cam); const t = p.stickTip; g.fillStyle = '#111'; g.beginPath(); g.arc(cam.ox + t.x * S0, cam.oy + t.y * S0, PUCK.radius * S0, 0, 7); g.fill(); } catch {}
    }
  }
  root.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || b.disabled) return; const d = b.dataset;
    if (d.tab != null) { tab = +d.tab; S.tab = tab; persist(); }
    else if (d.hand != null) api.setHand(+d.hand);
    else if (d.size != null) api.setSize(+d.size);
    else if (d.kit != null) api.applyKit(kitOf(+d.kit));
    else if (d.helm != null) api.applyKit({ ...curKit(), helmetType: d.helm });
    else if (d.slot != null) { if (e.detail === 2 || e.altKey) { editor = { slot: +d.slot, kit: { ...S.slots[+d.slot] } }; } else api.applyKit({ ...curKit(), ...S.slots[+d.slot] }); }
    else if (d.new != null) editor = { slot: +d.new, kit: { ...curKit() } };
    else if (d.ek != null) { editor.kit[d.ek] = d.ec; if (d.ek === 'stripe') editor.kit.helmet = d.ec; if (d.ek === 'gloves') editor.kit.shorts = d.ec; }
    else if (d.ernd != null) { const P = api.PALETTE, r = () => P[Math.floor(Math.random() * P.length)]; const st = r(), gl = r(); Object.assign(editor.kit, { jersey: r(), stripe: st, helmet: st, gloves: gl, shorts: gl, tape: r(), stick: api.STICK_PALETTE[Math.floor(Math.random() * api.STICK_PALETTE.length)] }); }   // náhoda jen v UI (vzhled), ne v simulaci
    else if (d.esave != null) { S.slots[editor.slot] = { ...editor.kit }; persist(); api.applyKit({ ...curKit(), ...editor.kit }); editor = null; }
    else if (d.eclose != null) editor = null;
    else if (d.ban != null) { S.banner = d.ban; persist(); }
    else if (d.av != null) { S.avatar = d.av; persist(); }
    else if (d.ttl != null) { S.title = d.ttl; persist(); }
    else return;
    render();
  });
  root.addEventListener('dblclick', e => { const b = e.target.closest('button[data-slot]'); if (b && !b.disabled) { editor = { slot: +b.dataset.slot, kit: { ...S.slots[+b.dataset.slot] } }; render(); } });
  root.addEventListener('input', e => { if (e.target.id === 'lk3-name') api.setName(e.target.value); if (e.target.id === 'lk3-num') api.setNum(e.target.value); });
  root.addEventListener('change', e => { if (e.target.id === 'lk3-name' || e.target.id === 'lk3-num') render(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && editor) { editor = null; render(); } });
  return {
    async show() {
      render(); if (!raf) loop();
      try { const [s, r] = await Promise.all([api.loadServerStats(), api.loadRankAndCredits()]); stats = s || {}; rank = r || null; render(); } catch {}
    },
    hide() { if (raf) cancelAnimationFrame(raf); raf = null; },
    refresh: render,
  };
}
export const LOCKER3_KITS = KITS;
