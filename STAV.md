# Stav projektu (aktualizováno 2026-10-29)

Čti jako první v každé nové relaci (i v cloudu na claude.ai/code).

## Co běží
- Web: https://flathockey.fun — Oracle VPS, služba `hockey`, repo `~/FlatHockey`, větev **`gameplay-movement-rework`** (ne `main`).
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

## Rozpracované (neověřené, NEnasazené)
- Brankář: horní roh nejde trefit — `Goalie.js` ~487 chce z > 19.5 px, střela vyletí max ~14.6 px
  (`maxShotVz² / 2·gravity`). Brankář stojí nesouměrně (−16 px dole vs +11 px nahoře).
  Rozpracovaná oprava: `release/patches/goalie-wip.patch`, `release/patches/bot-wip.js`.

## Další kroky
1. Dokončit opravu brankáře (měřit symetrii skriptem, pak `npm run test:bot`).
2. Assety: itch cover 630×500 + 3–5 screenshotů; CrazyGames covery 1920×1080, 800×1200, 800×800 + tiché video 15–20 s.
3. Nahrát obaly na itch.io a CrazyGames (Basic Launch), spustit test.
4. Ručně projít tréninkový režim (WIP z 13. 9. je teď poprvé na produkci).

## Nasazení
Z PC: `ssh ubuntu@flathockey.fun` → `cd ~/FlatHockey && git pull --ff-only && sudo systemctl restart hockey`
(SSH klíč je jen na PC — z cloudu nasadit nejde, dokud nebude GitHub Action s klíčem v Secrets.)
