# Deterministická analýza: pohyb, rychlost, boti, netcode

Datum: 2026-11-08. Vše měřeno skripty (deterministicky, seedované), ne dojmem. Reprodukce příkazy u každé sekce.
Baseline = nasazený stav (commit 03713b6 + hystereze honiče).

---

## Metodika

| oblast | skript | co měří |
|---|---|---|
| pacing/rychlost | `node scripts/motion_probe.mjs` | rozdělení rychlosti bruslařů, % času na top, odstup nosiče |
| chaos botů | `node scripts/role_churn.mjs` | přepnutí režimu bota / min (cukání) |
| přihrávky do jízdy | `FH_LEADK=x node scripts/pass_test.mjs` | % převzatých příjemcem v plné jízdě |
| balanc (rubrika) | `node test/balance-metrics.mjs` | góly, konverze, save %, stall, 1v1, chaos |
| plynulost sítě | `node scripts/test_netsmooth.mjs` | stalls/jump/latence dle profilu jitteru (vč. TCP HoL) |

---

## 1) POHYB — stav a nejlepší cesta

**Měřeno (motion_probe, 10 zápasů):**
- Prům. rychlost bruslaře **133 px/s = 74 % top** (top = 180).
- Rozdělení rychlosti (koše 0-20/20-40/40-60/60-80/80-100 %): **3 / 6 / 15 / 34 / 42 %** → 76 % času nad 60 % top, 42 % v nejvyšším koši.
- Skoro nikdy nezpomalí: <25 % top jen **4,1 %** času, skoro stojí **0,5 %**.

**Kořen problému (kód):** ovládání je **binární, 8 směrů** — `applyClientInput` kvantuje směr na −1/0/1 (`dir1`), hráč pak jede **plnou rychlostí, nebo stojí** (brzda = Space). Není analogová rychlost → **kličku fyzicky nejde odjet pomalu/kontrolovaně.** To je hlavní důvod „žádné kličky, žádný prostor".

**Nejlepší cesta (doporučeno):** přidat **ovládání rychlosti**, ne zrychlovat/zpomalovat celou hru.
1. **Modifikátor „kontrola" (držené tlačítko, např. Shift nebo pravý klik bez puku→s pukem):** drží → bruslař jede na ~55 % top a hole/puk blíž u těla → prostor na kličku a ochrana puku. Pustí → plná rychlost. Deterministické: přidat `inp.ctrl`, v `Player.update` cap rychlosti × 0.55 a zúžit carry-úhel.
2. **Analogová rychlost z gamepadu** (stick) — kdo má gamepad; klávesnice zůstane binární. Větší práce.

Doporučuju **(1)** — malý zásah (`Player.update` + 1 vstupní bit), měřitelný (motion_probe: má klesnout % času v top koši a vzrůst čas pod 60 %), a dává skill-strop (kličky), aniž rozbije balanc (rychlost je volba hráče, ne globální zpomalení).

---

## 2) RYCHLOST / PACING — proč globální zpomalení NEJDE

**Měřeno (balance-metrics, FH_TEMPO sweep):**

| TEMPO | góly | konverze | bot 1v1 /10 | home/away | verdikt |
|---|---|---|---|---|---|
| 1.00 | 6.2 | 18 % | 8 ✓ | 1.35 ✓ | baseline |
| 0.90 | 5.0 | 16 % | **7 ✗** | **1.70 ✗** | rozbito |
| 0.82 | 4.2 | **14 % ✗** | 9 ✓ | **1.95 ✗** | rozbito |

**Závěr:** zpomalit celou hru (TEMPO) **rozbije rubriku** už při 0.90 — bot přestane skórovat 1v1 a rozhodí se výhoda strany (home/away). „Klid" tedy **nejde** nasypat globálně.

**Nejlepší cesta:** pacing řešit **chováním, ne časem** — bruslaři mají *umět* zpomalit (viz sekce 1 pro hráče; sekce 3 pro boty). Rychlost ať je **volba** v daném okamžiku, ne konstanta. Tím se sníží % času v top koši (frantičnost) bez zásahu do scoring dynamiky.

---

## 3) BOTI — stav a nejlepší cesta

