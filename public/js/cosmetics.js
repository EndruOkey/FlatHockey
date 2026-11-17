// KOSMETIKA PROFILU (2026-11-17) — jeden zdroj pro šatnu (locker3.js), server (ověření odemčení) i gólovou kartu (game.js).
// Odemčení jen ze statistik, které server už vede (stats: goals, assists, saves, games_played, wins). Bez vlivu na hru.
export const BANNERS = [
  { id: 'ice', cs: 'Led', en: 'Ice', bg: 'linear-gradient(120deg,#cfe7f2,#7fb6d9 60%,#2c5d8c)' },
  { id: 'bolt', cs: 'Blesk', en: 'Bolt', bg: 'repeating-linear-gradient(115deg,#1b4fd1 0 18px,#3a9fff 18px 22px)' },
  { id: 'night', cs: 'Noc', en: 'Night', bg: 'radial-gradient(circle at 85% 25%,#ffcf3a 0 5px,transparent 6px),linear-gradient(160deg,#141b31,#050811)' },
  { id: 'red', cs: 'Derby', en: 'Derby', bg: 'repeating-linear-gradient(115deg,#E4002B 0 18px,#A8001F 18px 26px)' },
  { id: 'retro', cs: 'Retro', en: 'Retro', bg: 'repeating-linear-gradient(90deg,#b81d3a 0 14px,#f4f7fb 14px 20px,#1b4fd1 20px 34px)' },
  { id: 'gun', cs: 'Kanonýr', en: 'Sniper', bg: 'linear-gradient(120deg,#ff4455,#1a1f29)', need: s => (s.goals ?? 0) >= 100, how: ['100 gólů', '100 goals'] },
  { id: 'vet', cs: 'Veterán', en: 'Veteran', bg: 'linear-gradient(120deg,#FFB020,#7a5015)', need: s => (s.games_played ?? 0) >= 100, how: ['100 zápasů', '100 games'] },
  { id: 'ace', cs: 'Eso', en: 'Ace', bg: 'radial-gradient(circle at 30% 50%,#7FD4FF 0 10%,transparent 11%),linear-gradient(120deg,#0b2a4a,#050A14)', need: s => (s.wins ?? 0) >= 50, how: ['50 výher', '50 wins'] }];
export const TITLES = [
  { id: 'rookie', cs: 'Nováček', en: 'Rookie', ic: 'star', need: () => true },
  { id: 'scorer', cs: 'Střelec', en: 'Scorer', ic: 'puck', need: s => (s.goals ?? 0) >= 25, how: ['25 gólů', '25 goals'] },
  { id: 'setup', cs: 'Nahrávač', en: 'Playmaker', ic: 'pass', need: s => (s.assists ?? 0) >= 25, how: ['25 asistencí', '25 assists'] },
  { id: 'winner', cs: 'Vítěz', en: 'Winner', ic: 'trophy', need: s => (s.wins ?? 0) >= 25, how: ['25 výher', '25 wins'] },
  { id: 'vet', cs: 'Veterán', en: 'Veteran', ic: 'clock', need: s => (s.games_played ?? 0) >= 50, how: ['50 zápasů', '50 games'] },
  { id: 'gun', cs: 'Kanonýr', en: 'Sniper', ic: 'target', need: s => (s.goals ?? 0) >= 100, how: ['100 gólů', '100 goals'] }];
export const AVATARS = ['head', 'num', 'discord'];
export const DEFAULT_BANNER = 'bolt', DEFAULT_TITLE = 'rookie';
export const unlocked = (item, stats) => !!item && (!item.need || item.need(stats || {}));
// platná volba podle statistik (server i klient stejně) — neodemčené / neznámé → výchozí
export const pickBanner = (id, stats) => { const b = BANNERS.find(x => x.id === id); return unlocked(b, stats) ? b : BANNERS.find(x => x.id === DEFAULT_BANNER); };
export const pickTitle = (id, stats) => { const t = TITLES.find(x => x.id === id); return unlocked(t, stats) ? t : TITLES.find(x => x.id === DEFAULT_TITLE); };
export const pickAvatar = (id, hasDiscord) => (id === 'num' ? 'num' : id === 'discord' && hasDiscord ? 'discord' : 'head');
