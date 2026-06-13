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
    losses       INTEGER NOT NULL DEFAULT 0
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
  db.prepare(`
    UPDATE stats SET
      goals        = goals        + ?,
      assists      = assists      + ?,
      saves        = saves        + ?,
      games_played = games_played + ?,
      wins         = wins         + ?,
      losses       = losses       + ?
    WHERE user_id = ?
  `).run(goals, assists, saves, games_played, wins, losses, user_id);
}

export function cleanExpiredTokens() {
  const now = Math.floor(Date.now() / 1000);
  db.prepare('DELETE FROM sessions WHERE expires_at < ? OR used = 1').run(now);
}

export default db;
