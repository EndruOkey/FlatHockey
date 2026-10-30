import Database from 'better-sqlite3';
import { randomBytes, randomInt, randomUUID } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(process.env.DB_PATH || path.join(__dirname, 'flathockey.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id   TEXT UNIQUE,
    email        TEXT UNIQUE,
    display_name TEXT NOT NULL,
    avatar_url   TEXT,
    is_sponsor   INTEGER NOT NULL DEFAULT 0,
    created_at   INTEGER NOT NULL DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS profiles (
    user_id      INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    helmet       TEXT NOT NULL DEFAULT '#e0e0e0',
    gloves       TEXT NOT NULL DEFAULT '#e0e0e0',
    tape         TEXT NOT NULL DEFAULT '#e0e0e0',
    trail        TEXT NOT NULL DEFAULT '#888888',
    stick        TEXT NOT NULL DEFAULT '#c8a060',
    tape_style   TEXT NOT NULL DEFAULT 'solid',
    helmet_type  TEXT NOT NULL DEFAULT 'basic',
    visor        INTEGER NOT NULL DEFAULT 0,
    handed       TEXT NOT NULL DEFAULT 'right',
    number       INTEGER NOT NULL DEFAULT 99
  );

  CREATE TABLE IF NOT EXISTS stats (
    user_id      INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    goals        INTEGER NOT NULL DEFAULT 0,
    assists      INTEGER NOT NULL DEFAULT 0,
    saves        INTEGER NOT NULL DEFAULT 0,
    games_played INTEGER NOT NULL DEFAULT 0,
    wins         INTEGER NOT NULL DEFAULT 0,
    losses       INTEGER NOT NULL DEFAULT 0,
    rank_points  INTEGER NOT NULL DEFAULT 1000,
    puck_credits INTEGER NOT NULL DEFAULT 0,
    plus_minus   INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS friends (
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    friend_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (user_id, friend_id)
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token        TEXT PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at   INTEGER NOT NULL,
    used         INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS seasons (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    slug         TEXT NOT NULL UNIQUE,
    start_date   INTEGER NOT NULL DEFAULT (unixepoch()),
    end_date     INTEGER,
    is_active    INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS store_items (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    category     TEXT NOT NULL,
    item_type    TEXT NOT NULL,
    item_value   TEXT NOT NULL,
    price        INTEGER NOT NULL,
    season_id    INTEGER REFERENCES seasons(id),
    is_active    INTEGER NOT NULL DEFAULT 1,
    sort_order   INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS user_unlocks (
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    item_id      INTEGER NOT NULL REFERENCES store_items(id) ON DELETE CASCADE,
    purchased_at INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (user_id, item_id)
  );
`);

// ── Migrace existujících tabulek (idempotentní) ──────────────────────────────
for (const [table, col, def] of [
  ['stats',    'rank_points',  'INTEGER NOT NULL DEFAULT 1000'],
  ['stats',    'puck_credits', 'INTEGER NOT NULL DEFAULT 0'],
  ['stats',    'plus_minus',   'INTEGER NOT NULL DEFAULT 0'],
  ['profiles', 'title',        'TEXT'],
]) {
  const exists = db.prepare(`PRAGMA table_info(${table})`).all().some(r => r.name === col);
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
}

// ── Identity vrstva: jeden interní účet, více identit (discord / device / email) ──
// users.discord_id zůstává kvůli zpětné kompatibilitě (nullable); zdroj pravdy je identities.
db.exec(`
  CREATE TABLE IF NOT EXISTS identities (
    provider    TEXT    NOT NULL,
    provider_id TEXT    NOT NULL,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
    PRIMARY KEY (provider, provider_id)
  );
  CREATE INDEX IF NOT EXISTS idx_identities_user ON identities (user_id);

  CREATE TABLE IF NOT EXISTS link_codes (
    code       TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    used       INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_link_codes_user ON link_codes (user_id);

  INSERT OR IGNORE INTO identities (provider, provider_id, user_id, created_at)
    SELECT 'discord', discord_id, id, created_at FROM users WHERE discord_id IS NOT NULL;
  INSERT OR IGNORE INTO identities (provider, provider_id, user_id, created_at)
    SELECT 'email', email, id, created_at FROM users WHERE email IS NOT NULL;
`);

// ── Alpha Season 1 seed (jen pokud neexistuje) ───────────────────────────────
const seasonExists = db.prepare("SELECT id FROM seasons WHERE slug = 'alpha-1'").get();
if (!seasonExists) {
  db.prepare("INSERT INTO seasons (name, slug, is_active) VALUES (?, ?, 1)")
    .run('Alpha Season 1', 'alpha-1');
}
const alphaSeason = db.prepare("SELECT id FROM seasons WHERE slug = 'alpha-1'").get();

// ── Store items seed ──────────────────────────────────────────────────────────
const storeCount = db.prepare('SELECT COUNT(*) AS n FROM store_items').get().n;
if (storeCount === 0) {
  const insertItem = db.prepare(`
    INSERT INTO store_items (name, description, category, item_type, item_value, price, season_id, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const sid = alphaSeason.id;
  const items = [
    // ── Prémiové barvy helmy ─────────────────────────────────────────
    ['Matte Gold',      'Zlatá matná přilba',          'helmet_color', 'helmet', '#C8A000', 200, null, 10],
    ['Galaxy Purple',   'Temně fialová přilba',         'helmet_color', 'helmet', '#5500CC', 200, null, 11],
    ['Neon Green',      'Neonově zelená přilba',         'helmet_color', 'helmet', '#00FF88', 150, null, 12],
    ['Toxic',           'Toxická žlutozelená přilba',    'helmet_color', 'helmet', '#AAFF00', 150, null, 13],
    ['Midnight',        'Téměř černá přilba',            'helmet_color', 'helmet', '#111827', 100, null, 14],
    ['Crimson',         'Temně rudá přilba',             'helmet_color', 'helmet', '#8B0000', 100, null, 15],
    // ── Prémiové barvy trailu ────────────────────────────────────────
    ['Ice Cyan',        'Ledový azurový trail za pukem', 'trail_color',  'trail',  '#00FFFF', 250, null, 20],
    ['Fire Orange',     'Ohnivě oranžový trail',          'trail_color',  'trail',  '#FF4400', 250, null, 21],
    ['Gold Rush',       'Zlatý třpytivý trail',           'trail_color',  'trail',  '#FFD700', 300, null, 22],
    ['Plasma',          'Elektricky fialový trail',       'trail_color',  'trail',  '#CC00FF', 300, null, 23],
    ['Blood Red',       'Rudý trail',                     'trail_color',  'trail',  '#CC0022', 200, null, 24],
    // ── Prémiové barvy hokejky ───────────────────────────────────────
    ['Carbon Black',    'Uhlíkově černá hokejka',         'stick_color',  'stick',  '#1A1A1A', 150, null, 30],
    ['Chrome',          'Chromovaná hokejka',              'stick_color',  'stick',  '#C8C8D8', 150, null, 31],
    ['Gold Stick',      'Zlatá hokejka',                   'stick_color',  'stick',  '#C8A000', 200, null, 32],
    // ── Tituly ──────────────────────────────────────────────────────
    ['Ice King',        'Titul zobrazovaný v lobby',       'title',        'title',  'Ice King',       500, null, 40],
    ['The Sniper',      'Titul pro střelecké eso',         'title',        'title',  'The Sniper',     500, null, 41],
    ['Rookie',          'Pro nováčky',                     'title',        'title',  'Rookie',         100, null, 42],
    ['Legend',          'Nejvzácnější titul',              'title',        'title',  'Legend',        1000, null, 43],
    ['Enforcer',        'Titul pro tvrdé hráče',           'title',        'title',  'Enforcer',       500, null, 44],
    // ── Alpha Season 1 exkluzivní ────────────────────────────────────
    ['Alpha Tester',    'Exkluzivní titul Alpha Season',   'title',        'title',  'Alpha Tester',     0, sid,  50],
    ['Alpha Ice',       'Exkluzivní trail Alpha Season',   'trail_color',  'trail',  '#00E5FF',        200, sid,  51],
  ];
  for (const [i, row] of items.entries()) insertItem.run(...row);
}

// ── Připravené příkazy pro výkon ─────────────────────────────────────────────
const stmtUpdateStats = db.prepare(`
  UPDATE stats SET
    goals        = goals        + ?,
    assists      = assists      + ?,
    saves        = saves        + ?,
    games_played = games_played + ?,
    wins         = wins         + ?,
    losses       = losses       + ?
  WHERE user_id = ?
`);

const stmtUpdateRankCredits = db.prepare(`
  UPDATE stats SET
    rank_points  = MAX(0, rank_points  + ?),
    puck_credits = puck_credits + ?,
    plus_minus   = plus_minus   + ?
  WHERE user_id = ?
`);

// ── User helpers ─────────────────────────────────────────────────────────────

export function upsertDiscordUser({ discord_id, display_name, avatar_url, is_sponsor }) {
  const existing = db.prepare('SELECT id FROM users WHERE discord_id = ?').get(discord_id);
  if (existing) {
    // is_sponsor se jen zvyšuje (Discord role přidá), nikdy nemaže — ruční DB set zůstane
    db.prepare(`
      UPDATE users SET display_name = ?, avatar_url = ?,
        is_sponsor = CASE WHEN ? = 1 THEN 1 ELSE is_sponsor END
      WHERE discord_id = ?
    `).run(display_name, avatar_url, is_sponsor ? 1 : 0, discord_id);
    ensureProfile(existing.id);
    ensureStats(existing.id);
    stmtAddIdentity.run('discord', discord_id, existing.id);
    return existing.id;
  }
  const info = db.prepare(`
    INSERT INTO users (discord_id, display_name, avatar_url, is_sponsor)
    VALUES (?, ?, ?, ?)
  `).run(discord_id, display_name, avatar_url, is_sponsor ? 1 : 0);
  ensureProfile(info.lastInsertRowid);
  ensureStats(info.lastInsertRowid);
  stmtAddIdentity.run('discord', discord_id, info.lastInsertRowid);
  return Number(info.lastInsertRowid);
}

// ── Identity / guest / merge ─────────────────────────────────────────────────
const stmtAddIdentity = db.prepare('INSERT OR IGNORE INTO identities (provider, provider_id, user_id) VALUES (?, ?, ?)');

export function getUserIdByIdentity(provider, provider_id) {
  return db.prepare('SELECT user_id FROM identities WHERE provider = ? AND provider_id = ?').get(provider, String(provider_id))?.user_id ?? null;
}
export function userHasIdentity(user_id, provider) {
  return !!db.prepare('SELECT 1 FROM identities WHERE user_id = ? AND provider = ?').get(user_id, provider);
}
/** Host = existující účet bez discord identity (jen zařízení). */
export function isGuestUser(user_id) {
  return !!getUserById(user_id) && !userHasIdentity(user_id, 'discord') && !userHasIdentity(user_id, 'crazygames');
}

/** Nový hostující účet vázaný na identitu zařízení (provider 'device', provider_id = did). */
export const createGuestUser = db.transaction((did, display_name = 'Guest') => {
  const info = db.prepare('INSERT INTO users (display_name) VALUES (?)').run(display_name);
  const id = Number(info.lastInsertRowid);
  ensureProfile(id);
  ensureStats(id);
  stmtAddIdentity.run('device', did, id);
  return id;
});

export function setGuestName(user_id, name) {
  const n = String(name || '').trim().slice(0, 16);
  if (!n || !isGuestUser(user_id)) return;
  db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(n, user_id);
}

/**
 * Sloučí účet src do dst (deterministická pravidla), vše v jedné transakci:
 * statistiky sečteny, rank_points = max, kredity sečteny, odemčení sjednocena,
 * profil zůstává dst (title ze src jen když dst žádný nemá), identity přepojeny, src smazán.
 * Odmítne: src === dst, neexistující účet, src s Discord identitou (slučují se jen hosté).
 */
export const mergeUsers = db.transaction((srcId, dstId) => {
  srcId = Number(srcId); dstId = Number(dstId);
  if (!srcId || !dstId || srcId === dstId) return { ok: false, error: 'same_or_invalid' };
  if (!getUserById(srcId) || !getUserById(dstId)) return { ok: false, error: 'not_found' };
  if (userHasIdentity(srcId, 'discord') || userHasIdentity(srcId, 'crazygames')) return { ok: false, error: 'source_not_guest' };
  ensureStats(srcId); ensureStats(dstId); ensureProfile(dstId);
  db.prepare(`
    UPDATE stats SET
      goals        = stats.goals        + s.goals,
      assists      = stats.assists      + s.assists,
      saves        = stats.saves        + s.saves,
      games_played = stats.games_played + s.games_played,
      wins         = stats.wins         + s.wins,
      losses       = stats.losses       + s.losses,
      plus_minus   = stats.plus_minus   + s.plus_minus,
      puck_credits = stats.puck_credits + s.puck_credits,
      rank_points  = MAX(stats.rank_points, s.rank_points)
    FROM (SELECT * FROM stats WHERE user_id = ?) AS s
    WHERE stats.user_id = ?
  `).run(srcId, dstId);
  db.prepare(`INSERT OR IGNORE INTO user_unlocks (user_id, item_id, purchased_at)
              SELECT ?, item_id, purchased_at FROM user_unlocks WHERE user_id = ?`).run(dstId, srcId);
  db.prepare(`UPDATE profiles SET title = (SELECT title FROM profiles WHERE user_id = ?) WHERE user_id = ? AND title IS NULL`).run(srcId, dstId);
  db.prepare(`INSERT OR IGNORE INTO friends (user_id, friend_id, created_at)
              SELECT ?, friend_id, created_at FROM friends WHERE user_id = ? AND friend_id != ?`).run(dstId, srcId, dstId);
  db.prepare(`INSERT OR IGNORE INTO friends (user_id, friend_id, created_at)
              SELECT user_id, ?, created_at FROM friends WHERE friend_id = ? AND user_id != ?`).run(dstId, srcId, dstId);
  db.prepare('UPDATE identities SET user_id = ? WHERE user_id = ?').run(dstId, srcId);
  db.prepare('UPDATE users SET is_sponsor = MAX(is_sponsor, (SELECT is_sponsor FROM users WHERE id = ?)) WHERE id = ?').run(srcId, dstId);
  db.prepare('DELETE FROM users WHERE id = ?').run(srcId);   // CASCADE: stats, profil, odemčení, friends, link_codes
  return { ok: true, user_id: dstId };
});

/**
 * Discord přihlášení. guestId (ověřené serverem) = hostující účet z tohoto zařízení.
 * - Discord účet už existuje → aktualizuj a slouč do něj hosta.
 * - Discord účet nový + je host → přidej hostovi Discord identitu (bez merge).
 * - Jinak vytvoř nový účet.
 */
export const loginDiscordUser = db.transaction((info, guestId = null) => {
  const { discord_id, display_name, avatar_url, is_sponsor } = info;
  const existingId = getUserIdByIdentity('discord', discord_id);
  const guestOk = guestId && isGuestUser(guestId);
  if (existingId) {
    const uid = upsertDiscordUser(info);
    if (guestOk && Number(guestId) !== uid) mergeUsers(guestId, uid);
    return uid;
  }
  if (guestOk) {
    db.prepare('UPDATE users SET discord_id = ?, display_name = ?, avatar_url = ?, is_sponsor = MAX(is_sponsor, ?) WHERE id = ?')
      .run(discord_id, display_name, avatar_url, is_sponsor ? 1 : 0, guestId);
    stmtAddIdentity.run('discord', discord_id, guestId);
    return Number(guestId);
  }
  return upsertDiscordUser(info);
});

/**
 * CrazyGames přihlášení (cgId = ověřené userId z JWT). Pravidla CG:
 * - účet s touto CG identitou existuje → ten vyhrává (nic se nesluče);
 * - jinak host z tohoto zařízení s 0 odehranými hrami → dostane CG identitu (nic neztrácí);
 * - jinak nový účet (host s hrami zůstává nedotčený, nesluče se).
 * Vrací { userId, created } a zajistí, že účet má aspoň jednu device identitu (did) pro token.
 */
export const loginCrazyGamesUser = db.transaction((cgId, display_name, avatar_url = null, guestId = null) => {
  cgId = String(cgId);
  const name = String(display_name || '').trim().slice(0, 16) || 'Player';
  const avatar = typeof avatar_url === 'string' && /^https:\/\//.test(avatar_url) && avatar_url.length < 300 ? avatar_url : null;
  let uid = getUserIdByIdentity('crazygames', cgId), created = false;
  if (uid) {
    db.prepare('UPDATE users SET display_name = ?, avatar_url = ? WHERE id = ?').run(name, avatar, uid);
  } else {
    const gp = guestId && isGuestUser(guestId) ? (getStats(guestId)?.games_played ?? 0) : -1;
    if (gp === 0) {
      uid = Number(guestId);
      db.prepare('UPDATE users SET display_name = ?, avatar_url = ? WHERE id = ?').run(name, avatar, uid);
    } else {
      uid = Number(db.prepare('INSERT INTO users (display_name, avatar_url) VALUES (?, ?)').run(name, avatar).lastInsertRowid);
      ensureProfile(uid); ensureStats(uid);
      created = true;
    }
    stmtAddIdentity.run('crazygames', cgId, uid);
  }
  let did = db.prepare("SELECT provider_id FROM identities WHERE user_id = ? AND provider = 'device' ORDER BY created_at, rowid LIMIT 1").get(uid)?.provider_id;
  if (!did) { did = randomUUID(); stmtAddIdentity.run('device', did, uid); }
  return { userId: uid, did, created };
});

// ── Link kód (propojení hosta v iframe s Discord účtem) ──────────────────────
const LINK_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // bez I L O 0 1
export const LINK_TTL = 600;
export function normalizeLinkCode(raw) {
  const c = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return c.length === 6 && [...c].every(ch => LINK_ALPHABET.includes(ch)) ? c.slice(0, 3) + '-' + c.slice(3) : null;
}
export const createLinkCode = db.transaction((user_id, now = Math.floor(Date.now() / 1000)) => {
  db.prepare('DELETE FROM link_codes WHERE user_id = ? OR expires_at < ? OR used = 1').run(user_id, now);
  for (;;) {
    let c = '';
    for (let i = 0; i < 6; i++) c += LINK_ALPHABET[randomInt(LINK_ALPHABET.length)];
    c = c.slice(0, 3) + '-' + c.slice(3);
    if (db.prepare('SELECT 1 FROM link_codes WHERE code = ?').get(c)) continue;
    db.prepare('INSERT INTO link_codes (code, user_id, expires_at) VALUES (?, ?, ?)').run(c, user_id, now + LINK_TTL);
    return { code: c, expires_at: now + LINK_TTL };
  }
});
/** Kód → slouč jeho účet do targetUserId (musí mít Discord identitu). Jednorázový. */
export const redeemLinkCode = db.transaction((raw, targetUserId, now = Math.floor(Date.now() / 1000)) => {
  const code = normalizeLinkCode(raw);
  if (!code) return { ok: false, error: 'invalid_code' };
  const row = db.prepare('SELECT * FROM link_codes WHERE code = ? AND used = 0 AND expires_at > ?').get(code, now);
  if (!row) return { ok: false, error: 'invalid_code' };
  if (!userHasIdentity(targetUserId, 'discord')) return { ok: false, error: 'discord_required' };
  db.prepare('UPDATE link_codes SET used = 1 WHERE code = ?').run(code);
  const r = mergeUsers(row.user_id, targetUserId);
  return r.ok ? { ok: true } : { ok: false, error: r.error === 'same_or_invalid' ? 'same_account' : r.error };
});

export function upsertEmailUser(email, display_name) {
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return existing.id;
  const info = db.prepare(`
    INSERT INTO users (email, display_name) VALUES (?, ?)
  `).run(email, display_name);
  ensureProfile(info.lastInsertRowid);
  ensureStats(info.lastInsertRowid);
  return info.lastInsertRowid;
}

export function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function ensureProfile(user_id) {
  db.prepare('INSERT OR IGNORE INTO profiles (user_id) VALUES (?)').run(user_id);
}
function ensureStats(user_id) {
  db.prepare('INSERT OR IGNORE INTO stats (user_id) VALUES (?)').run(user_id);
}

export function getProfile(user_id) {
  return db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(user_id);
}

export function saveProfile(user_id, fields) {
  const allowed = ['helmet','gloves','tape','trail','stick','tape_style','helmet_type','visor','handed','number'];
  // Přeskoč prázdné hodnoty — number je NOT NULL, zápis null by shodil uložení (500) i otevření šatny
  const cols = Object.keys(fields).filter(k => allowed.includes(k) && fields[k] != null);
  if (!cols.length) return;
  const set = cols.map(c => `${c} = ?`).join(', ');
  db.prepare(`UPDATE profiles SET ${set} WHERE user_id = ?`).run(...cols.map(c => fields[c]), user_id);
}

export function getStats(user_id) {
  return db.prepare('SELECT * FROM stats WHERE user_id = ?').get(user_id);
}

// ── Magic-link session helpers ────────────────────────────────────────────────

export function createMagicToken(user_id, ttlSeconds = 900) {
  const token = randomBytes(32).toString('hex');
  const expires_at = Math.floor(Date.now() / 1000) + ttlSeconds;
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, user_id, expires_at);
  return token;
}

export function consumeMagicToken(token) {
  const now = Math.floor(Date.now() / 1000);
  const row = db.prepare('SELECT * FROM sessions WHERE token = ? AND used = 0 AND expires_at > ?').get(token, now);
  if (!row) return null;
  db.prepare('UPDATE sessions SET used = 1 WHERE token = ?').run(token);
  return row.user_id;
}

export function updateStats(user_id, { goals = 0, assists = 0, saves = 0, games_played = 0, wins = 0, losses = 0 }) {
  stmtUpdateStats.run(goals, assists, saves, games_played, wins, losses, user_id);
}

// NHL-style rank + credits update po konci zápasu
// rankDelta / creditsDelta / plusMinusDelta se sečtou k hodnotám hráče
export function updateRankAndCredits(user_id, { rankDelta = 0, creditsDelta = 0, plusMinusDelta = 0 }) {
  stmtUpdateRankCredits.run(rankDelta, creditsDelta, plusMinusDelta, user_id);
}

export function getRankPosition(user_id) {
  const row = db.prepare('SELECT rank_points FROM stats WHERE user_id = ?').get(user_id);
  if (!row) return null;
  const pos = db.prepare('SELECT COUNT(*) AS n FROM stats WHERE rank_points > ?').get(row.rank_points).n + 1;
  return { rank_points: row.rank_points, position: pos };
}

export function getLeaderboard(limit = 50) {
  return db.prepare(`
    SELECT u.display_name, u.avatar_url, s.rank_points, s.goals, s.assists,
           s.wins, s.losses, s.games_played, s.plus_minus
    FROM stats s JOIN users u ON u.id = s.user_id
    WHERE s.games_played > 0
    ORDER BY s.rank_points DESC
    LIMIT ?
  `).all(limit);
}

export function getPuckCredits(user_id) {
  return db.prepare('SELECT puck_credits FROM stats WHERE user_id = ?').get(user_id)?.puck_credits ?? 0;
}

export function getStoreItems() {
  return db.prepare(`
    SELECT i.*, s.name AS season_name, s.slug AS season_slug
    FROM store_items i
    LEFT JOIN seasons s ON s.id = i.season_id
    WHERE i.is_active = 1
    ORDER BY i.sort_order
  `).all();
}

export function getUserUnlocks(user_id) {
  return db.prepare(`
    SELECT item_id FROM user_unlocks WHERE user_id = ?
  `).all(user_id).map(r => r.item_id);
}

// Celý nákup v jedné transakci: čtení i odečet atomicky → dva souběžné požadavky
// nekoupí dvě věci za jedny kredity. Odečet proběhne jen když zůstatek stačí (podmínka v UPDATE).
const _buyTxn = db.transaction((user_id, item_id) => {
  const item = db.prepare('SELECT * FROM store_items WHERE id = ? AND is_active = 1').get(item_id);
  if (!item) return { ok: false, error: 'item_not_found' };

  const alreadyOwns = db.prepare('SELECT 1 FROM user_unlocks WHERE user_id = ? AND item_id = ?').get(user_id, item_id);
  if (alreadyOwns) return { ok: false, error: 'already_owned' };

  const upd = db.prepare('UPDATE stats SET puck_credits = puck_credits - ? WHERE user_id = ? AND puck_credits >= ?')
    .run(item.price, user_id, item.price);
  if (upd.changes === 0) return { ok: false, error: 'insufficient_credits' };

  db.prepare('INSERT INTO user_unlocks (user_id, item_id) VALUES (?, ?)').run(user_id, item_id);
  if (item.item_type === 'title') {
    db.prepare('UPDATE profiles SET title = ? WHERE user_id = ?').run(item.item_value, user_id);
  }
  return { ok: true, new_balance: getPuckCredits(user_id) };
});

export function buyItem(user_id, item_id) {
  return _buyTxn(user_id, item_id);
}

// ── Anonymní metrika (bez IP, bez cookies): pid = náhodné id z localStorage ──
db.exec(`
  CREATE TABLE IF NOT EXISTS metric_events (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    ts     INTEGER NOT NULL,          -- epoch sekundy
    day    TEXT    NOT NULL,          -- 'YYYY-MM-DD' UTC
    pid    TEXT    NOT NULL,
    type   TEXT    NOT NULL,          -- visit | match_start | match_end | source
    detail TEXT                       -- source: host / ref
  );
  CREATE INDEX IF NOT EXISTS idx_metric_type_day ON metric_events (type, day);
  CREATE INDEX IF NOT EXISTS idx_metric_pid ON metric_events (pid, type);
`);
const stmtMetric = db.prepare('INSERT INTO metric_events (ts, day, pid, type, detail) VALUES (?, ?, ?, ?, ?)');
const stmtVisitToday = db.prepare("SELECT 1 FROM metric_events WHERE type = 'visit' AND pid = ? AND day = ?");
export function logMetric(pid, type, detail = null) {
  if (typeof pid !== 'string' || pid.length > 64 || !/^[A-Za-z0-9_-]+$/.test(pid)) return;
  const ts = Math.floor(Date.now() / 1000);
  const day = new Date(ts * 1000).toISOString().slice(0, 10);
  if (type === 'visit' && stmtVisitToday.get(pid, day)) return;
  if (detail != null) detail = String(detail).replace(/[^\w.\-]/g, '').slice(0, 40) || null;
  stmtMetric.run(ts, day, pid, type, detail);
}

export function getActiveSeason() {
  return db.prepare('SELECT * FROM seasons WHERE is_active = 1 ORDER BY id DESC LIMIT 1').get();
}

export function cleanExpiredTokens() {
  const now = Math.floor(Date.now() / 1000);
  db.prepare('DELETE FROM sessions WHERE expires_at < ? OR used = 1').run(now);
}

export default db;
