// Jednoduchá lokalizace (CS/EN) s autodetekcí jazyka prohlížeče + ručním přepínačem.
const DICT = {
  cs: {
    // Hlavní menu
    play_online: 'HRÁT ONLINE',
    solo: 'SOLO TRÉNINK',
    profile_btn: 'PROFIL & DRES',
    wip: 'Hra je ve vývoji · work in progress',
    discord: 'Připoj se na Discord · nahlas bugy',
    // Profil
    profile_h: 'Profil & dres',
    name_ph: 'TVÉ JMÉNO',
    lefty: 'LEVÁK',
    righty: 'PRAVÁK',
    num_ph: 'č.',
    num_title: 'Číslo dresu',
    helmet: 'HELMA',
    gloves: 'RUKAVICE',
    tape: 'PÁSKA HOKEJKY',
    trail: 'STOPA PUKU',
    helmet_type: 'OCHRANA',
    stick_color: 'HOKEJKA',
    tape_style: 'STYL TAPU',
    ht_visor: 'vizír', ht_none: 'nic', ht_shield: 'akvárko', ht_cage: 'mřížka',
    ts_full: 'celá', ts_toe: 'špička', ts_heel: 'pata', ts_candy: 'pruhy',
    visor_color: 'VIZOR',
    sponsor_only: 'Jen pro sponzory 💎',
    sponsor_on: 'Sponsor odemčen! 💎',
    sponsor_code_ph: 'SPONSOR KÓD (nepovinné)',
    done: 'HOTOVO',
    name_required: 'Napiš si přezdívku 🙂',
    welcome: 'Vítej ve FlatHockey! 🏒',
    profile_intro: 'Nastav si přezdívku a vzhled. Pak dej HOTOVO a můžeš hrát.',
    guest_name: 'Hráč',
    number_label: 'ČÍSLO DRESU',
    // Procházení
    online_h: 'Online hry',
    create_btn: '+ VYTVOŘIT',
    back: 'ZPĚT',
    lobby_empty: 'Žádná otevřená lobby — vytvoř první.',
    // Vytvoření lobby
    new_lobby_h: 'Nové lobby',
    lobby_name_ph: 'NÁZEV LOBBY',
    pass_ph: 'HESLO (nepovinné)',
    home_ph: 'Domácí',
    away_ph: 'Hosté',
    style_solid: 'solid',
    style_stripes: 'pruhy',
    style_shoulder: 'ramena',
    format: 'FORMÁT',
    periods: 'Třetiny',
    minutes: 'Minuty',
    rules: 'Pravidla',
    create: 'VYTVOŘIT',
    // Čekárna
    join_home: 'DO DOMÁCÍCH',
    join_away: 'DO HOSTŮ',
    start: 'START',
    leave: 'ODEJÍT',
    player: 'hráč',
    mode_rules: 'pravidla',
    mode_arcade: 'arkáda',
    // Pauza
    pause: 'PAUZA',
    resume: 'POKRAČOVAT',
    disconnect: 'ODPOJIT — ZPĚT DO MENU',
    opp_left: 'SOUPEŘ SE ODPOJIL',
    peer_left: 'Hráč se odpojil',
    new_host: 'Jsi teď host lobby',
    // Nápověda
    hint: 'WASD bruslení · Myš míří + vzdálenost = vysunutí hole · LMB: tap = žabička, drž = prdel · RMB přihrávka · Space brzda · Esc menu',
    // Ve hře
    covering: 'KRYJE',
    offside: 'OFFSIDE',
    icing: 'ZAKÁZANÉ UVOLNĚNÍ',
    period_of: (per, pers) => `${per}. třetina z ${pers}`,
    end_game: 'KONEC ZÁPASU',
    winner: 'Vítěz',
    draw: 'Remíza',
    esc_back: 'Esc → zpět do menu',
    rematch_in: (s) => `Nový zápas za ${s}s…`,
    starting_rematch: 'Startujeme…',
    live_end: 'KONEC',
    prompt_password: 'Heslo lobby:',
    // Chyby ze serveru (kódy)
    err_unavailable: 'Lobby není dostupné.',
    err_password: 'Špatné heslo.',
    err_full: 'Lobby je plné.',
    err_server_full: 'Server je plný, zkus to za chvíli.',
    err_too_many: 'Příliš mnoho zápasů, zkus to za chvíli.',
    team_home_default: 'Domácí',
    team_away_default: 'Hosté',
  },
  en: {
    play_online: 'PLAY ONLINE',
    solo: 'SOLO PRACTICE',
    profile_btn: 'PROFILE & KIT',
    wip: 'Game is work in progress',
    discord: 'Join Discord · report bugs',
    profile_h: 'Profile & kit',
    name_ph: 'YOUR NAME',
    lefty: 'LEFTY',
    righty: 'RIGHTY',
    num_ph: '#',
    num_title: 'Jersey number',
    helmet: 'HELMET',
    gloves: 'GLOVES',
    tape: 'STICK TAPE',
    trail: 'PUCK TRAIL',
    helmet_type: 'FACE GUARD',
    stick_color: 'STICK',
    tape_style: 'TAPE STYLE',
    ht_visor: 'visor', ht_none: 'none', ht_shield: 'shield', ht_cage: 'cage',
    ts_full: 'full', ts_toe: 'toe', ts_heel: 'heel', ts_candy: 'candy',
    visor_color: 'VISOR',
    sponsor_only: 'Sponsors only 💎',
    sponsor_on: 'Sponsor unlocked! 💎',
    sponsor_code_ph: 'SPONSOR CODE (optional)',
    done: 'DONE',
    name_required: 'Pick a nickname 🙂',
    welcome: 'Welcome to FlatHockey! 🏒',
    profile_intro: 'Set your nickname and look, then hit DONE to play.',
    guest_name: 'Player',
    number_label: 'JERSEY #',
    online_h: 'Online games',
    create_btn: '+ CREATE',
    back: 'BACK',
    lobby_empty: 'No open lobby — create the first one.',
    new_lobby_h: 'New lobby',
    lobby_name_ph: 'LOBBY NAME',
    pass_ph: 'PASSWORD (optional)',
    home_ph: 'Home',
    away_ph: 'Away',
    style_solid: 'solid',
    style_stripes: 'stripes',
    style_shoulder: 'shoulder',
    format: 'FORMAT',
    periods: 'Periods',
    minutes: 'Minutes',
    rules: 'Rules',
    create: 'CREATE',
    join_home: 'JOIN HOME',
    join_away: 'JOIN AWAY',
    start: 'START',
    leave: 'LEAVE',
    player: 'player',
    mode_rules: 'rules',
    mode_arcade: 'arcade',
    pause: 'PAUSE',
    resume: 'RESUME',
    disconnect: 'DISCONNECT — BACK TO MENU',
    opp_left: 'OPPONENT DISCONNECTED',
    hint: 'WASD skate · Mouse aims + distance = stick reach · LMB: tap = flick, hold = slapshot · RMB pass · Space brake · Esc menu',
    covering: 'COVER',
    offside: 'OFFSIDE',
    icing: 'ICING',
    period_of: (per, pers) => `Period ${per} of ${pers}`,
    end_game: 'END OF GAME',
    winner: 'Winner',
    draw: 'Draw',
    esc_back: 'Esc → back to menu',
    rematch_in: (s) => `Rematch in ${s}s…`,
    starting_rematch: 'Starting…',
    live_end: 'END',
    prompt_password: 'Lobby password:',
    err_unavailable: 'Lobby not available.',
    err_password: 'Wrong password.',
    err_full: 'Lobby is full.',
    err_server_full: 'Server is full, try again shortly.',
    err_too_many: 'Too many matches, try again shortly.',
    team_home_default: 'Home',
    team_away_default: 'Away',
  },
};

function detect() {
  try {
    const saved = localStorage.getItem('fh_lang');
    if (saved === 'cs' || saved === 'en') return saved;
    const n = ((typeof navigator !== 'undefined' && (navigator.language || navigator.userLanguage)) || 'en').toLowerCase();
    return (n.startsWith('cs') || n.startsWith('sk')) ? 'cs' : 'en';
  } catch { return 'en'; }
}

let lang = detect();
let _onChange = null;

export function getLang() { return lang; }
export function setOnChange(fn) { _onChange = fn; }

export function t(key, ...args) {
  const d = DICT[lang] || DICT.en;
  const v = d[key] ?? DICT.en[key] ?? key;
  return typeof v === 'function' ? v(...args) : v;
}

export function applyI18n() {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
  document.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.dataset.i18nTitle); });
  const lb = document.getElementById('lang-label') || document.getElementById('lang-btn');
  if (lb) lb.textContent = lang === 'cs' ? 'EN' : 'CZ';
}

export function setLang(l) {
  if (l !== 'cs' && l !== 'en') return;
  lang = l;
  localStorage.setItem('fh_lang', l);
  applyI18n();
  _onChange?.();
}

export function toggleLang() { setLang(lang === 'cs' ? 'en' : 'cs'); }
