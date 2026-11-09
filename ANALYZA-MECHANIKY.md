# FlatHockey — kritika hratelnosti a mechanik

**Datum:** 2026-11-09 · **Základ:** `6aea809` + necommitnuté opravy (bot plynulá hůl, faul jen při dotyku, zóna převzetí)
**Pravidlo:** každé tvrzení = `soubor:řádek` nebo číslo ze skriptu. Odhad = `[odhad]`.

---

## 1. Rubrika (stanovená předem)

Každá mechanika dostane 0/1 za každé z 5 kritérií (max 5):

| K | Kritérium | Otázka |
|---|---|---|
| K1 | **Čitelnost** | Vidí hráč, že se to stalo a proč? |
| K2 | **Rozhodnutí** | Nabízí volbu s cenou (risk/reward), ne jen „zmáčkni"? |
| K3 | **Protihra** | Má na to soupeř aktivní odpověď? |
| K4 | **Skill** | Rozhoduje načasování/umístění, ne náhoda? |
| K5 | **Napojení** | Vede do další mechaniky (kombinace), nekončí slepě? |

**Slepá ulička** = K5 = 0 nebo mechanika nemá na výsledek vliv. **Úzké hrdlo** = na mechanice stojí jiné, a má ≤ 2 body.

---

## 2. Inventura a skóre

| # | Mechanika | Kde | K1 | K2 | K3 | K4 | K5 | Σ | Poznámka |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Twin‑stick bruslení (WASD + myš), setrvačnost | Player.js:346 | 1 | 1 | 1 | 1 | 1 | **5** | Jádro sedí. Zrychlení 140 px/s² je „těžké". |
| 2 | Hokejová brzda (Space) | Player.js:341, 719 | 1 | 1 | 0 | 1 | 1 | **4** | Dobré, sprej je čitelný. |
| 3 | Stažení hole (kurzor u těla = rychlejší klička, ale −45 % rychlosti) | Player.js:356, 200 | 0 | 1 | 1 | 1 | 1 | **4** | Skrytá hloubka — nikde vysvětlená, hráč neví, že existuje. |
| 4 | Převzetí puku (zóna 10 px u čepele) | Player.js:121–140 | 1* | 0 | 0 | 1 | 1 | **3** | *Až po dnešní zóně. Pas „pro mě" má zónu 18 px — neviditelný rozdíl. |
| 5 | Ochrana čerstvého puku 1,5 s | world.js:86 | 0 | 0 | 0 | 0 | 0 | **0** | Neviditelné pravidlo: někdy tě nejde obrat, jindy ano. |
| 6 | **Obrání** (pasivní: dotkni se čepelí puku) | world.js:86–88, Player.js:157 | 0 | 0 | 0 | 0 | 1 | **1** | **Úzké hrdlo.** Žádné tlačítko, žádné načasování; puk odletí náhodným směrem ±31° (Player.js:170). |
| 7 | Sklouznutí puku (anti‑helikoptéra) | Player.js:224–233 | 0 | 0 | 0 | 1 | 0 | **1** | Hráč nevidí, proč puk ztratil. Náhoda (`rng < chance`). |
| 8 | Střela s nabíjením (žabička → slap) | server.js:129, Player.js:183 | 1 | 1 | 1 | 1 | 1 | **5** | Nejlepší mechanika hry. |
| 9 | **Přenabití → puk vystřelí sám** slabou ranou | server.js:233–235 | 0 | 0 | 0 | 0 | 0 | **0** | **Slepá ulička + trest.** Držíš moc dlouho → rána 0,12 sama od sebe. |
| 10 | Zrušení nápřahu (RMB při nabíjení) = „finta" | server.js:250 | 0 | 1 | 0 | 0 | 0 | **1** | **Slepá ulička:** gólman na nápřah vůbec nereaguje (Goalie.js — 0 výskytů `charge`), takže finta nikoho neoklame. |
| 11 | One‑timer (nabíjej bez puku, pas přijde) | server.js:222, Player.js:137 | 0 | 1 | 1 | 1 | 1 | **4** | Silné, ale okno načasování není nijak ukázané. |
| 12 | **Přihrávka** (1 tlačítko, cíl vybere hra podle kurzoru, pas jen po ledě) | server.js:192, Player.js:291–300 | 0 | 0 | 1 | 0 | 1 | **2** | **Úzké hrdlo.** Hráč neví, komu pas půjde; nemá sílu ani nadzvednutí (vz = 0, Player.js:300). |
| 13 | Řekni si o pas (MMB) | server.js:272, input.js:29 | 0 | 1 | 0 | 0 | 1 | **2** | Prostřední tlačítko — na touchpadu notebooku neexistuje. |
| 14 | Crosscheck (RMB bez puku) | Player.js:305, 472 | 1 | 1 | 1 | 1 | 0 | **4** | Sdílí tlačítko s pasem → ztratíš puk při stisku pasu = nechtěný crosscheck (i do gólmana → píšťalka). |
| 15 | Bodyček / srážky těl | Player.js:271 | 1 | 0 | 0 | 0 | 0 | **1** | Jen fyzika, žádné rozhodnutí; odraz ≤ 45 px/s. |
| 16 | Tečování | Player.js:241–259 | 1 | 0 | 0 | 0 | 1 | **2** | Výchylka náhodná ±26° (Player.js:252) — hráč směr neovlivní. |
| 17 | Clona gólmanovi | Goalie.js:587–593 (tělo zakrývá) | 0 | 1 | 0 | 1 | 1 | **3** | Funguje, ale není vidět, že clonu děláš. |
| 18 | Gólman (jen AI, hráč neovládá) | Goalie.js | 1 | 0 | 0 | 0 | 1 | **2** | Žádné pravidlo brankoviště; boti tam stojí 0,2 % času, člověk se zasekává (27 vs 37 px úniku, `crease_stuck.mjs`). |
| 19 | Offside / icing / freeze → buly | server.js:321–344 | 1 | 1 | 0 | 0 | 0 | **2** | Fauly nemají následek kromě buly (žádná přesilovka). |

