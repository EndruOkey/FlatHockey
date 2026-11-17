// ŠATNA v3 (2026-11-17, Ondřej: „předělat šatnu — bordel, postava moc místa, přebarvování nikdo nevyužije").
// Rozbor: ve hře shora je vidět dres 43 %, helma 16 %, páska 11 %, rukavice 10 %; kalhoty 1 %, tkaničky 0,3 % (měřeno rendererem)
// → hotové sady + editor vlastní sady (jen viditelné části), velikost a hokejka (herní volby), profil (banner, profilovka, titul).
// v2 (Ondřej: „prázdné, chybí červený akcent, jen text, chybí hokejky"): vizuální jazyk UI v3 (css/ui3.css — tokeny --a3-*, seříznuté
// panely, Barlow Condensed), obrázky místo textu (velikost, hokejka, helma = skuteční hráči z rendereru), ikony, přes celou výšku.
// Vrstva nad stávajícím stavem: zapisuje do původních ovládacích prvků (api.*) → uložení, profil i server beze změny.
// Banner / profilovka / titul / vlastní sady zatím jen v prohlížeči (localStorage 'fh_lk3'); na server až s profilem v žebříčku.
import { Player } from './entities/Player.js';
import { PLAYER } from './constants.js';

const KITS = [   // [název cs, en, dres, pruh+helma, rukavice+kalhoty] — jen barvy z PALETTE (jinak je swatch.set ignoruje)
  ['Klasik', 'Classic', '#1b4fd1', '#f4f7fb', '#1a1f29'], ['Oheň', 'Fire', '#ff4455', '#1a1f29', '#1a1f29'], ['Noc', 'Night', '#1a1f29', '#ffcf3a', '#1a1f29'],
  ['Led', 'Ice', '#f4f7fb', '#1b4fd1', '#1b4fd1'], ['Les', 'Forest', '#0c7a4a', '#f4f7fb', '#1a1f29'], ['Švestka', 'Plum', '#9b5cff', '#f4f7fb', '#1a1f29'],
  ['Slunce', 'Sun', '#ff8a1e', '#1a1f29', '#1a1f29'], ['Retro', 'Retro', '#b81d3a', '#f4f7fb', '#1b4fd1']];
const HELMS = [['visor', 'Kšilt', 'Visor'], ['cage', 'Mřížka', 'Cage'], ['none', 'Bez', 'None']];   // plexi zrušeno (shora jako kšilt)
const PIPS = [[4, 5, 2, 1], [3, 3, 3, 3], [2, 1, 4, 5]];
// Hokejka — délka (rozbor zábavnosti 2026-11-17: jen délka, flex a zlomení ne). Dosah 15 / 16 / 17,4 = měřené bezpečné pásmo 15–18
// (test/balance.mjs FH_STICK 15 i 18 v rubrice). Mechanika: constants.js STICKS (až bude), zatím volba v profilu.
const STICKS = [{ cs: 'Krátká', en: 'Short', reach: 15, eff: [['turn', +1], ['reach', -1]] }, { cs: 'Střední', en: 'Medium', reach: 16, eff: [] },
  { cs: 'Dlouhá', en: 'Long', reach: 17.4, eff: [['turn', -1], ['reach', +1]] }];
const BANNERS = [
  { id: 'ice', cs: 'Led', en: 'Ice', bg: 'linear-gradient(120deg,#cfe7f2,#7fb6d9 60%,#2c5d8c)' },
  { id: 'bolt', cs: 'Blesk', en: 'Bolt', bg: 'repeating-linear-gradient(115deg,#1b4fd1 0 18px,#3a9fff 18px 22px)' },
  { id: 'night', cs: 'Noc', en: 'Night', bg: 'radial-gradient(circle at 85% 25%,#ffcf3a 0 5px,transparent 6px),linear-gradient(160deg,#141b31,#050811)' },
  { id: 'red', cs: 'Derby', en: 'Derby', bg: 'repeating-linear-gradient(115deg,#E4002B 0 18px,#A8001F 18px 26px)' },
  { id: 'retro', cs: 'Retro', en: 'Retro', bg: 'repeating-linear-gradient(90deg,#b81d3a 0 14px,#f4f7fb 14px 20px,#1b4fd1 20px 34px)' },
  { id: 'gun', cs: 'Kanonýr', en: 'Sniper', bg: 'linear-gradient(120deg,#ff4455,#1a1f29)', need: s => (s.goals ?? 0) >= 100, how: ['100 gólů', '100 goals'] },
  { id: 'vet', cs: 'Veterán', en: 'Veteran', bg: 'linear-gradient(120deg,#FFB020,#7a5015)', need: s => (s.games_played ?? 0) >= 100, how: ['100 zápasů', '100 games'] },
  { id: 'ace', cs: 'Eso', en: 'Ace', bg: 'radial-gradient(circle at 30% 50%,#7FD4FF 0 10%,transparent 11%),linear-gradient(120deg,#0b2a4a,#050A14)', need: s => (s.wins ?? 0) >= 50, how: ['50 výher', '50 wins'] }];
