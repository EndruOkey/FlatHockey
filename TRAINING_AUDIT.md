# Training Mode — Kompletní Audit + Batched Roadmap

> Pracovní dokument. Odškrtávat jak hotovo.

---

## Co máme (hotové)

| Oblast | Stav |
|---|---|
| Session counter gólů | ✅ stats bar |
| Personal best (localStorage) | ✅ `fh_train_best_goals`, zlatý glow |
| Goal counter flash | ✅ `_goalCounterFlash` |
| Zvuk poke (hit + miss) | ✅ `SFX.poke(true/false)` |
| Poke vizuální sweep animace | ✅ čára + ring, defender |
| Recover arc (ne přímá linka) | ✅ waypoint oblouk |
| `isDefender` — nepřekáží puku/goalie | ✅ |
| Body occlusion při poke | ✅ exposed dot product |
| 3 presety defendera (zone/balanced/forecheck) | ✅ config panel |
| Brankář 3 obtížnosti (easy/casual/competitive) | ✅ `_diffIdx` |
| Brankář easy weak spots | ✅ pětka + rohy |
| Goalie speed cap (max 310 px/s) | ✅ |
| ZONE_CIRCLE_DIST fix (retrieve fix) | ✅ 200px, exkluzivní defender |
| Passer drag + pozice | ✅ |
| Passer drift pohyb (sinusový) | ✅ 3 rychlosti, 4 osy |
| Passer config panel | ✅ gear button, speed + direction |
| Drill systém (free/breakaway/one-timer) | ✅ `_drillIdx` 0/1/2 |
| Build mode (train/build tabu) | ✅ freeze + drag objekty |
| Ukládání scénářů | ✅ localStorage `fh_scenarios`, max 30 |
| Kopírování kódu scénáře | ✅ `navigator.clipboard` → fallback `window.prompt` |
| Import kódu scénáře | ✅ `window.prompt` + `atob` decode |
| Rename scénáře | ✅ `window.prompt` |
| Smazání scénáře | ✅ |
| Obecný tutorial | ✅ `hockey_tutorial_done` flag |

---

## Zjištěné problémy a mezery

### A — STATS & FEEDBACK
- ❌ Žádný `_shotAttempts` counter → nelze accuracy %, `_sessionTime` existuje ale nevyužit v UI
- ❌ Best streak (po sobě jdoucí góly bez ztráty puku)
- ❌ Průměrný čas do gólu (data jsou, display chybí)
- ❌ "Nice goal" vizuální reward (jen counter pulse, žádný WOW moment)
- ❌ Shot accuracy % v UI

### B — POKE & PHYSICS
- ❌ Puk po poke vždy letí na střed → žádný loose battle, nerealistické
- ❌ Puk po poke "skáče" (smooth release) — neverifikováno
- ❌ Body shielding hint — hráč neví že může krýt tělem

### C — DEFENDER BOT
- ❌ Runtime variance — gap/timing deterministický, cheese route za 30 min
- ❌ Trap behavior — záměrné puštění gap + pozdní poke
- ❌ "Wrong read" — bot nikdy záměrně neudělá chybu
- ❌ Passive preset — `zone` stále pokuje, chybí "jen stojí" mód
- ❌ Gap variance (mění gap organicky dle situace, ne fixní dle presetu)
- 🔴 Defender jitter v edge case gapu (segment 7 analýzy) — neprošetřeno

### D — BRANKÁŘ
- ❌ Weak spot vizualizace — hráč musí sám přijít na to kde je slabé místo
- ❌ Angle play — vyjíždí zmenšit úhel (reálný hokej), teď jen laterálně
- ⚠️ One-timer flag existuje (`_oneTimer`) — goalie na to reaguje? Neověřeno

### E — PASSER
- ❌ Druhý passer (2v1) — systém podporuje jen 1
- ❌ Passer nabíhá do prostoru (trojúhelník) — jen drift na místě
- ❌ Variabilita přihrávek (rychlá/pomalá/lobovaná) — vždy stejná
- ❌ Human-like delay variance — `RETURN_DELAY = 1.3` fixní, ne random
- ❌ Bezier vlastní cesta — diskutováno, odloženo

