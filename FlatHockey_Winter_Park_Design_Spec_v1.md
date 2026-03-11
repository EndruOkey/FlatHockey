# FLATHOCKEY -- WINTER PARK DESIGN SPEC (v1)

## ARCHITEKTURA SVĚTA

### Globální koncept

-   Hráč má pocit jednoho globálního Winter Parku.
-   Reálně běží více instancí parku.

### Instance pravidla

-   1 instance = max \~25 hráčů
-   Instance se vytváří automaticky při naplnění
-   Friends / party mají vždy prioritu být spolu
-   Přesun mezi instancemi jen mimo aktivní hru (reset fáze)

------------------------------------------------------------------------

## HLAVNÍ POND (Srdce parku)

### Struktura

-   Jedno hřiště
-   Lehce větší než viewport (okraje mírně mimo obraz)
-   Fixní kamera + jemný mikropohyb
-   Jeden puk

### Pravidla

-   Street hockey (žádný ofsajd, icing)
-   Gól → mechanické počítadlo (do 10)
-   Po 10 → reset setu
-   Po gólu:
    -   automatický reposition hráčů do středu
    -   možnost odejít z ledu
    -   týmové vyvážení

------------------------------------------------------------------------

## TÝMY

### Soft týmový systém

-   Určení podle strany / balancing
-   Outline barva (jemná)
-   Nerovnováha → automatické vyvážení při resetu
-   Výběr hráče pro přesun:
    1.  Nejnovější
    2.  Nejmenší zapojení
    3.  Náhodně

------------------------------------------------------------------------

## GÓLMAN NA PONDU

-   Žádný AI
-   Hráč může stát v bráně
-   V brankovišti:
    -   lehce větší blokovací zóna
    -   mírně stabilnější kolize
-   Žádné role lock

------------------------------------------------------------------------

## POHYB

### Základ

-   Ledová fyzika (setrvačnost)
-   Aktivní brzda (musíš zpomalit před změnou směru)
-   Sprint se stamina
-   Sprint slabší s pukem
-   S pukem lehce pomalejší pohyb

### Kolize

-   Lehký fyzikální odraz
-   Žádný knockdown
-   Žádný stun spam

------------------------------------------------------------------------

## ÚTOK

### Levé tlačítko

-   Klik → quick shot / dump
-   Držení → nabíjení
-   Pravým tlačítkem lze cancelnout charge
-   Nabíjení lehce zpomaluje hráče
-   Střela je přesná (bez RNG)

### Puk

-   Soft magnet k hokejce
-   Není přilepený
-   Při chybě můžeš přijít o kontrolu

------------------------------------------------------------------------

## OBRANA

### Pravé tlačítko bez puku

-   Obranný reach
-   Lehký assist na vypíchnutí
-   Zpomalení během aktivace
-   Recovery při neúspěchu

------------------------------------------------------------------------

## UI & SOCIAL

### Jména

-   Nad hlavou
-   Dynamická velikost podle vzdálenosti
-   Jemná týmová barva
-   Žádný UI spam

### Voice

-   Proximity voice
-   Default OFF
-   Push-to-talk
-   Mute / volume per player

------------------------------------------------------------------------

## DOMEK

-   Součást mapy (bez loadingu)
-   Veřejný prostor
-   Šatna + shop
-   Jiná akustika než venku

------------------------------------------------------------------------

## KOMPET (Oddělené portálem)

-   AI gólman
-   Ofsajd / strukturovanější pravidla
-   1v1 / 2v2 (budoucí 5v5)
-   Stejná fyzika jako pond

------------------------------------------------------------------------

## DESIGN FILOZOFIE

-   Casual-first
-   Skill puck control
-   Kombinační tempo
-   Žádné chaos mechaniky
-   Žádné esport přehánění
-   Živý social svět
