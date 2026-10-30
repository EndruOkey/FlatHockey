# FlatHockey — připravenost na alpha launch (2026-10-30)

Shrnutí z 9 analýz (web-audit, průchod obrazovek, tutoriál, průběh zápasu, 3× útok na hru, fyzika, klient) + ručního hraní. Značky: **[měřeno]** = ověřeno během testu, **[kód]** = z kódu, **[odhad]**.

---

## A. Opraveno a nasazeno během této relace (ověřeno)

| Oblast | Co bylo špatně | Stav |
|---|---|---|
| **Pád serveru (DoS)** | jedna zpráva `lobby:create` bez dat shodila celý server pro všechny [měřeno] | opraveno, handlery v try/catch, `test:…` |
| Dvojí nákup | 2 souběžné nákupy koupily 2 věci za 1 cenu [kód] | transakce, `test:buy` |
| XSS v žebříčku | jméno hráče se vkládalo bez escapu | escapováno, ověřeno |
| Pád ukládání profilu | prázdné číslo dresu → chyba 500 při otevření šatny [měřeno] | opraveno |
| Farmení skóre | gól po konci, vlastní gól a bot se počítaly jako gól [měřeno] | opraveno, `test:scorehack` |
| Farmení odměn | odměna za připojení před koncem; 2 záložky = dvojí kredity [kód] | jen hráči od startu, 1 účet 1× |
| Zaseknutá záložka | hráč jel donekonečna jedním směrem [měřeno] | po 300 ms bez vstupu zastaví |
| (dřívější vlny) | visící API, pád úvodní stránky, brankář, puk u brány, limity požadavků, determinismus, účty | opraveno |

---

## B. MUSÍ se vyřešit před alpha (chyby, které potká běžný hráč)

1. **Mobil je nehratelný.** Na 390 px je kluziště zúžené na proužek, záložky STORE/STATS jsou mimo obrazovku a nejsou dotykové ovladače [měřeno]. Hra je na myš+klávesnici. **Minimum: na mobilu zobrazit hlášku „Hraj na počítači" místo rozbité hry.** Portály (CrazyGames) posílají hodně mobilních hráčů.
2. **Tutoriál učí špatné tlačítko pro přihrávku.** Říká „vystřel levým", ve skutečné hře se přihrává pravým [kód, game.js]. První, co se hráč naučí, je špatně.
3. **Z tutoriálu nejde odejít.** Chybí „Přeskočit". Když hráč odejde dřív, příště začne znovu od začátku [měřeno].
4. **Vložená verze pořád ukazuje přihlášení přes Discord.** Dvě tlačítka zůstala viditelná, kliknutí otevře okno, které nejde zavřít Escapem [měřeno]. Na CrazyGames to porušuje jejich pravidla.
5. **Soukromé lobby se připojuje přes systémové okno prohlížeče** (`prompt()`), které je ve vložené verzi na portálech zablokované → na privátní hru se nedá dostat [měřeno].

## C. UX/UI — mělo by se vyřešit (kazí dojem, ne blokuje)

6. **Zprávy a chyby jsou neviditelné.** Hlášky „Lobby není dostupné", „zadej jméno", „kód zkopírován" se vykreslí schované pod horní lištou [měřeno]. Hráč nedostane žádnou zpětnou vazbu. → plovoucí „toast".
7. **Míchají se čeština a angličtina.** Na jedné obrazovce „WAITING ROOM / LOBBY / DOMÁCÍ / ODEJÍT"; výsledek zápasu, obchod a statistiky jsou natvrdo anglicky bez překladu; přepnutí na EN nepřepne tlačítko přihlášení [měřeno]. → sjednotit přes i18n.
8. **Nejednotné názvy téhož.** „JOIN ROOM / QUICK MATCH / BROWSE THE ARENA" je totéž; „VYTVOŘIT / CREATE ROOM / CREATE PRIVATE LOBBY" taky. „Quick match" přitom není rychlá hra, ale seznam lobby [měřeno].
9. **Obchod je slepá ulička.** Záložka STORE je „COMING SOON" s nulovým zůstatkem, i když se kredity ve hře vydělávají [měřeno]. → buď zprovoznit, nebo skrýt.
10. **Chybí Zpět a zavření Escapem.** Pohledy „procházet/vytvořit" nemají Zpět (jen HOME); Esc nezavře nastavení ani přihlašovací okno [měřeno].
11. **Skákání stránky při načtení** (CLS 0,5 — vysoké) [měřeno]. Úvodní obrazovka poskočí. → pevné rozměry prvků.
12. **Zarovnání úvodní obrazovky.** Popisek a tlačítko lepí na levý okraj, nadpis je na střed (nejednotná osa) [měřeno] — tvoje pravidlo „jedna osa".
13. **Po každém načtení skončíš na úvodní obrazovce** a host musí znovu klikat „Hrát jako host" [měřeno].
14. **Po tutoriálu není jasný další krok** (žádné tlačítko „Hrát proti botovi / Trénink") [kód].
15. **Výsledek zápasu ukazuje „+0 ⊙" bez ohledu na data; chybí tlačítko odvety** (jen automatická po 10 s) [kód].

## D. Herní vyvážení — rozhodnutí na tobě (není to chyba, je to návrh)

16. **Puk jde držet donekonečna.** S kurzorem u hráče je dosah hole malý a soupeř puk nesebere (98 % držení za 120 s, 0 odebrání) [měřeno]. → návrh: časový limit držení nebo snadnější odebrání tělem.
17. **Parkování v brankovišti.** Hráč stojící v brance zablokuje botovi 87 % střel [měřeno]. → bot by měl volit jinou střelu / přihrávku.
18. **Dlouhá tvrdá střela je moc silná** (40–60 % gólů z dálky) [měřeno]. → brankář by měl sledovat puk v letu, nebo přesnost klesá se vzdáleností.
19. **Boti mezi sebou** už dávají góly (15/20 zápasů po opravě), ale solo proti botovi jde pomalu farmit kredity [odhad].
20. **Pořadí kroků tutoriálu** (gól až na konci po pokročilých věcech) — návrh přeřazení je v analýze tutoriálu.

## E. Chybí / mezery (ne chyby)

- **Žádné prodloužení** — remíza se platí jako remíza [kód].
- **SEO a náhled odkazu** na flathockey.fun: chybí `og:image`, popis, favicon [měřeno]. Pro sdílení odkazu, ne pro portály.
- **CrazyGames: `CG_GAME_ID`** se nastaví na serveru až po nahrání hry; most SDK ověřit v jejich náhledu [kód].
- **Úklid hostů s 0 zápasy** z databáze (jinak rostou) [kód].
- **Žádná ochrana proti více účtům z jedné IP** nad rámec limitu 60/h [kód].

---

## Doporučené pořadí před alpha

1. **Blokátory (B):** mobil = hláška „jen na PC", tutoriál (přihrávka + Přeskočit), vložená verze (skrýt Discord, soukromé lobby bez `prompt()`). ~1 relace s agenty.
2. **Dojem (C):** toasty pro hlášky, i18n sjednocení, skrýt/zprovoznit obchod, Zpět+Esc, CLS. ~1 relace.
3. **Vyvážení (D):** vybereš, co měnit — hratelné už to je.
4. Pak nahrát na itch.io + CrazyGames (podklady a texty hotové v `release/`), nastavit `CG_GAME_ID`, spustit 14denní test.
