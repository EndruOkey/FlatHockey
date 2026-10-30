# Stav projektu (aktualizováno 2026-10-29)

Čti jako první v každé nové relaci (i v cloudu na claude.ai/code).

## Co běží
- Web: https://flathockey.fun — Oracle VPS, služba `hockey`, repo `~/FlatHockey`, větev **`main`** (od 30. 10.; stará P2P verze = tag `archive/p2p-webrtc`).
- Nasazený commit: `2779025` (29. 10.). Předchozí funkční verze pro návrat: `e21223f`.
- Server je autoritativní, 60 ticků/s; prázdné místo v týmu doplní bot (`bot.js`).

## Co se udělalo 29. 10.
- P1: `/api/me/*` a `/api/store*` visely (špatný middleware) → `requireAuth`.
- Úvodní stránka padala na chybějících prvcích → opraveno.
- Bot: dorovná menší tým, uvolní místo člověku. Test: `npm run test:bot` (5/5 gólů).
- Herní smyčka dohání čas (Windows volal setInterval ~37×/s místo 60).
- Anonymní metrika: `npm run metrics` (hráči, zápasy, návrat D1/D7, zdroj `?ref=`).
- Vložení na itch.io / CrazyGames: CSP `frame-ancestors`, v iframe skrytý Discord login.
  Obaly k nahrání: `release/itch/index.html`, `release/crazygames/index.html`.

## Cíl: 14denní test zájmu
Hra nebyla nikdy propagovaná. Plán: vydat na itch.io + CrazyGames, po 14 dnech rozhodnout:
| Výsledek | Co dál |
|---|---|
| ≥ 300 zahájených zápasů **a** ≥ 10 % návrat do 7 dní | dodělávat |
| hodně zápasů, málo návratů | ladit zábavu, test zopakovat |
| málo zápasů | uzavřít / zkusit hru bez online soupeřů |

## Hotovo 30. 10.
- Brankář: horní roh trefitelný, postavení souměrné.
- Puk u brány: jedno pravidlo pro obě strany (`Puck.js` `_carryKeepOut`), test `npm run test:puck` (64 kontrol).
- Server: limity požadavků, CSRF u POST, pád = restart, kontrola tokenu; `npm run test:server`.
- Tutoriál/trénink: 5 oprav (menu, spin, puk na ledě, nahrávka), pojistka u kroku „Dej gól“ (po 3 zákrocích lehký gólman, po 6 splněno); `python test/training-smoke.py <url>`.
- Náhledy: `node release/thumb/thumbs.mjs` (směry A „Logo v ledu“, B „Detail střely“ — vybrat), video+snímky `node release/make-assets.mjs`.

## Účty (30. 10.)
- Host má účet od 1. hry (token `fh_device_token` v localStorage → funguje i v iframe portálů); statistiky se ukládají.
- Discord přihlášení sloučí hostovský účet (součet statistik a kreditů, rank = max, unlocky sjednocení).
- Kód propojení XXX-XXX (10 min, 1×) — jen itch.io/flathockey.fun, NE na CrazyGames.
- CrazyGames: obal `release/crazygames/index.html` = most k SDK (postMessage) → `POST /auth/crazygames` ověří RS256 token (JWKS CG). Po nahrání nastavit na serveru `CG_GAME_ID`. Ověřit v CG náhledu.
- Testy: `npm run test:accounts`, `npm run test:cg`. Před každým nasazením záloha DB do ~/backups (20 posledních).

## Zbývá
- Vybrat náhled (A/B) a podle něj první snímek videa.
- (hotovo) Vlna 2: simulace je deterministická — `world.rng` (public/js/rng.js), časovače v ticích; `npm run test:determinism`.
- (hotovo) Vlna 3: nasazení pushem do main, main = produkce.
- (hotovo) Bot: role, přihrávky, oba rohy; nestrká do stojícího hráče (posun 5371 → 960 px); `npm run test:botq`.
- (hotovo) Podklady: `node release/make-assets.mjs` → release/assets (covery, video, 4 snímky ze simulace).

## Další kroky
1. Texty pro portály: `release/LISTING.md` (projít).
2. Nahrát obaly na itch.io a CrazyGames (Basic Launch), spustit test.
3. Ručně zkusit pocit z tutoriálu (automatický test prošel).

## Nasazení
Push do `main` → GitHub Actions (`.github/workflows/deploy.yml`): testy (puk, determinismus, server, bot) → až když projdou, pull + restart na serveru + kontrola webu.
Funguje odkudkoli (i z claude.ai/code). Ručně: GitHub → Actions → Deploy → Run workflow.
Klíč: GitHub Secrets `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS` (staré `SSH_PRIVATE_KEY`, `BUTLER_API_KEY` patří k březnové verzi).

## Alpha opravy 30. 10. (nasazeno)
- Bezpečnost: pád serveru vadnou zprávou (DoS), dvojí nákup, XSS v žebříčku, pád šatny (profil) — opraveno, testy.
- Integrita skóre: gól po konci / vlastní gól / bot se nepočítá; odměna jen hráčům od startu, 1 účet 1×; zaseknutá záložka nejede. test:scorehack, test:buy.
- Vyvážení (měřeno, test:balance + test/balance-metrics.mjs): zdržování držení puku 98→24 %, parkování v brance 100→53 %; opraven i zámrzek brankáře s pukem.
- UI: mobil = hláška „hraj na PC"; vložená verze bez Discordu; soukromé lobby bez systémového okna; toasty; sjednocený jazyk (cs/en) a názvy; Zpět+Esc; CLS 0,41→0,017; favicon+og; obchod skryt; menu „Hrát proti botovi/Trénink/Tutoriál"; rematch.
- Tutoriál: přihrávka učí RMB; tlačítko Přeskočit; konec tichého přeskakování; nové pořadí (gól hned po střele).
- Plná sada testů zelená; viz ALPHA.md pro zbytek (herní vyvážení skupiny D = na výběr; prodloužení, CG_GAME_ID po nahrání).
