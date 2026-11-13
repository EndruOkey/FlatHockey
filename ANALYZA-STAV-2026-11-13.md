# FlatHockey: analýza aktuální podoby (2026-11-13)

**Základ:** `ed8b1a6` (nasazeno). **Srovnání s:** `ANALYZA-MECHANIKY.md` (9. 11.), **stejná rubrika K1–K5** a stejná měřicí skripta.
**Pravidlo:** tvrzení = `soubor:řádek` nebo výstup skriptu. Odhad = `[odhad]`.

## 1. Co se změnilo od 9. 11. (73 commitů bez merge)
Podle klíčových slov v názvu commitu: **vizuál 34** (branka G3→G12, postava, bruslení, hokejka) · **hratelnost/AI 27** · **menu/účty/tutoriál 12**.

## 2. Měření (stejné skripty, seedované)

| metrika | 9. 11. | teď | skript |
|---|---|---|---|
| tým drží puk (s) | 4,4 | **6,0** | `node scripts/chaos_meter.mjs` |
| volný puk (% živého času) | 23 | **14,6** | chaos_meter |
| konce držení = obrání (%) | 27 | **28** (beze změny) | chaos_meter `ends_pct` |
| konce = sklouznutí (%) | ? | 2 | chaos_meter |
| zaseknutí u brankáře (z 22 úhlů) | 8 | **6** | `node scripts/crease_stuck.mjs` |
| góly 3v3 / zápas | ~4,7 | **5,8** (rubrika 4–10 OK) | `FH_TEAM=3 node test/balance.mjs` |
| balanc rubrika | OK | **15/15 OK** | balance.mjs |
| střely one-timer botů | ? | **0** z 856 | `node test/balance-metrics.mjs` |
| testy puk / determinismus | OK | **64/64, OK** | `npm run test:puck`, `test:determinism` |

## 3. Rubrika mechanik (K1 čitelnost · K2 rozhodnutí · K3 protihra · K4 skill · K5 napojení)

| # | Mechanika | 9. 11. | teď | Důkaz změny |
|---|---|---|---|---|
| 1 | Bruslení | 5 | 5 | pohyb v2 (`980a369`) |
| 2 | Brzda | 4 | 4 | – (K3 pořád 0) |
| 3 | Stažení hole | 4 | 4 | pořád nikde vysvětlené |
| 4 | Převzetí puku | 3 | 3 | – |
| 5 | Ochrana čerstvého puku | 0 | 0 | zkrácena 1,5 → 0,8 s (`constants.js:72`), pořád neviditelná |
| 6 | Obrání | 1 | **4** | deterministický souboj holí: tlak z rychlosti švihu čepele, puk letí ve směru švihu (`constants.js:55` `fight: 1`, `world.js:33–49`; náhodný směr `Player.js:294` se přepíše) + krytí tělem (`Player.js:270`). K1 = 0: tlak souboje se nekreslí |
| 7 | Sklouznutí | 1 | 1 | pořád `rng < chance` (`Player.js:379`) |
| 8 | Střela | 5 | 5 | + okno přesné rány |
| 9 | Přenabití | 0 | **4** | už nevystřelí samo: okno PŘESNĚ, pak puk sklouzne (`match-core.js:112–117`) |
| 10 | Finta | 1 | **4** | brankář čte nápřah, malé okno (`Goalie.js:34`, `:166`) |
| 11 | One-timer | 4 | **5** | hláška ONE-TIMER + krok tutoriálu |
| 12 | Přihrávka | 2 | **5** | šipka příjemce (`game.js:747`), nadzvednutý pas (`match-core.js:145`), výběr podle kurzoru |
| 13 | Řekni si o pas | 2 | **3** | klávesa E (`input.js:28`) |
| 14 | Crosscheck | 4 | **5** | odstupňovaný knockback (`2089ef8`); kolize tlačítek trvá (viz P2) |
| 15 | Bodyček | 1 | **3** | postrčení / zakolísání / rozplácnutí podle síly |
| 16 | Tečování | 2 | **4** | teč na Q k brance (`afdc386`); pasivní teč pořád ±26° (`Player.js:404`) |
| 17 | Clona | 3 | **4** | hláška CLONA |
| 18 | Brankář | 2 | 2 | spousta vizuálu, pravidlo brankoviště pořád chybí |
| 19 | Ofsajd / icing / fauly | 2 | 2 | buly v pásmu; přesilovka není |

**Součet: 46 → 67 / 95.** Rozložení: 5 bodů 2 → 5 · 4 body 4 → 7 · 3 body 2 → 3 · **0–2 body 11 → 4**.