const TITLES = [   // odemčení jen ze statistik, které server už vede (stats: goals, assists, saves, games_played, wins)
  { id: 'rookie', cs: 'Nováček', en: 'Rookie', ic: 'star', need: () => true },
  { id: 'scorer', cs: 'Střelec', en: 'Scorer', ic: 'puck', need: s => (s.goals ?? 0) >= 25, how: ['25 gólů', '25 goals'] },
  { id: 'setup', cs: 'Nahrávač', en: 'Playmaker', ic: 'pass', need: s => (s.assists ?? 0) >= 25, how: ['25 asistencí', '25 assists'] },
  { id: 'winner', cs: 'Vítěz', en: 'Winner', ic: 'trophy', need: s => (s.wins ?? 0) >= 25, how: ['25 výher', '25 wins'] },
  { id: 'vet', cs: 'Veterán', en: 'Veteran', ic: 'clock', need: s => (s.games_played ?? 0) >= 50, how: ['50 zápasů', '50 games'] },
  { id: 'gun', cs: 'Kanonýr', en: 'Sniper', ic: 'target', need: s => (s.goals ?? 0) >= 100, how: ['100 gólů', '100 goals'] }];
// Ikony (24×24, tah 2, currentColor) — jedna sada pro celou šatnu
const IC = {
  gear: '<path d="M4 20 15 9"/><path d="m15 9 3-6 2 1-2 6"/><path d="M4 20h5"/>',
  shirt: '<path d="m8 3-5 3 2 5 3-1v11h8V10l3 1 2-5-5-3a4 4 0 0 1-8 0Z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  size: '<circle cx="6" cy="16" r="3"/><circle cx="16" cy="12" r="6"/>',
  stick: '<path d="M14 3 7 17"/><path d="M7 17c-1 2 0 4 3 4h8"/>',
  helmet: '<path d="M4 15a8 8 0 0 1 16 0v2H4Z"/><path d="M14 15V9"/><path d="M20 17h-6"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.5 0 2-1 2-2s-1-1.5-1-2.5 1-1.5 2-1.5h2a4 4 0 0 0 4-4c0-4.5-4-8-9-8Z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4h12l-2 4 2 4H5"/>', star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0Z"/><path d="M8 6H4a4 4 0 0 0 4 4M16 6h4a4 4 0 0 1-4 4"/><path d="M12 13v4M8 21h8"/>',
  puck: '<ellipse cx="12" cy="10" rx="8" ry="3.5"/><path d="M4 10v4c0 2 3.6 3.5 8 3.5s8-1.5 8-3.5v-4"/>', pass: '<path d="M4 17 20 7"/><path d="m14 7h6v6"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  plusminus: '<path d="M5 8h6M8 5v6M13 16h6"/><path d="m16 4-8 16"/>', lock: '<rect x="5" y="11" width="14" height="10" rx="1"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  turn: '<path d="M4 12a8 8 0 1 1 3 6"/><path d="M4 18v-6h6"/>', reach: '<path d="M3 12h18"/><path d="m7 8-4 4 4 4M17 8l4 4-4 4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', back: '<path d="m15 5-7 7 7 7"/>', hash: '<path d="M9 3 7 21M17 3l-2 18M4 9h17M3 15h17"/>',
  hand: '<path d="M8 11V5a2 2 0 0 1 4 0v5M12 10V4a2 2 0 0 1 4 0v7M16 9a2 2 0 0 1 4 0v5a7 7 0 0 1-14 0v-3a2 2 0 0 1 4 0"/>',
  dice: '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1.2"/><circle cx="15" cy="15" r="1.2"/><circle cx="15" cy="9" r="1.2"/><circle cx="9" cy="15" r="1.2"/>',
};
const ic = (n, s = 20) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[n] || ''}</svg>`;
const CS = { tabs: ['Výbava', 'Vzhled', 'Profil'], tabIc: ['gear', 'shirt', 'user'], eyebrow: 'Šatna', back: 'Menu',
  size: 'Velikost', sizes: ['Malý', 'Střední', 'Velký'], roles: ['Rychlík', 'Univerzál', 'Tank'], num: 'Číslo', grip: 'Držení', name: 'Jméno', stick: 'Hokejka',
  st: ['Rychlost', 'Obratnost', 'Rána', 'Souboj'], kits: 'Hotové sady', helm: 'Helma', mine: 'Moje sady', create: 'Vytvořit',
  edit: 'Vytvoř si vzhled', parts: ['Dres', 'Pruh a helma', 'Rukavice a kalhoty', 'Hokejka', 'Páska'], save: 'Uložit sadu', rnd: 'Náhodně', close: 'Zavřít',
  banner: 'Banner', avatar: 'Profilovka', avs: ['Hráč', 'Číslo', 'Discord'], ttl: 'Titul', lbPrev: 'V žebříčku',
  guest: 'Vlastní vzhled je pro hráče s účtem.', stats: ['Góly', 'Asist.', '+/−', 'Výhry'], hand: ['L', 'R'], eff: { turn: 'otáčení', reach: 'dosah' }, soon: 've hře brzy' };
const EN = { tabs: ['Gear', 'Look', 'Profile'], tabIc: ['gear', 'shirt', 'user'], eyebrow: 'Locker room', back: 'Menu',
  size: 'Size', sizes: ['Small', 'Medium', 'Big'], roles: ['Speedster', 'All-rounder', 'Tank'], num: 'Number', grip: 'Grip', name: 'Name', stick: 'Stick',
  st: ['Speed', 'Agility', 'Shot', 'Checking'], kits: 'Ready-made kits', helm: 'Helmet', mine: 'My kits', create: 'Create',
  edit: 'Make your look', parts: ['Jersey', 'Stripe & helmet', 'Gloves & pants', 'Stick', 'Tape'], save: 'Save kit', rnd: 'Random', close: 'Close',
  banner: 'Banner', avatar: 'Avatar', avs: ['Player', 'Number', 'Discord'], ttl: 'Title', lbPrev: 'On the leaderboard',
  guest: 'Custom looks are for players with an account.', stats: ['Goals', 'Assists', '+/−', 'Wins'], hand: ['L', 'R'], eff: { turn: 'turning', reach: 'reach' }, soon: 'in game soon' };
const STORE = 'fh_lk3';
const load = () => { try { return JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch { return {}; } };
const save = o => { try { localStorage.setItem(STORE, JSON.stringify(o)); } catch {} };
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const CSS = `
#lk3{position:absolute;inset:0;padding:clamp(8px,2vh,24px) var(--a3-gut,48px) clamp(12px,2.5vh,28px);color:var(--a3-text,#F2F6FB);font-family:Barlow,system-ui,sans-serif;z-index:2;overflow:auto}
#lk3 *{box-sizing:border-box}#lk3 button{font:inherit;color:inherit;cursor:pointer;margin:0;width:auto;height:auto;text-transform:none;letter-spacing:normal;box-shadow:none;filter:none}
#lk3 .g{display:grid;grid-template-columns:clamp(340px,27vw,500px) minmax(0,1fr);gap:clamp(16px,2vw,32px);height:100%;min-height:600px}
#lk3 .c3{font-family:'Barlow Condensed',sans-serif;font-style:italic;font-weight:800;text-transform:uppercase}
#lk3 .k{font:italic 800 14px/1 'Barlow Condensed',sans-serif;letter-spacing:.14em;text-transform:uppercase;color:var(--a3-ice,#7FD4FF);display:flex;align-items:center;gap:8px}
#lk3 .m{color:var(--a3-mute,#A9BBD1);font:500 13px/1.3 Barlow}
#lk3 .pnl{background:var(--a3-glass,rgba(8,16,30,.72));border:1px solid var(--a3-line,rgba(255,255,255,.14));clip-path:var(--a3-cut-panel);padding:clamp(12px,1.6vh,18px) clamp(14px,1.4vw,22px)}
#lk3 .card{position:relative;display:flex;flex-direction:column;overflow:hidden;background:linear-gradient(180deg,rgba(5,10,20,0) 0,rgba(5,10,20,.35) 22%,rgba(5,10,20,.82) 52%,rgba(5,10,20,.94) 100%),var(--ban,#13203d);border:1px solid var(--a3-line);clip-path:var(--a3-cut-panel);min-height:0}
#lk3 .card::after{content:'';position:absolute;inset:0;pointer-events:none;background:var(--ban);opacity:.18;mix-blend-mode:screen;-webkit-mask:linear-gradient(90deg,#000 0,transparent 18%,transparent 82%,#000 100%);mask:linear-gradient(90deg,#000 0,transparent 18%,transparent 82%,#000 100%)}   /* banner prosvítá po stranách celé karty */
#lk3 .card::before{content:'';position:absolute;left:0;top:0;bottom:0;width:6px;background:linear-gradient(var(--a3-red,#E4002B),var(--a3-red2,#A8001F));z-index:2}
#lk3 .cban{height:clamp(40px,6vh,70px);flex:none}
#lk3 .chero{position:relative;z-index:1;flex:1 1 auto;min-height:150px;max-height:40vh;margin:0 18px 0 24px;box-shadow:0 0 0 1px rgba(255,255,255,.18);background:#dfeaf3;clip-path:polygon(0 0,100% 0,100% calc(100% - 18px),calc(100% - 18px) 100%,0 100%)}
#lk3 .chero canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
#lk3 .cnum{position:absolute;right:12px;bottom:6px;font:italic 900 clamp(48px,7vh,84px)/1 'Barlow Condensed';color:rgba(10,20,40,.13)}
#lk3 .cbody{position:relative;z-index:1;padding:14px 18px 18px 24px;display:grid;gap:10px;flex:none}
#lk3 .name{font:italic 900 clamp(34px,4.2vh,52px)/.9 'Barlow Condensed';text-transform:uppercase;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#lk3 .ttl{font:italic 800 18px/1 'Barlow Condensed';color:var(--a3-amber,#FFB020);letter-spacing:.06em;text-transform:uppercase;display:flex;align-items:center;gap:6px}
#lk3 .chip{display:inline-flex;align-items:center;gap:6px;padding:5px 12px 5px 10px;background:var(--a3-red);color:#fff;font:italic 800 15px/1 'Barlow Condensed';letter-spacing:.06em;text-transform:uppercase;clip-path:var(--a3-cut)}
#lk3 .pips{display:grid;grid-template-columns:auto 1fr auto 1fr;column-gap:10px;row-gap:7px;align-items:center;font:italic 700 13px/1 'Barlow Condensed';letter-spacing:.08em;color:var(--a3-mute2,#C3D2E6);text-transform:uppercase}
#lk3 .pips i{display:flex;gap:3px}#lk3 .pips i s{flex:1;max-width:18px;height:7px;background:rgba(255,255,255,.12);transform:skewX(-18deg)}#lk3 .pips i s.f{background:var(--a3-ice)}
#lk3 .st4{display:grid;grid-template-columns:repeat(4,1fr);gap:6px}#lk3 .st4 div{padding:8px 8px 7px;background:rgba(255,255,255,.04);border-top:2px solid rgba(255,255,255,.1)}
#lk3 .st4 div:first-child{border-top-color:var(--a3-red)}
#lk3 .st4 b{display:flex;align-items:center;gap:5px;font:italic 900 clamp(22px,3vh,30px)/1 'Barlow Condensed'}#lk3 .st4 b svg{color:var(--a3-mute)}#lk3 .st4 span{font:italic 700 12px/1 'Barlow Condensed';letter-spacing:.1em;color:var(--a3-mute);text-transform:uppercase}
#lk3 .av{flex:none;width:52px;height:52px;border-radius:50%;overflow:hidden;background:#13203d;border:2px solid var(--a3-red);display:grid;place-items:center;font:italic 900 22px/1 'Barlow Condensed'}
#lk3 .av img,#lk3 .av svg{width:100%;height:100%;display:block;object-fit:cover}
#lk3 .right{display:flex;flex-direction:column;gap:clamp(8px,1.2vh,14px);min-width:0;min-height:0}
#lk3 .top{display:flex;align-items:center;gap:14px}
#lk3 .backb{display:inline-flex;align-items:center;gap:6px;padding:8px 16px 8px 10px;background:var(--a3-glass);border:1px solid var(--a3-line);font:italic 800 17px/1 'Barlow Condensed';letter-spacing:.06em;text-transform:uppercase;clip-path:var(--a3-cut)}
#lk3 .backb kbd{font-size:11px;min-width:0;padding:1px 5px;margin-left:4px}
#lk3 .h1{font:italic 900 clamp(40px,6vh,64px)/.9 'Barlow Condensed';text-transform:uppercase}
#lk3 .tabs{display:flex;gap:6px}
#lk3 .tabs button{display:flex;align-items:center;gap:8px;background:var(--a3-glass);border:1px solid var(--a3-line);padding:12px 22px 12px 16px;font:italic 800 19px/1 'Barlow Condensed';letter-spacing:.06em;text-transform:uppercase;color:var(--a3-mute);clip-path:var(--a3-cut)}
#lk3 .tabs button[aria-selected=true]{background:var(--a3-red);border-color:var(--a3-red);color:#fff}
#lk3 .body{display:grid;gap:clamp(8px,1.2vh,14px);align-content:start;flex:1;min-height:0}
#lk3 .tiles{display:grid;gap:8px}
#lk3 .tile{position:relative;padding:6px 6px 8px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);text-align:center;font:italic 800 15px/1 'Barlow Condensed';letter-spacing:.06em;color:var(--a3-mute2);text-transform:uppercase;clip-path:var(--a3-cut)}
#lk3 .tile:hover:not(:disabled){border-color:rgba(255,255,255,.35);color:#fff}
#lk3 .tile.on{border-color:var(--a3-red);background:rgba(228,0,43,.14);color:#fff;box-shadow:inset 0 -3px 0 var(--a3-red)}
#lk3 .tile canvas{display:block;width:100%;height:var(--th,clamp(64px,14vh,170px));margin:0 auto 6px;background:#dfeaf3}
#lk3 .tile .sub{display:flex;justify-content:center;gap:10px;margin-top:5px;font:italic 700 12px/1 'Barlow Condensed';letter-spacing:.06em}
#lk3 .tile .sub span{display:inline-flex;align-items:center;gap:3px}
#lk3 .up{color:#3DDC84}#lk3 .dn{color:#ff6b7f}
#lk3 .tile:disabled{opacity:.5;cursor:not-allowed}
#lk3 .lockb{position:absolute;inset:auto 6px 6px auto;color:var(--a3-amber)}
#lk3 .inp{width:100%;background:rgba(255,255,255,.05);border:1px solid var(--a3-line);border-bottom:2px solid var(--a3-red);padding:8px 12px;font:italic 900 28px/1 'Barlow Condensed';text-transform:uppercase;color:#fff;border-radius:0}
#lk3 .seg{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:6px}
#lk3 .seg button{padding:11px 0;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);font:italic 800 18px/1 'Barlow Condensed';color:var(--a3-mute2);clip-path:var(--a3-cut)}
#lk3 .seg button.on{background:var(--a3-red);border-color:var(--a3-red);color:#fff}
#lk3 .ban{position:relative;height:clamp(54px,8vh,80px);border:1px solid rgba(255,255,255,.12);text-align:left;padding:0;clip-path:var(--a3-cut)}
#lk3 .ban span{position:absolute;left:10px;bottom:8px;display:flex;align-items:center;gap:5px;font:italic 800 15px/1 'Barlow Condensed';letter-spacing:.06em;color:#fff;text-transform:uppercase;text-shadow:0 1px 3px #000}
#lk3 .ban.on{box-shadow:inset 0 0 0 3px var(--a3-red)}#lk3 .ban:disabled{filter:grayscale(1) brightness(.5)}
#lk3 .lbrow{display:grid;grid-template-columns:auto auto 1fr auto;align-items:center;gap:14px;padding:10px 18px;position:relative;overflow:hidden;clip-path:var(--a3-cut)}
#lk3 .note{display:flex;gap:10px;align-items:center;padding:10px 14px;background:rgba(255,176,32,.1);border-left:3px solid var(--a3-amber);font:500 14px/1.3 Barlow;color:#ffe3a6}
#lk3 .mod{position:fixed;inset:0;z-index:50;background:rgba(5,10,20,.75);display:grid;place-items:center;padding:20px}
#lk3 .modc{width:min(1040px,100%);background:#0b1426;border:1px solid var(--a3-line);clip-path:var(--a3-cut-panel);padding:22px;display:grid;grid-template-columns:minmax(0,360px) minmax(0,1fr);gap:24px}
#lk3 .part{display:grid;grid-template-columns:170px minmax(0,1fr);gap:12px;align-items:center;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.07)}
#lk3 .part b{font:italic 800 17px/1 'Barlow Condensed';text-transform:uppercase}
#lk3 .sw{display:flex;gap:7px;flex-wrap:wrap}#lk3 .sw button{width:28px;height:28px;border:1px solid rgba(255,255,255,.2);padding:0;clip-path:none}#lk3 .sw button.on{outline:3px solid #fff;outline-offset:2px}
#lk3 .btn{display:inline-flex;justify-content:center;align-items:center;gap:8px;padding:13px 18px;background:var(--a3-red);border:0;color:#fff;font:italic 800 19px/1 'Barlow Condensed';letter-spacing:.06em;text-transform:uppercase;clip-path:var(--a3-cut)}
#lk3 .btn.o{background:rgba(255,255,255,.06);border:1px solid var(--a3-line);color:var(--a3-text)}
#lk3 .row{display:grid;gap:clamp(8px,1.2vh,14px)}
#lk3 :focus-visible{outline:3px solid var(--a3-ice);outline-offset:2px}
@media (max-width:980px){#lk3 .g{grid-template-columns:1fr;height:auto}#lk3 .chero{min-height:220px}#lk3 .modc{grid-template-columns:1fr}}
`;

export function initLocker3(host, api) {
  if (!host) return { show() {}, hide() {} };
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  const root = document.createElement('div'); root.id = 'lk3'; host.appendChild(root);
  let S = load(), tab = S.tab ?? 0, stats = {}, rank = null, raf = null, editor = null, ang = 0;
  S.slots = S.slots || [null, null, null]; if (S.stick == null) S.stick = 1;
  const L = () => (api.t('lk_p_size') === 'Size' ? EN : CS), en = () => L() === EN;
  const persist = () => save(S);
  const applyTo = (p, k) => { p.color = k.jersey; p.stripe = k.stripe; p.helmet = k.helmet; p.gloves = k.gloves; p.shorts = k.shorts; p.stick = k.stick; p.tape = k.tape; p.visor = k.visor; p.helmetType = k.helmetType; };
  const mkPlayer = (id, k, size) => { const p = new Player(id, 'home', null); p._dispReach = PLAYER.stickLen; p.charge = 0; p._dispCharge = 0; p.passReq = 0; p.crossCheck = false; p.name = ''; applyTo(p, k); p.size = size; return p; };
  const curKit = () => api.get().kit;
  const kitOf = i => { const K = KITS[i]; return { ...curKit(), jersey: K[2], stripe: K[3], helmet: K[3], gloves: K[4], shorts: K[4] }; };
  const sameKit = (a, b) => ['jersey', 'stripe', 'helmet', 'gloves'].every(k => (a[k] || '').toLowerCase() === (b[k] || '').toLowerCase());
  const title = () => TITLES.find(x => x.id === S.title && x.need(stats)) || TITLES[0];
  const banner = () => { const b = BANNERS.find(x => x.id === S.banner); return b && (!b.need || b.need(stats)) ? b : BANNERS[1]; };

  function avatarHTML(sz = 52) {
    const s = api.get(), a = S.avatar || 'head', u = api.getUser?.(), st = `width:${sz}px;height:${sz}px`;
    if (a === 'discord' && u?.avatar_url) return `<div class="av" style="${st}"><img src="${esc(u.avatar_url)}" alt=""></div>`;
    if (a === 'num') return `<div class="av" style="${st};background:${esc(s.kit.jersey)};color:${esc(s.kit.stripe)}">${esc(s.num ?? '#')}</div>`;
    return `<div class="av" style="${st}" data-head="1"></div>`;
  }
  function fillHeads() {   // profilovka = hlava postavy ze šatny (SVG #hero-stage, obarvené podle výbavy)
    const svg = document.querySelector('#hero-stage svg');
    root.querySelectorAll('[data-head]').forEach(d => { if (!svg) { d.innerHTML = ic('user', 24); return; } const c = svg.cloneNode(true); c.removeAttribute('id'); c.setAttribute('viewBox', '232 10 380 380'); c.setAttribute('width', '100%'); c.setAttribute('height', '100%'); d.replaceChildren(c); });
  }
  function cardHTML() {
    const s = api.get(), l = L(), ti = title();
    const pips = l.st.map((n, i) => `<span>${n}</span><i>${[0, 1, 2, 3, 4].map(k => `<s class="${k < PIPS[s.size][i] ? 'f' : ''}"></s>`).join('')}</i>`).join('');
    const g = stats.games_played || 0, wp = g ? Math.round(100 * (stats.wins || 0) / g) + '%' : '—', pm = stats.plus_minus ?? 0;
    const elo = rank?.rank_points ?? 1000, pos = rank?.position ? ' · #' + rank.position : '';
    return `<div class="card" style="--ban:${banner().bg}"><div class="cban"></div>
      <div class="chero"><canvas id="lk3-hero" width="900" height="600"></canvas><div class="cnum">${esc(s.num ?? '')}</div></div>
      <div class="cbody">
       <div style="display:flex;align-items:center;gap:12px;min-width:0">${avatarHTML()}<div style="min-width:0"><div class="name">${esc(s.name || '—')}</div><div class="ttl">${ic(ti.ic, 16)}${en() ? ti.en : ti.cs}</div></div></div>
       <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span class="chip">${ic('size', 16)}${l.sizes[s.size]} · ${l.roles[s.size]}</span><span class="m">${ic('stick', 14)} ${en() ? STICKS[S.stick].en : STICKS[S.stick].cs} · ELO ${elo}${pos}</span></div>
       <div class="pips">${pips}</div>
       <div class="st4"><div><b>${ic('puck', 16)}${stats.goals ?? 0}</b><span>${l.stats[0]}</span></div><div><b>${ic('pass', 16)}${stats.assists ?? 0}</b><span>${l.stats[1]}</span></div><div><b>${ic('plusminus', 16)}${pm > 0 ? '+' + pm : pm}</b><span>${l.stats[2]}</span></div><div><b>${ic('trophy', 16)}${wp}</b><span>${l.stats[3]}</span></div></div>
      </div></div>`;
  }
  function tabVybava() {
    const s = api.get(), l = L(), g = api.isGuest();
    const sizes = l.sizes.map((n, i) => `<button type="button" class="tile ${s.size === i ? 'on' : ''}" data-size="${i}"><canvas data-pz="${i}" style="--th:clamp(70px,15vh,190px)"></canvas>${n}<div class="sub" style="color:var(--a3-mute)">${l.roles[i]}</div></button>`).join('');
    const sticks = STICKS.map((k, i) => `<button type="button" class="tile ${S.stick === i ? 'on' : ''}" data-stick="${i}"><canvas data-pk="${i}" style="--th:clamp(56px,11vh,140px)"></canvas>${en() ? k.en : k.cs}
      <div class="sub">${k.eff.length ? k.eff.map(([e, v]) => `<span class="${v > 0 ? 'up' : 'dn'}">${ic(e, 13)}${v > 0 ? '+' : '−'} ${l.eff[e]}</span>`).join('') : `<span style="color:var(--a3-mute)">${ic('reach', 13)} 16</span>`}</div></button>`).join('');
    return `<div class="pnl" style="display:grid;grid-template-columns:minmax(0,1.4fr) 110px 170px;gap:14px;align-items:end">
      <label><div class="k" style="margin-bottom:8px">${ic('user', 16)}${l.name}</div><input class="inp" id="lk3-name" maxlength="14" value="${esc(s.name)}" ${g ? 'disabled' : ''}></label>
      <label><div class="k" style="margin-bottom:8px">${ic('hash', 16)}${l.num}</div><input class="inp" id="lk3-num" type="number" min="0" max="99" value="${esc(s.num ?? '')}" ${g ? 'disabled' : ''}></label>
      <div><div class="k" style="margin-bottom:8px">${ic('hand', 16)}${l.grip}</div><div class="seg">${[-1, 1].map((h, i) => `<button type="button" data-hand="${h}" class="${s.hand === h ? 'on' : ''}">${l.hand[i]}</button>`).join('')}</div></div></div>
     <div class="pnl"><div class="k" style="margin-bottom:10px">${ic('size', 16)}${l.size}</div><div class="tiles" style="grid-template-columns:repeat(3,minmax(0,1fr))">${sizes}</div></div>
     <div class="pnl"><div class="k" style="margin-bottom:10px;justify-content:space-between"><span style="display:flex;gap:8px;align-items:center">${ic('stick', 16)}${l.stick}</span><span class="m" style="letter-spacing:0">${l.soon}</span></div><div class="tiles" style="grid-template-columns:repeat(3,minmax(0,1fr))">${sticks}</div></div>`;
  }
  function tabVzhled() {
    const l = L(), c = curKit(), g = api.isGuest();
    const kits = KITS.map((K, i) => `<button type="button" class="tile ${sameKit(c, kitOf(i)) ? 'on' : ''}" data-kit="${i}" ${g ? 'disabled' : ''}><canvas data-tk="${i}" style="--th:clamp(60px,13vh,170px)"></canvas>${en() ? K[1] : K[0]}</button>`).join('');
    const helms = HELMS.map(([v, cs, e]) => `<button type="button" class="tile ${c.helmetType === v ? 'on' : ''}" data-helm="${v}" ${g ? 'disabled' : ''}><canvas data-th="${v}" style="--th:clamp(50px,10vh,130px)"></canvas>${en() ? e : cs}</button>`).join('');
    const slots = S.slots.map((k, i) => k ? `<button type="button" class="tile ${sameKit(c, k) ? 'on' : ''}" data-slot="${i}" ${g ? 'disabled' : ''} title="2× klik = upravit"><canvas data-ts="${i}" style="--th:clamp(50px,10vh,130px)"></canvas>${en() ? 'Mine' : 'Moje'} #${i + 1}</button>`
      : `<button type="button" class="tile" data-new="${i}" ${g ? 'disabled' : ''} style="display:grid;place-items:center;gap:6px;border-style:dashed;min-height:100%">${ic('plus', 28)}${l.create}</button>`).join('');
    return `${g ? `<div class="note">${ic('lock', 18)}${l.guest}</div>` : ''}
     <div class="pnl"><div class="k" style="margin-bottom:10px">${ic('shirt', 16)}${l.kits}</div><div class="tiles" style="grid-template-columns:repeat(4,minmax(0,1fr))">${kits}</div></div>
     <div class="row" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr)">
      <div class="pnl"><div class="k" style="margin-bottom:10px">${ic('helmet', 16)}${l.helm}</div><div class="tiles" style="grid-template-columns:repeat(3,minmax(0,1fr))">${helms}</div></div>
      <div class="pnl"><div class="k" style="margin-bottom:10px">${ic('palette', 16)}${l.mine}</div><div class="tiles" style="grid-template-columns:repeat(3,minmax(0,1fr))">${slots}</div></div></div>`;
  }
  function tabProfil() {
    const l = L(), u = api.getUser?.(), s = api.get(), ban = banner(), ti = title();
    const bans = BANNERS.map(b => { const ok = !b.need || b.need(stats); return `<button type="button" class="ban ${b.id === ban.id ? 'on' : ''}" data-ban="${b.id}" style="background:${b.bg}" ${ok ? '' : 'disabled'}><span>${ok ? '' : ic('lock', 14)}${en() ? b.en : b.cs}${ok ? '' : ' · ' + b.how[en() ? 1 : 0]}</span></button>`; }).join('');
    const avs = ['head', 'num', 'discord'].map((a, i) => { const was = S.avatar; S.avatar = a; const h = avatarHTML(64); S.avatar = was;
      return `<button type="button" class="tile ${(S.avatar || 'head') === a ? 'on' : ''}" data-av="${a}" ${a === 'discord' && !u?.avatar_url ? 'disabled' : ''} style="display:grid;justify-items:center;gap:8px;padding:12px 6px">${h}${l.avs[i]}</button>`; }).join('');
    const tis = TITLES.map(x => { const ok = x.need(stats); return `<button type="button" class="tile ${x.id === ti.id ? 'on' : ''}" data-ttl="${x.id}" ${ok ? '' : 'disabled'} style="display:grid;justify-items:center;gap:6px;padding:12px 4px;${ok ? 'color:var(--a3-amber)' : ''}">${ic(ok ? x.ic : 'lock', 24)}<span style="color:${ok ? '#fff' : 'inherit'}">${en() ? x.en : x.cs}</span>${ok ? '' : `<span class="m" style="font-size:12px">${x.how[en() ? 1 : 0]}</span>`}</button>`; }).join('');
    return `<div class="row" style="grid-template-columns:minmax(0,1.5fr) minmax(0,1fr)">
      <div class="pnl"><div class="k" style="margin-bottom:10px">${ic('flag', 16)}${l.banner}</div><div class="tiles" style="grid-template-columns:repeat(4,minmax(0,1fr))">${bans}</div></div>
      <div class="pnl"><div class="k" style="margin-bottom:10px">${ic('user', 16)}${l.avatar}</div><div class="tiles" style="grid-template-columns:repeat(3,minmax(0,1fr))">${avs}</div></div></div>
     <div class="pnl"><div class="k" style="margin-bottom:10px">${ic('trophy', 16)}${l.ttl}</div><div class="tiles" style="grid-template-columns:repeat(6,minmax(0,1fr))">${tis}</div></div>
     <div class="pnl"><div class="k" style="margin-bottom:10px">${ic('star', 16)}${l.lbPrev}</div><div class="lbrow" style="background:${ban.bg}"><div style="position:absolute;inset:0;background:linear-gradient(90deg,rgba(5,10,20,.15),rgba(5,10,20,.88) 45%)"></div>
      <b class="c3" style="position:relative;font-size:28px">#${rank?.position ?? '—'}</b><div style="position:relative">${avatarHTML(48)}</div>
      <div style="position:relative;min-width:0"><div class="name" style="font-size:30px">${esc(s.name || '—')} <span style="color:var(--a3-red)">${esc(s.num ?? '')}</span></div><div class="ttl" style="font-size:15px">${ic(ti.ic, 14)}${en() ? ti.en : ti.cs}</div></div>
      <b class="c3" style="position:relative;font-size:30px">${rank?.rank_points ?? 1000}</b></div></div>`;
  }
  function editorHTML() {
    const l = L(), k = editor.kit, P = api.PALETTE, SP = api.STICK_PALETTE;
    const rows = [['jersey', P], ['stripe', P], ['gloves', P], ['stick', SP], ['tape', P]].map(([key, pal], i) =>
      `<div class="part"><b>${l.parts[i]}</b><div class="sw">${pal.map(c => `<button type="button" data-ek="${key}" data-ec="${c}" class="${(k[key] || '').toLowerCase() === c ? 'on' : ''}" style="background:${c}" aria-label="${c}"></button>`).join('')}</div></div>`).join('');
    return `<div class="mod" role="dialog" aria-modal="true" aria-label="${l.edit}"><div class="modc">
      <div><div class="k" style="margin-bottom:10px">${ic('palette', 16)}${l.mine} #${editor.slot + 1}</div><div class="chero" style="margin:0;aspect-ratio:3/2;min-height:0"><canvas id="lk3-ed" width="900" height="600"></canvas></div></div>
      <div><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><div class="h1" style="font-size:40px">${l.edit}</div><button type="button" class="btn o" data-eclose="1">${l.close}</button></div>${rows}
       <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:16px"><button type="button" class="btn" data-esave="1">${ic('plus', 18)}${l.save}</button><button type="button" class="btn o" data-ernd="1">${ic('dice', 18)}${l.rnd}</button></div></div></div></div>`;
  }
  function render() {
    const l = L();
    root.innerHTML = `<div class="g">${cardHTML()}<div class="right">
      <div class="top"><button type="button" class="backb" data-back="1">${ic('back', 18)}${l.back}<kbd>Esc</kbd></button><div class="k" style="margin-left:4px">${l.eyebrow}</div></div>
      <div class="tabs" role="tablist">${l.tabs.map((n, i) => `<button type="button" role="tab" aria-selected="${i === tab}" data-tab="${i}">${ic(l.tabIc[i], 20)}${n}</button>`).join('')}</div>
      <div class="body">${[tabVybava, tabVzhled, tabProfil][tab]()}</div></div></div>${editor ? editorHTML() : ''}`;
    fillHeads(); drawStatic();
  }
  // statické náhledy (skuteční hráči z rendereru)
  function drawP(c, k, { size = 1, reach = PLAYER.stickLen, zoom = 1, cy = .58, ang: a = -Math.PI / 2, aim = 0.6 } = {}) {
    const rc = c.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);   // kresba v reálné velikosti dlaždice (bez deformace)
    if (rc.width > 0) { c.width = Math.round(rc.width * dpr); c.height = Math.round(rc.height * dpr); }
    const g = c.getContext('2d'), p = mkPlayer('lk3s', k, size), s0 = Math.min(c.height / 30, c.width / 36) * zoom;
    for (let f = 0; f < 3; f++) { g.fillStyle = '#dfeaf3'; g.fillRect(0, 0, c.width, c.height); p._dispReach = reach; p.x = 500; p.y = 200; p.bodyAngle = p.skateAngle = a; p.vx = 0; p.vy = 0; p.aimAngle = p.carryAngle = p._stickDisp = a + aim; p.num = api.get().num; p.handed = api.get().hand;
      try { p.draw(g, { scale: s0, ox: c.width / 2 - 500 * s0, oy: c.height * cy - 200 * s0, dt: 1 / 60 }); } catch {} }
  }
  function drawStatic() {
    const k = curKit();
    root.querySelectorAll('canvas[data-tk]').forEach(c => drawP(c, kitOf(+c.dataset.tk)));
    root.querySelectorAll('canvas[data-ts]').forEach(c => drawP(c, S.slots[+c.dataset.ts]));
    root.querySelectorAll('canvas[data-th]').forEach(c => drawP(c, { ...k, helmetType: c.dataset.th }, { zoom: 2.3, cy: .62 }));
    root.querySelectorAll('canvas[data-pz]').forEach(c => drawP(c, k, { size: +c.dataset.pz, zoom: .9 }));
    root.querySelectorAll('canvas[data-pk]').forEach(c => drawP(c, k, { reach: STICKS[+c.dataset.pk].reach, zoom: .95, cy: .55, ang: 0, aim: 0.05 }));
  }
  function loop() {
    raf = requestAnimationFrame(loop); ang += 0.012;
    for (const [id, k, R] of [['lk3-hero', curKit(), 3], ['lk3-ed', editor?.kit, 0]]) {
      const c = document.getElementById(id); if (!c || !k) continue;
      const r = c.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1), W = Math.max(2, Math.round(r.width * dpr)), H = Math.max(2, Math.round(r.height * dpr));
      if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
      const g = c.getContext('2d'), s = api.get();
      if (!c._p) c._p = mkPlayer(id, k, s.size);
      const p = c._p; applyTo(p, k); p.size = s.size; p.num = s.num; p.handed = s.hand; p._dispReach = STICKS[S.stick].reach;
      const S0 = Math.min(H / 40, W / 46), hd = ang + Math.PI / 2;
      g.fillStyle = '#dfeaf3'; g.fillRect(0, 0, W, H); g.strokeStyle = 'rgba(204,34,51,.45)'; g.lineWidth = Math.max(2, W / 160); g.beginPath(); g.moveTo(W / 2, 0); g.lineTo(W / 2, H); g.stroke();
      g.strokeStyle = 'rgba(30,79,209,.35)'; g.beginPath(); g.arc(W / 2, H / 2, H * .32, 0, 7); g.stroke();
      p.x = 500 + Math.cos(ang) * R; p.y = 200 + Math.sin(ang) * R; p.bodyAngle = p.skateAngle = hd; p.vx = Math.cos(hd) * 110; p.vy = Math.sin(hd) * 110; p.aimAngle = p.carryAngle = p._stickDisp = hd + 0.5; p.hasPuck = false;
      try { p.draw(g, { scale: S0, ox: W / 2 - 500 * S0, oy: H / 2 - 200 * S0, dt: 1 / 60 }); } catch {}
    }
  }
  root.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || b.disabled) return; const d = b.dataset;
    if (d.back != null) { api.back?.(); return; }
    if (d.tab != null) { tab = +d.tab; S.tab = tab; persist(); }
    else if (d.hand != null) api.setHand(+d.hand);
    else if (d.size != null) api.setSize(+d.size);
    else if (d.stick != null) { S.stick = +d.stick; persist(); api.setStick?.(S.stick); }
    else if (d.kit != null) api.applyKit(kitOf(+d.kit));
    else if (d.helm != null) api.applyKit({ ...curKit(), helmetType: d.helm });
    else if (d.slot != null) api.applyKit({ ...curKit(), ...S.slots[+d.slot] });
    else if (d.new != null) editor = { slot: +d.new, kit: { ...curKit() } };
    else if (d.ek != null) { editor.kit[d.ek] = d.ec; if (d.ek === 'stripe') editor.kit.helmet = d.ec; if (d.ek === 'gloves') editor.kit.shorts = d.ec; }
    else if (d.ernd != null) { const P = api.PALETTE, r = () => P[Math.floor(Math.random() * P.length)], st2 = r(), gl = r();   // náhoda jen v UI (vzhled), ne v simulaci
      Object.assign(editor.kit, { jersey: r(), stripe: st2, helmet: st2, gloves: gl, shorts: gl, tape: r(), stick: api.STICK_PALETTE[Math.floor(Math.random() * api.STICK_PALETTE.length)] }); }
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
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && editor) { e.stopImmediatePropagation(); editor = null; render(); } }, true);
  return {
    async show() {
      render(); if (!raf) loop();
      try { const [s, r] = await Promise.all([api.loadServerStats(), api.loadRankAndCredits()]); stats = s || {}; rank = r || null; render(); } catch {}
    },
    hide() { if (raf) cancelAnimationFrame(raf); raf = null; },
    refresh: render,
    stick: () => S.stick,
  };
}
export const LOCKER3_KITS = KITS;
