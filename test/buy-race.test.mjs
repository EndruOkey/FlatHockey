// Dvojí nákup: hráč má kredit přesně na 1 věc, 10× po sobě koupí → smí projít jen 1×.
// Spuštění: node test/buy-race.test.mjs  (npm run test:buy). Píše do dočasné DB.
import Database from 'better-sqlite3';
import { tmpdir } from 'os';
import { join } from 'path';
import { rmSync } from 'fs';

const dbPath = join(tmpdir(), `fh-buy-${Date.now()}.db`);
process.env.DB_PATH = dbPath;
const { buyItem } = await import('../db.js');

const db = new Database(dbPath);
const uid = db.prepare("INSERT INTO users (discord_id, display_name) VALUES (NULL, 'buytest')").run().lastInsertRowid;
db.prepare('INSERT INTO stats (user_id, puck_credits) VALUES (?, 0)').run(uid);
const item = db.prepare('SELECT id, price FROM store_items WHERE is_active=1 AND price>0 ORDER BY price LIMIT 1').get();
db.prepare('UPDATE stats SET puck_credits=? WHERE user_id=?').run(item.price, uid);

let ok = 0;
for (let i = 0; i < 10; i++) if (buyItem(uid, item.id).ok) ok++;
const bal = db.prepare('SELECT puck_credits c FROM stats WHERE user_id=?').get(uid).c;
const owns = db.prepare('SELECT COUNT(*) c FROM user_unlocks WHERE user_id=?').get(uid).c;
db.close();
try { rmSync(dbPath); } catch {}

const pass = ok === 1 && bal === 0 && owns === 1;
console.log(`cena ${item.price}, 10× nákup → úspěšně ${ok}×, zůstatek ${bal}, vlastní ${owns} ks`);
console.log(pass ? 'OK: koupeno právě 1×' : 'CHYBA: dvojí nákup!');
process.exit(pass ? 0 : 1);
