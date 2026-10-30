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

## Hotovo 30. 10.
- Brankář: horní roh trefitelný, postavení souměrné.
- Puk u brány: jedno pravidlo pro obě strany (`Puck.js` `_carryKeepOut`), test `npm run test:puck` (64 kontrol).
- Server: limity požadavků, CSRF u POST, pád = restart, kontrola tokenu; `npm run test:server`.
- Tutoriál/trénink: 5 oprav (menu, spin, puk na ledě, nahrávka), pojistka u kroku „Dej gól“ (po 3 zákrocích lehký gólman, po 6 splněno); `python test/training-smoke.py <url>`.
- Náhledy: `node release/thumb/thumbs.mjs` (směry A „Logo v ledu“, B „Detail střely“ — vybrat), video+snímky `node release/make-assets.mjs`.

## Zbývá
- Vybrat náhled (A/B) a podle něj první snímek videa.
- (hotovo) Vlna 2: simulace je deterministická — `world.rng` (public/js/rng.js), časovače v ticích; `npm run test:determinism`.
- Vlna 3: GitHub Action pro nasazení (nový klíč do Secrets), main = produkce, úklid větve dev (.claude/), zastaralé workflow míří na starý server.
- Bot strká do stojícího hráče (pokus o vyhýbání to zhoršil 2,4× → zahozen).

## Další kroky
1. Texty pro portály: `release/LISTING.md` (projít).
2. Nahrát obaly na itch.io a CrazyGames (Basic Launch), spustit test.
3. Ručně zkusit pocit z tutoriálu (automatický test prošel).

## Nasazení
Z PC: `ssh ubuntu@flathockey.fun` → `cd ~/FlatHockey && git pull --ff-only && sudo systemctl restart hockey`
(SSH klíč je jen na PC — z cloudu nasadit nejde, dokud nebude GitHub Action s klíčem v Secrets.)
