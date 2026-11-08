# Texty FlatHockey — pro koho píšeme a jak

Kontrola pravidel: `node scripts/copy_lint.mjs` (deterministická, stejný vstup = stejný výsledek).

## 1. Na koho cílíme

| | Důkaz v repu | Odhad (neověřeno daty) |
|---|---|---|
| **Kanál** | `release/LISTING.md`, obaly `release/itch`, `release/crazygames` → hráči přijdou z herních portálů | Na portálu rozhoduje náhled + první obrazovka za pár sekund; texty se skenují, nečtou |
| **Zařízení** | `pc_only` — hraje se jen myší a klávesnicí | Hráč sedí u PC, má čas na 5–15min zápas |
| **Jazyk** | CZ + EN (`i18n.js`) | EN = portály (objem), CZ = kamarádi, žáci, první testeři |
| **Věk** | — | 13–25 let, převaha kluků (typické publikum sportovních browserovek) |
| **Motivace** | ELO, žebříček, výhry (Statistiky); Šatna (vzhled); boti místo čekání | 1) hrát hned, 2) porazit někoho, 3) být k poznání |

**Hlavní hráč:** kluk 13–25, hokej zná z televize nebo z NHL her, otevře hru na PC a chce **do 10 vteřin střílet góly**. Nechce číst návody, nezajímá ho technika (servery, síť, latence). Láká ho soupeření a vlastní vzhled.

## 2. Tón

- Tykání, řeč z kabiny. Krátce, sebevědomě, s energií. Ne dětsky, ne agresivní klišé („ROZDRŤ SOUPEŘE“).
- Hokejová slovní zásoba, kterou zná každý fanoušek: **buly, šibenice, klička, nahrávka, dorážka, naskočit**.
- Prodáváme **zážitek**, ne technologii. Místo „offline, nulová latence“ píšeme „jen ty a boti“.
- Nikdy nepřiznávat slabinu v reklamním textu („bez sekání“ = hráč si domyslí, že jinde se to seká).
- EN není doslovný překlad, ale stejný význam s přirozeným hokejovým slangem (*snipe, top shelf, dish, faceoff*).

## 3. Pravidla (měří `scripts/copy_lint.mjs`)

| Prvek | Pravidlo |
|---|---|
| Položka menu (label) | ≤ 16 znaků |
| Podtitulek (sub) | ≤ 24 znaků |
| Nadpis karty (kicker) | ≤ 18 znaků |
| Text karty | ≤ 95 znaků, 1–2 věty, začíná zážitkem |
| Štítky (chips) | max 3, každý ≤ 18 znaků |
| Zakázaná slova | offline, latence/latency, síť/network, sekání/lag, server, bully |
| Jazyky | CZ i EN mají stejnou sadu klíčů |

## 4. Texty menu (před → po)

| Položka | Před | Po (CZ) | Po (EN) |
|---|---|---|---|
| Hrát · sub | RYCHLÝ ZÁPAS 3V3 S BOTY | ZÁPAS 3V3 · HNED TEĎ | 3V3 MATCH · RIGHT NOW |
| Hrát · karta | Okamžitě na led. Zápas 3v3 proti botům, žádné čekání na lobby. | Buly za pár vteřin. Boti drží místa, dokud se nepřidají další hráči. | Puck drops in seconds. Bots hold the spots until real players jump in. |
| Proti botům → **Sólo zápas** | OFFLINE · BEZ SEKÁNÍ | JEN TY A BOTI | JUST YOU VS BOTS |
| · karta | …běží celý v tvém prohlížeči. Nulová latence, žádné sekání sítě. | Nikdo se nepřipojí, nikdo nečeká. Ideální na rozjetí a první góly. | No one joins, no one waits. Perfect to warm up and bag your first goals. |
| Procházet hry → **Najít zápas** | OTEVŘENÁ LOBBY | HRAJ S LIDMI | PLAY WITH PEOPLE |
| Vytvořit hru → **Založit zápas** | VLASTNÍ PRAVIDLA | ZÁPAS PRO PARTU | GAME FOR YOUR CREW |
| Trénink | BEZ SOUPEŘE | VOLNÝ LED | OPEN ICE |
| Tutoriál | PRVNÍ KROKY | ZÁKLADY ZA 2 MINUTY | BASICS IN 2 MINUTES |
| Šatna | TVOJE VÝBAVA | TVŮJ VZHLED | YOUR LOOK |
| Statistiky | ŽEBŘÍČEK | KDO JE NEJLEPŠÍ | WHO'S THE BEST |
| Obchod | BRZY | UŽ BRZY | COMING SOON |

Úvodní obrazovka: „VÍTEJ V ARÉNĚ / Rychlý zápas s boty. Bez registrace.“ → „PUK UŽ ČEKÁ / Žádná registrace, žádné stahování. Klikneš a hraješ.“
Oprava: „PŘIPRAVEN NA BULLY?“ → „BULY“ (*bully* = šikana).

## 5. Co ověřit s lidmi (nejdůležitější, data nemáme)

Odhady v oddílu 1 potvrdí jen skuteční hráči. Doporučení: dát hru 3–5 lidem z cílovky a sledovat, **na co v menu kliknou první a jestli přečtou podtitulek**. Pokud nikdo nečte karty vpravo, nejdůležitější je label + sub.