**Souhrn (19 mechanik):** 2 za 5, 4 za 4, 2 za 3, **11 za 0–2**. Silné je útočné jádro (bruslení, střela, one‑timer). **Slabá je obrana a souboj o puk, přihrávky a všechno „neviditelné".**

---

## 3. Systémové nálezy (podle závažnosti)

### P1 — Souboj o puk rozhoduje náhoda, ne hráč
Tři místa, kde výsledek hodí kostka místo načasování: **obrání** (náhodný odraz, Player.js:170), **sklouznutí** (Player.js:229), **tečování** (Player.js:252). Plus neviditelná ochrana 1,5 s (world.js:86).
**Měřeno:** 27 % všech konců držení = obrání, 23 % živého času volný puk, tým drží puk jen 4,4 s (`chaos_meter.mjs`).
**Důsledek:** to je kořen chaosu *i* nízkého skillu. Obránce nemá co trénovat (jen „najeď blízko"), útočník nemá jak puk chránit.
**Řešení (dvojice protiher):**
- **Aktivní poke‑check** (tlačítko, ~0,4 s cooldown; minutí = krátké zaváhání) místo pasivního obrání dotykem.
- **Krytí tělem** — puk na odvrácené straně těla nejde obrat. Logika už ve hře je pro gólmana (Goalie.js:587–593), stačí ji převzít pro bruslaře.
- Ochranu 1,5 s **ukázat** (kroužek kolem puku dobíhá) — nebo ji po zavedení krytí zrušit.

### P1 — V sólo hře ovládáš 1 ze 6 a nemůžeš přepnout
Hra je reálně sólo vs boti (ANALYZA‑ZABAVA.md §1). Hráč ovládá jednoho bruslaře; přepnutí na jiného neexistuje (game.js — žádné přepínání hráče). Když je puk na druhé straně, hráč jen dojíždí.
**Řešení:** v zápasech, kde je v týmu jen 1 člověk, **přepnout na bruslaře nejblíž puku** (Tab / automaticky při ztrátě). Standard hokejových her, obrovský dopad na „jsem ve hře" `[odhad]`. Multiplayer s lidmi beze změny.

### P1 — Přihrávka je černá skříňka
Hra vybírá příjemce podle směru kurzoru (server.js:192–205); hráč do poslední chvíle neví, komu pas půjde. Pas jen po ledě, 1 síla (Player.js:300, passSpeedFor). Každá hůl v dráze = ztráta.
**Řešení:** (a) **ukazatel příjemce** — při držení puku zvýraznit spoluhráče, komu pas půjde (malá šipka/kroužek); (b) **nadzvednutý pas** (podržet RMB → puk přes hůl soupeře, pomalejší, horší převzetí) = volba risk/reward.

### P2 — Mechaniky, které trestají nebo nic nedělají
- **Přenabití vystřelí puk samo** (server.js:233–235): hráč čeká na lepší úhel a puk mu „uteče". Změnit na: přenabitá rána jen ztrácí přesnost, nevystřelí sama.
- **Finta nefunguje** (server.js:250 + gólman nereaguje na nápřah): buď dát gólmanovi reakci na nápřah (posun do pozice, pak finta = ujetí bokem = skill), nebo fintu zrušit.

### P2 — Tlačítka kolidují a chybí na noteboocích
- **RMB = pas i crosscheck** (Player.js:472): ztráta puku v okamžiku stisku → crosscheck → u gólmana píšťalka. Opravit: crosscheck jen na *nový* stisk a ne do 0,3 s po ztrátě puku.
- **MMB (řekni si o pas)** na touchpadu není — přidat klávesu (E / Q).

### P2 — Fauly bez dramatu
Interference/fauly končí jen buly. Hokej má **přesilovku** — nejvíc napínavý moment hry. Dvě minuty → v 5min kole 20–30 s 3 na 2 `[odhad]`.

### P3 — Neviditelná hloubka
Stažení hole, one‑timer okno, clona, ochrana puku — nic z toho hra neukazuje. Jednoduchá zpětná vazba („ONE‑TIMER!", „CLONA") zvýší pocit mistrovství bez změny pravidel.

### P3 — Brankoviště
Žádné pravidlo; člověk se o gólmana zasekává (`crease_stuck.mjs`: 8/22 úhlů < 20 px úniku). Měkké vytlačení útočníka bez puku z půlkruhu by vyřešilo zasekávání i fauly.

---

## 4. Rozšíření — co hru obzvláštní

Bodování předem: **Zábava** 0–3 · **Řeší úzké hrdlo** 0–2 · **Cena** 1 velká / 2 střední / 3 malá · **Riziko balancu** 0 vysoké / 1 / 2 nízké · **Unikátnost** 0–2. Max 12.

| # | Návrh | Zába | Hrdlo | Cena | Riziko | Unik | **Σ** |
|---|---|---|---|---|---|---|---|
| A | **Poke‑check + krytí tělem** (souboj o puk = skill) | 3 | 2 | 2 | 0 | 1 | **8** |
| B | **Ukazatel příjemce pasu** | 2 | 2 | 3 | 2 | 0 | **9** |
| C | **Přepínání hráče v sólo** | 3 | 2 | 2 | 1 | 0 | **8** |
| D | **Řetěz přihrávek** — „×3 KOMBO", gól po 3+ pasech = bonus PC + velký efekt | 2 | 1 | 3 | 2 | 2 | **10** |
| E | Přenabití nevystřelí samo | 1 | 1 | 3 | 1 | 0 | **6** |
| F | Nadzvednutý pas (saucer) | 2 | 2 | 2 | 0 | 1 | **7** |
| G | Gólman reaguje na nápřah → funkční finta | 2 | 1 | 2 | 0 | 1 | **6** |
| H | Přesilovka po faulu | 2 | 0 | 2 | 1 | 1 | **6** |
| I | **Týdenní pravidlo** (velký puk, bez offsidu, 2× rychlý puk…) — pestrost zadarmo | 2 | 0 | 3 | 2 | 2 | **9** |
| J | Zpětná vazba skillu („ONE‑TIMER!", „CLONA!", „PERFEKTNÍ PŘEVZETÍ") | 2 | 1 | 3 | 2 | 1 | **9** |
| K | Nájezdy při remíze (trénink „Nájezd" už existuje, game.js:690) | 2 | 0 | 2 | 2 | 0 | **6** |
| L | Krytí brankoviště (měkké vytlačení) | 1 | 1 | 3 | 1 | 0 | **6** |

**Pořadí podle bodů:** D (10) → B, I, J (9) → A, C (8) → F (7) → E, G, H, K, L (6).

**Moje doporučení — pořadí práce** (body + závislosti):
1. **B + J** (levné, žádné riziko, okamžitě čitelnější hra).
2. **A** — souboj o puk jako skill. Je to i kořen chaosu, takže **zklidňovací balík se do něj přirozeně vleje** (obrání přestane být náhodný odraz).
3. **D** — kombo přihrávek = vlastní identita hry („hokej, kde se odměňuje souhra"). Navazuje na B a A.
4. **C** pro sólo, pak **I** jako pravidelná novinka.

---

## 5. Co je dobré (nerozbíjet)
Střela s nabíjením (5/5), twin‑stick bruslení (5/5), one‑timer, zóna převzetí (nově), balanc gólů v rubrice, deterministická simulace (seedovaná náhoda — i „náhodné" souboje jsou opakovatelné, jen je hráč tak nevnímá).

---
*Měření: `scripts/chaos_meter.mjs`, `scripts/crease_stuck.mjs`, `test/balance.mjs`. Skóre rubriky je ruční podle kódu (odkazy výše); body rozšíření jsou odhad podle pevných kritérií.*
