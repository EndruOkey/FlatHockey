import Database from 'better-sqlite3';
import { randomBytes } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, 'flathockey.db'));

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
    return existing.id;
  }
  const info = db.prepare(`
    INSERT INTO users (discord_id, display_name, avatar_url, is_sponsor)
    VALUES (?, ?, ?, ?)
  `).run(discord_id, display_name, avatar_url, is_sponsor ? 1 : 0);
  ensureProfile(info.lastInsertRowid);
  ensureStats(info.lastInsertRowid);
  return info.lastInsertRowid;
}

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
  const cols = Object.keys(fields).filter(k => allowed.includes(k));
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

export function buyItem(user_id, item_id) {
  const item = db.prepare('SELECT * FROM store_items WHERE id = ? AND is_active = 1').get(item_id);
  if (!item) return { ok: false, error: 'item_not_found' };

  const alreadyOwns = db.prepare('SELECT 1 FROM user_unlocks WHERE user_id = ? AND item_id = ?').get(user_id, item_id);
  if (alreadyOwns) return { ok: false, error: 'already_owned' };

  const credits = getPuckCredits(user_id);
  if (credits < item.price) return { ok: false, error: 'insufficient_credits' };

  db.prepare('UPDATE stats SET puck_credits = puck_credits - ? WHERE user_id = ?').run(item.price, user_id);
  db.prepare('INSERT INTO user_unlocks (user_id, item_id) VALUES (?, ?)').run(user_id, item_id);

  // Pokud je to titul — rovnou nastav do profilu
  if (item.item_type === 'title') {
    db.prepare('UPDATE profiles SET title = ? WHERE user_id = ?').run(item.item_value, user_id);
  }

  return { ok: true, new_balance: credits - item.price };
}

export function getActiveSeason() {
  return db.prepare('SELECT * FROM seasons WHERE is_active = 1 ORDER BY id DESC LIMIT 1').get();
}

export function cleanExpiredTokens() {
  const now = Math.floor(Date.now() / 1000);
  db.prepare('DELETE FROM sessions WHERE expires_at < ? OR used = 1').run(now);
}

export default db;
