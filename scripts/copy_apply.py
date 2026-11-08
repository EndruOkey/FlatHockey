# Přepíše texty menu podle COPY.md (idempotentní). python scripts/copy_apply.py
import io, re
P = 'public/js/i18n.js'
T = {
 'cs': {
  'play_sub': 'ZÁPAS 3V3 · HNED TEĎ', 'm_k_play': 'ROVNOU NA LED',
  'm_t_play': 'Buly za pár vteřin. Boti drží místa, dokud se nepřidají další hráči.', 'm_c_play': '3v3|Hned|Přidají se další',
  'off_title': 'Sólo zápas', 'm_k_off': 'TVŮJ ZÁPAS', 'm_s_off': 'JEN TY A BOTI',
  'm_t_off': 'Nikdo se nepřipojí, nikdo nečeká. Ideální na rozjetí a první góly.', 'm_c_off': '3v3|Jen ty|Rozjetí',
  'browse_title': 'Najít zápas', 'm_k_browse': 'ONLINE', 'm_s_browse': 'HRAJ S LIDMI',
  'm_t_browse': 'Naskoč do rozehraného zápasu, nebo počkej s ostatními na buly.', 'm_c_browse': 'Živé zápasy|Lidi|Heslo',
  'create_title': 'Založit zápas', 'm_k_create': 'PRO PARTU', 'm_s_create': 'ZÁPAS PRO PARTU',
  'm_t_create': 'Pozvi kámoše odkazem. Od 1v1 po 5v5, s ofsajdem i bez, třetiny podle sebe.', 'm_c_create': '1v1–5v5|Pozvánka|Ofsajd',
  'm_k_train': 'VOLNÝ LED', 'm_s_train': 'VOLNÝ LED',
  'm_t_train': 'Prázdný led jen pro tebe. Pilu střelu do šibenice, kličky a nahrávky.', 'm_c_train': 'Střela|Klička|Výbava',
  'm_k_tut': 'NOVÁČEK?', 'm_s_tut': 'ZÁKLADY ZA 2 MINUTY',
  'm_t_tut': 'Bruslení, střela a nahrávka krok za krokem. Za dvě minuty víš, jak na to.', 'm_c_tut': 'WASD|Myš|2 minuty',
  'm_k_locker': 'BUĎ K POZNÁNÍ', 'm_s_locker': 'TVŮJ VZHLED',
  'm_t_locker': 'Jméno, číslo, dres, helma i páska na hokejce. Ať tě na ledě poznají.', 'm_c_locker': 'Dres|Helma|Hokejka',
  'm_k_stats': 'SEZÓNA 1', 'm_s_stats': 'KDO JE NEJLEPŠÍ',
  'm_t_stats': 'Tvoje góly, výhry a místo v žebříčku. Kdo je tady nejlepší?', 'm_c_stats': 'Góly|Výhry|Žebříček',
  'm_k_store': 'PUCK STORE', 'm_s_store': 'UŽ BRZY',
  'm_t_store': 'Stopy za pukem, helmy a skiny za Puck Credits. Otevíráme se sezónou 1.', 'm_c_store': 'Stopy|Skiny|Puck Credits',
  'splash_welcome_a': 'PUK UŽ', 'splash_welcome_b': 'ČEKÁ',
  'splash_first_text': 'Žádná registrace, žádné stahování. Klikneš a hraješ.',
  'vm_eyebrow': 'PŘIPRAVEN NA BULY?',
 },
 'en': {
  'play_sub': '3V3 MATCH · RIGHT NOW', 'm_k_play': 'GET ON THE ICE',
  'm_t_play': 'Puck drops in seconds. Bots hold the spots until real players jump in.', 'm_c_play': '3v3|Instant|Others can join',
  'off_title': 'Solo match', 'm_k_off': 'YOUR GAME', 'm_s_off': 'JUST YOU VS BOTS',
  'm_t_off': 'No one joins, no one waits. Perfect to warm up and bag your first goals.', 'm_c_off': '3v3|Just you|Warm-up',
  'browse_title': 'Find a match', 'm_k_browse': 'ONLINE', 'm_s_browse': 'PLAY WITH PEOPLE',
  'm_t_browse': 'Jump into a live game, or wait for the next faceoff with others.', 'm_c_browse': 'Live games|Real players|Password',
  'create_title': 'Host a match', 'm_k_create': 'FOR YOUR CREW', 'm_s_create': 'GAME FOR YOUR CREW',
  'm_t_create': 'Invite friends with a link. 1v1 to 5v5, offside on or off, periods your way.', 'm_c_create': '1v1–5v5|Invite link|Offside',
  'm_k_train': 'OPEN ICE', 'm_s_train': 'OPEN ICE',
  'm_t_train': 'Empty ice, all yours. Work on top-shelf snipes, dekes and passes.', 'm_c_train': 'Shooting|Dekes|Gear',
  'm_k_tut': 'NEW HERE?', 'm_s_tut': 'BASICS IN 2 MINUTES',
  'm_t_tut': "Skating, shooting and passing step by step. Two minutes and you're ready.", 'm_c_tut': 'WASD|Mouse|2 minutes',
  'm_k_locker': 'STAND OUT', 'm_s_locker': 'YOUR LOOK',
  'm_t_locker': 'Name, number, jersey, helmet, even stick tape. Let them see you coming.', 'm_c_locker': 'Jersey|Helmet|Stick',
  'm_k_stats': 'SEASON 1', 'm_s_stats': "WHO'S THE BEST",
  'm_t_stats': "Your goals, wins and spot on the leaderboard. Who's the best out here?", 'm_c_stats': 'Goals|Wins|Leaderboard',
  'm_k_store': 'PUCK STORE', 'm_s_store': 'COMING SOON',
  'm_t_store': 'Puck trails, helmets and skins for Puck Credits. Opening with Season 1.', 'm_c_store': 'Trails|Skins|Puck Credits',
  'splash_welcome_a': "THE PUCK'S", 'splash_welcome_b': 'WAITING',
  'splash_first_text': "No sign-up, no download. Click and you're playing.",
 },
}
s = io.open(P, encoding='utf-8').read()
en_at = s.index('\n  en: {')
blocks = {'cs': [s[:en_at]], 'en': [s[en_at:]]}
BS = chr(92)
def esc(v): return v.replace(BS, BS * 2).replace("'", BS + "'")
for lang, kv in T.items():
    b = blocks[lang][0]
    for k, v in kv.items():
        pat = re.compile(r"(\b" + re.escape(k) + r":\s*)(['\"])((?:" + BS * 2 + r".|(?!\2).)*)\2")
        if not pat.search(b): b = b.replace('\n    ' + 'm_k_train' + ':', "\n    " + k + ": '" + esc(v) + "', m_k_train:", 1); continue
        b = pat.sub(lambda m: m.group(1) + "'" + esc(v) + "'", b, count=1)
    blocks[lang][0] = b
io.open(P, 'w', encoding='utf-8', newline='').write(blocks['cs'][0] + blocks['en'][0])
print('ok')