### F — BUILD MODE & SCÉNÁŘE
- 🔴 `window.prompt()` pro název/import/rename = **broken na mobilu**, nefunguje na iOS Safari
- ❌ Duplicate detection — lze uložit 30× stejný scénář bez varování
- ❌ Reset pozic za běhu (restart scénáře bez reloadu) — nutný full reload
- ❌ Kategorie / tagy scénářů
- ❌ Druhý defender
- ⚠️ Passer drift config se neukládá do scenario code — `driftSpeed` a `driftAngle` chybí v `_generateScenarioCode()`

### G — ONBOARDING
- ❌ Training-specific onboarding (obecný tutorial ≠ training)
- ❌ Hint "táhni defendera pryč = breakaway"
- ❌ Hint "krytí tělem chrání puk"
- ❌ Defender aktivuje se až po 1. gólu (pro nováčky)

---

## Batch Roadmap

### BATCH 1 — Quick Wins & Bugs (~2h)
> Vysoký dopad, malé riziko, žádné závislosti

- [x] **F3** Passer drift config do `_generateScenarioCode()` — `driftSpeed` + `driftAngle` v `s.p[2/3]`
- [x] **A1** Shot attempts + accuracy — již existovaly (`score.shots` + stats bar), žádná oprava
- [x] **B1** Puk loose battle po poke — kick ±60° od `aimAngle` rychlostí 130 px/s (ne 210 na střed)
- [x] **D3** One-timer goalie — potvrzeno: goalie nemá žádnou one-timer awareness → přesunuto do Batch 5
- [x] **C6** Defender jitter — příčina: flip-flop na `closeEnough` prahu; opraveno hysterézou (1.10×/1.45×)

### BATCH 2 — Stats Completion (~2h)
> Uzavírá feedback loop — retence nováčků + casual hráčů

- [x] **A1** Shot accuracy % — již bylo, stats bar má PŘESNOST buňku
- [x] **A3** Průměrný čas do gólu — `ø Xs` sub-label pod ČAS buňkou
- [x] **A2** Best streak — buňka SÉRIE (nahradila TYČKY), sub-label `MAX N`
- [x] **A4** "Nice goal" flash — 1s radial glow overlay při gólu

### BATCH 3 — Build Mode UX Fix (~3h)
> Opravit broken věci před dalším rozšiřováním

- [x] **F1** `window.prompt/confirm/alert` → `_showInputDialog` + `_showConfirmDialog` HTML overlay (iOS-safe, paste funguje)
- [ ] **F2** Duplicate detection — pokud stejný kód existuje, zeptat se
- [ ] **F4** Reset scénáře bez reloadu — tlačítko "↺ RESET" v train dock

### BATCH 4 — Bot Intelligence (~3h)
> Zastaví odchod hráčů po 30 min (cheese route problém)

- [ ] **C1** Runtime variance — v každém `_tick` aplikuj malý random drift na gap (±2px/frame noise)
- [ ] **C3** Wrong read — každých 8–12s šance 15% že defender jde špatným směrem na 0.4s
- [ ] **C4** Passive preset — nový preset `passive`: stojí na homeX/Y, nepohybuje se, nepokuje
- [ ] **C5** Gap variance — gap = `sc.gap + situational * dynamic_factor` místo fixní hodnoty

### BATCH 5 — Goalie & Passer Polish (~2h)
> Zvyšuje skill ceiling a autenticitu

- [ ] **D1** Weak spot vizualizace — na easy obtížnosti jemné highlight zón (průhledné, discoverable)
- [ ] **D2** One-timer ověření + případná oprava goalie lag při one-timer
- [ ] **E3** Delay variance — `RETURN_DELAY = 1.0 + Math.random() * 0.6` místo fixního 1.3
- [ ] **E2** Passer position hint — po 3 gólech ze stejného místa lehce pohne anchor

### BATCH 6 — Velké Features (design first)
> Před implementací domluvit design

- [ ] **E1** Druhý passer — architektura: `world.passers[]`, drag druhého ze doku
- [ ] **C2** Trap behavior — nový state `trap` v defender state machine
- [ ] **D2** Angle play brankář
- [ ] **E5** Bezier cesta passera

---

## Závislosti

```
Batch 1 (A1 shot counter)
  └── Batch 2 (accuracy %)

Batch 1 (F3 passer config v kódu)
  └── Batch 3 (reset scénáře zachová drift nastavení)

Batch 3 (canvas input field)
  └── Batch 6 (jakýkoliv dialog pro velké features)

Batch 4 (bot variance) — nezávislé, lze kdykoli
Batch 5 (goalie/passer) — nezávislé, lze kdykoli
Batch 6 — design discussion first
```