Nové mechaniky od 9. 11. (`[odhad]` podle kódu, ne ze hry): přikopnutí Q (okno 120–320 ms) 4 · odraz za síť jako skill shot 4 · kombo přihrávek 5 · týdenní pravidlo 3.

**Plán z 9. 11. (návrhy A–L):** hotovo B, D, F, G, I, J, E (7/12), A jinou cestou (souboj holí + krytí místo tlačítka). **Chybí C** přepínání hráče v sólo (`game.js`: Tab přepíná jen trénink/stavění, `:1123`), **H** přesilovka, **K** nájezdy, **L** brankoviště.

## 4. Nálezy podle závažnosti

### P1: Hra pořád nemá jediného cizího hráče
14denní test zájmu (`STAV.md`, „Další kroky 2.") nebyl spuštěn: `STAV.md` z 13. 11. píše „ověřit **po nahrání** na portály". Od 1. 11. je 130 commitů, z toho po 9. 11. polovina vizuál. Rubrika mechanik vzrostla o 20 bodů, ale nikdo zvenku to nehrál. Každá další úprava vzhledu je sázka bez dat.
**Doporučení:** zmrazit vizuál, nahrát na itch.io + CrazyGames a spustit test s prahy ze `STAV.md`.

### P2: Souboj holí je skill, ale není vidět (OPRAVENO po kontrole, původně chybně P1 „náhoda“)
Obrání jde přes deterministický souboj holí (`world.js:33–49`): tlak roste s relativní rychlostí čepele, puk vyletí ve směru švihu. Náhodná větev (`world.js:126`) běží jen s `FH_FIGHT=0`. Obrání končí 28 % držení. Chyba je v čitelnosti: tlak se nekreslí (`_press` 0× v kódu kresby), hráč neví, že švihem vyhrává.

### P2: Postava je v 1× malá, jmenovka větší než hráč
Na 1440×900 má tělo hráče ~25 px, štítek se jménem je širší než postava (snímek `07-solo-game`, výřez). Detaily posledních dní (stehno + lýtko, roh branky r 10) jsou v plné hře vidět jen málo. `[odhad]`, přesně to změří px snímku postavy v 1×.
**Důsledek:** další vizuální detaily přinesou málo. Víc pomůže čitelnost (štítek menší nebo jen nad vlastním hráčem).

### P2: Sólo hra, ovládáš 1 ze 3 a nejde přepnout
Bez změny od 9. 11. (návrh C, 8 bodů, nezačatý).

### P2: Crosscheck omylem po ztrátě puku
`Player.js:684`: `crossCheck = rmb && !hasPuck && passCooldown <= 0`. Obereš mě, zatímco držím pravé tlačítko na pas → hned crosscheck. Chrání jen cooldown po přihrávce, ne po ztrátě puku.

### P2: Boti nikdy nehrají one-timer
`bot.js`: 0 výskytů `oneTimer`. Balanc: 0 one-timerů z 856 střel. Nejlepší mechanika hry tak hráč u spoluhráčů ani soupeřů nevidí.

### P3
- Brankoviště: zaseknutí 6/22 (bylo 8/22), pravidlo pořád chybí.
- Ochrana 0,8 s a sklouznutí jsou pořád neviditelná / náhodná.
- Přesilovka ani nájezdy při remíze nejsou.
- **Měřicí nástroj zastaral:** `scripts/ux_shots.mjs` po přejmenování menu padá (`.sv-teams-adv summary` není vidět), menu se automaticky vyfotit nedá. Opravit, než se bude ladit UI.

## 5. Co je dobré (nerozbíjet)
Střela, přihrávka, one-timer a kombo jsou teď všechny 5/5. Útočná hra je hotová. Balanc 15/15, determinismus OK, výkon po cache ~165 FPS. Hra je klidnější: volný puk 23 → 15 %, držení 4,4 → 6 s.

## 6. Doporučené pořadí
1. **Test s lidmi** (P1): nahrát na portály. Bez toho nevíme, jestli řešíme správné věci.
2. Oprava crosschecku (hotovo 13. 11.) + zviditelnit souboj holí.
3. Přepínání hráče v sólo (C).
4. Teprve podle dat z testu: vizuál, přesilovka, nájezdy.

---
*Reprodukce: příkazy v tabulce §2. Snímky: `node scripts/ux_shots.mjs` (zastaralý, viz P3) + sólo trénink Playwright 1440×900. Skóre rubriky je ruční podle kódu (odkazy výše).*