**Měřeno:**
- Chaos: přepnutí režimu **46 → 36 /min** po hysterezi honiče (−22 %, už nasazeno). Zbytek je z velké části legitimní změna držení (ne cukání).
- Přihrávky do jízdy (pass_test, příjemce v plné rychlosti): **LEAD_K 0.70 = 92 %** převzatých; **víc vedení je HORŠÍ** (0.85→75 %, 1.0→42 %). Takže „lítá za tebe" **není málo vedení** — puk dorazí *těsně za* a započítá se jako převzatý, ale ne **do stride na hokejku**.
- Pacing botů: boti jedou binárně plným směrem → drží top speed stejně jako měří sekce 1.

**Problémy a nejlepší cesty:**

a) **„Přihrávka nedorazí do stride" (lítá za tebe).** Není to lead — je to, že puk dorazí mírně vzadu a pomalu. Deterministická cesta: měřit **offset dopadu vůči dráze příjemce** (ne jen „převzato do 2 s") a cílit přihrávku na **budoucí pozici hokejky**, ne těla, + mírně **svižnější pas na krátko** (arrival-speed, ne lead). Nová metrika do `pass_test` (vzdálenost dopadu od příjemcovy čepele v okamžiku příjmu), pak ladit cílový bod a rychlost, ne LEAD_K.

b) **Boti bez strategie / full speed.** Nejlepší cesta: **modulace rychlosti botů** (stejná mechanika jako hráč, sekce 1): honič burst, podpora/obrana **cruise na ~60 %**, nosič pod tlakem **zpomalí a změní směr** (klička místo přímé jízdy do obránce). Měřit motion_probe (má klesnout top-koš) + balance (musí zůstat v rubrice).

c) **Hloubka (klička/rozehra).** Boti teď jedou přímkou k cíli. Přidat **nosiči hesitation**: když je obránce v ose, krátce zpomal + uhni stranou (deke), až pak zrychli. Deterministické, seedované; měřit konverzi a stall (nesmí růst nad rubriku).

---

## 4) NETCODE — stav a nejlepší cesta

**Měřeno (test_netsmooth + reálná telemetrie /api/netstat):**
- FPS 80 OK; trhání = **opakované stalls 5–17/okno, snapMax 45–59 ms**, buffer se nafukuje 90→138.
- Kalibrovaný TCP-HoL profil: buffer floor 90 → **27 stalls**; 130 → 19; 150 → 14. Cap jitter špiček 80 ms = 0 efekt.
- **Příčina = TCP head-of-line blocking** (socket.io/WebSocket): ztráta paketu zablokuje vše do retransmitu → burst → trhnutí. Potvrzeno rešerší (Gaffer, WebRTC-vs-WS). **Buffer to jen tlumí, nezabije** — a je to výměna plynulost↔latence (proto „oboje plynule" na TCP nejde).

**Nejlepší cesta (pořádný netcode):** **WebTransport** (HTTP/3 / QUIC) pro pohybová data = **datagramy, unordered, bez retransmitu → žádný HoL**. WebSocket nechat jen na spolehlivé věci (lobby, chat, skóre). Klient: zkus WebTransport, fallback na WebSocket.
- Klient: `new WebTransport(url)` — Chrome plně (tvůj cíl); posílat vstup/snapshoty jako datagramy.
- Server (Node): WebTransport lib (QUIC endpoint na UDP portu) vedle Express/socket.io.
- **Infra (tvoje/VPS):** otevřít **UDP port** v Oracle security listu + firewallu; **TLS cert** pro QUIC (sdílet s Caddy certem nebo serverCertificateHashes). Caddy WebTransport neproxuje — Node termuje QUIC sám.

**Pozn.:** lokální offline režim pro bot-zápasy (hotový, `match-core.js`) dává 0 latence a 0 trhání, ale **ruší joinability** → proto `HRÁT` vrácen na online lobby. Offline kód zůstává jako hotová schopnost pro případný „Trénink".

---

## Doporučené pořadí (podle poměru zábava/práce)

1. **Modifikátor „kontrola" (rychlost hráče)** — malý zásah, velký skok v pocitu (kličky, prostor, ochrana puku). Sekce 1.
2. **Modulace rychlosti botů + hesitation nosiče** — zabije „full speed/žádná strategie". Sekce 3b/3c. Měřit proti rubrice.
3. **Přihrávka do stride** — nová metrika + cílení na čepel/arrival-speed. Sekce 3a.
4. **WebTransport netcode** — velký kus + VPS infra; řeší online plynulost natrvalo. Sekce 4.

Každý krok: změř PŘED/PO uvedenými skripty, nepouštěj do prod, co není v rubrice.
