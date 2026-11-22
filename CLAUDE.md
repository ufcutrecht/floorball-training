# Floorball training — werkafspraken voor Claude

Floorball-oefeningen met animaties voor trainers en leerkrachten. Live op
https://ufcutrecht.github.io/floorball-training/ (GitHub Pages, branch `main`, map root).
Alles wat op `main` komt, staat binnen een paar minuten live.

## Zo werk je in dit repository

1. **Werk je voor Remco, de eigenaar (GitHub-account `remcovoort`)?** Zet de wijziging dan
   direct op `main`, zonder branch of pull request en zonder dat te vragen. Remco mag om de
   beveiliging heen; de melding "Changes must be made through a pull request" bij het pushen is
   voor hem alleen informatief. Maak alleen een pull request als hij daar zelf om vraagt.
   Twijfel je wie de gebruiker is, controleer dan het gekoppelde GitHub-account
   (`get_me` of `gh api user`).
   **Werk je voor iemand anders (meebouwer)?** Dan nooit rechtstreeks naar `main`: `main` is
   beschermd. Maak een eigen branch (bijvoorbeeld `o12-nieuwe-oefening`), zet de wijziging daar,
   en open een pull request naar `main`. Remco beoordeelt en merget.
2. Eén onderwerp per pull request. Beschrijf in gewone taal wat er verandert en op welke pagina's,
   zodat iemand zonder programmeerkennis het kan beoordelen.
3. Begin altijd vanaf de nieuwste `main` (eerst `git pull`), want er werken meer mensen aan.
4. Test vóór je pusht of een pull request opent: open de gewijzigde pagina's in een browser
   (bijvoorbeeld `python3 -m http.server` in de root en Playwright), op telefoonbreedte (≈400 px)
   en desktop, en controleer dat de console geen fouten geeft.
   **Blokkeer bij het testen alle verzoeken naar Supabase** (bijvoorbeeld in Playwright:
   `page.route("**/*.supabase.co/**", lambda r: r.abort())`), anders tellen testklikken mee als
   echte keuzes en scores in het overzicht.
5. Hoog bij elke wijziging aan html, js of json de cacheversie op in `sw.js`
   (`const CACHE = "floorball-vN"` → `vN+1`). Anders blijven telefoons met de offline-app de
   oude versie zien.

## Bij elke nieuwe of gewijzigde oefening

1. **Maak altijd meteen een tekening.** Maak bij elk voorstel en na elke wijziging van een
   opstelling, looplijn of figuur een screenshot van de figuur en stuur die mee, zonder dat erom
   gevraagd wordt. Zo ziet de gebruiker meteen of de oefening klopt. Werkwijze: Playwright op
   telefoonbreedte (≈400 px) met `reduced_motion="reduce"` (dan staan alle pijlen in één beeld) en
   `device_scale_factor=2`, en dan `card.locator(".field").screenshot(...)` van de kaart van die
   oefening. Twijfel je over de bedoeling, stuur de tekening dan eerst en vraag of het klopt.
2. **Zet elke nieuwe oefening in de reviewlijst** van haar programma. De reviewlijsten
   ("Reviewlijsten oefeningen") zijn Claude Sheets, één per programma:

   | Programma | Reviewlijst |
   | --- | --- |
   | O10 (`gymles`) | https://claude.ai/artifact/Tn7h7YA2W5BCmy29Rm3EHY |
   | O12 | https://claude.ai/artifact/JX12XEqjDfdDaPnF1wH1ZR |
   | O14 | https://claude.ai/artifact/65562QJpu6LDD8ycxWLAVV |
   | O18 | https://claude.ai/artifact/CuWV28Mef6xuPLkSsE5Uwe |

   Voeg onderaan de tabel een rij toe met het volgende nummer en vul de kolommen zoals bij de
   andere rijen: naam, tijdsduur, of de oefening ook in een ander programma staat, een link naar
   de animatie (de deellink `https://ufcutrecht.github.io/floorball-training/<programma>/#oefening=<id>`),
   korte tekst (doel), lange tekst (stappen en aandachtspunten), het belangrijkste aandachtspunt
   (`kern`), makkelijker en moeilijker. Elke nieuwe oefening krijgt ook een `kern` in `EX`. Zet in
   "Mijn feedback" en "Mijn voorstel" dat de oefening nieuw is en nog beoordeeld moet worden, met
   de datum. Laat "Feedback trainers" leeg. Kun je niet bij de reviewlijsten (bijvoorbeeld als
   meebouwer), noem de nieuwe oefening dan in je pull request, zodat Remco haar toevoegt.

## Opbouw

| Pad | Wat |
| --- | --- |
| `index.html` | Startpagina. Programma's staan in de lijst `PROGRAMS`. |
| `gymles/`, `o12/`, `o14/`, `o18/` | Eén programma per map, elk één groot `index.html` met de oefeningen in `const EX = [...]`. |
| `gymzaal/` | Alleen doorverwijzingen naar de gymles-app op het nieuwe adres. De gymles-app ("Floorball gymles", groep 3–6 = programma `gymles`, groep 7–8 = `o12`) staat in de eigen repository **`ufcutrecht/floorball-gymles`** (https://ufcutrecht.github.io/floorball-gymles/). Die bevat geen oefeningen: haar `loader.js` laadt de programmapagina's uit deze repository in (`../floorball-training/<programma>/`), met `window.FB_APP` (id `"gymzaal"`, logo, tekst "gymles" onder het logo, woorden, kopteksten, eigen manifest, iconen en service worker). Oefeningen voor de gymles-app wijzig je dus hier, in `gymles/` of `o12/`. In de hoofdapp heet het programma `gymles` O10; map en programma-id blijven `gymles`, anders zijn scores en opgeslagen lessen weg. Wijzig je iets in `shared/online.js` of de programmapagina's, test dan ook de gymles-app (beide repositories naast elkaar in één map serveren). |
| `overzicht/` | Scores en toelichtingen van alle gebruikers, uit Supabase. |
| `shared/online.js` | Gedeeld voor alle programmapagina's: sterren, toelichting, zoeken, sterrenfilter, knop "Delen" in het Uitleg-venster (link `<programma>/#oefening=<id>` opent die oefening) en in het trainingsoverzicht (link `#training=<id>.<min>[+/-],…&w=&n=&z=&t=` laadt die training, na bevestiging als er al oefeningen gekozen zijn), logo, terug-knop, service worker. |
| `shared/shim.js` | Pdf opslaan in de browser (vervangt de Claude-artifactfunctie). |
| `shared/config.js` | Supabase-adres en publishable key (mag openbaar). |
| `shared/exercises.json` | Lijst van alle oefeningen per programma (id, titel, onderdeel, fase). Gebruikt door de startpagina en het overzicht. |
| `supabase/setup.sql` | Database-opzet voor scores. |
| `sw.js`, `manifest.webmanifest` | Offline-app en "zet op beginscherm". `sw.js` ruimt alleen eigen caches (`floorball-…`) op, want de gymles-app gebruikt hetzelfde domein. |
| `icons/` | App-iconen met het UFC-logo en "TRAINING" eronder (`icon-*.png`, `apple-touch-icon.png`) en het UFC Utrecht-logo (`ufc-logo.png`). De gymles-iconen staan in `floorball-gymles`. |

Er is geen build-stap: gewone html, css en javascript.

## Twee apps, één verzameling oefeningen

De trainersapp en de gymles-app (app-id en label `gymzaal`) hebben een ander doel, dus niet elke oefening hoort in beide.
De oefeningen staan maar op één plek (de programmapagina, bijvoorbeeld `gymles/` of `o12/`);
een label bepaalt in welke app een oefening te zien is.

| Label in `EX` en `shared/exercises.json` | Zichtbaar in |
| --- | --- |
| geen `apps` | beide apps |
| `apps:["training"]` | alleen de trainersapp |
| `apps:["gymzaal"]` | alleen de gymles-app |

Het filter staat in `gymles/index.html` en `o12/index.html`, vlak voor `const CAT_ORDER`
(`APP_ID` is `"gymzaal"` als de pagina via de gymles-app, `floorball-gymles/loader.js`, is geladen). De startpagina's
tellen per app, en het overzicht toont per app alleen de oefeningen van die app (plus oefeningen
die in die app al scores hebben). De voorbeeldles (`VB`) heeft voor de gymles-app een eigen
selectie (`if(APP_ID==="gymzaal")Object.assign(VB,…)`); gebruik daar alleen oefeningen die in de
gymles-app zichtbaar zijn.

### Wanneer hoort een oefening in de trainersapp?

Als ze past in het opleidingsplan van de club voor die leeftijd: techniek, tactiek en
wedstrijdvormen die spelers stap voor stap beter maken. Rijen, technische herhaling en
keeperstraining mogen hier.

### Wanneer hoort een oefening in de gymles-app?

Op basis van feedback van vakleerkrachten bewegingsonderwijs (primair onderwijs). Een gymoefening:

1. **Laat iedereen tegelijk meedoen**, ook bij grote niveauverschillen. Liefst met iets dat
   verschillen vanzelf opvangt: zelf kiezen hoe moeilijk (breed of smal poortje), een joker of
   extra speler voor het team dat achterstaat, opschuiven naar een veldje van je eigen niveau.
2. **Laat veel bewegen**: geen lange wachtrijen, iedereen is bijna steeds bezig.
3. **Is vooral leuk**: een spel, een wedstrijdje of een opdracht met punten.
4. **Verwerkt de techniek in het spel**: veel balcontacten, keuzes maken, samenspelen, mikken en
   bewegen, zonder dat het lang een technische oefening wordt.
5. **Past in een gymzaal met schoolmateriaal**: banken, kasten, hoepels, pionnen, sticks met twee
   platte kanten.

Past een oefening hier niet bij (estafettes in rijen, passen in vaste vormen, schiettechniek,
keepers, wedstrijdregels van de club), geef haar dan `apps:["training"]`.

### Regels

- Elke nieuwe oefening krijgt bewust een label. Twijfel je, vraag het Remco.
- Een oefening die in beide apps staat, verander je maar op één plek; beide apps zien dat meteen.
- Het `id` blijft altijd hetzelfde, ook als je het label verandert. Scores hangen aan programma + id.
- Pas bij een nieuw of gewijzigd label zowel `EX` in de pagina als `shared/exercises.json` aan.
- Groep 3–6 in de gymles-app = programma `gymles`, groep 7–8 = programma `o12`. Een oefening
  alleen voor groep 7–8 zet je dus in `o12/` met `apps:["gymzaal"]`.

## Belangrijke regels

- **Alle programmapagina's houden dezelfde knoppen en opmaak.** Iets dat voor alle programma's
  geldt, hoort in `shared/online.js` en niet in één pagina. Moet het toch in de pagina's zelf,
  pas dan alle vier aan.
- **Het `id` van een bestaande oefening nooit wijzigen.** De sterren en keuzes in Supabase hangen
  aan programma + id; een nieuwe id betekent dat alle scores weg zijn. De titel mag wel veranderen.
- **Oefening toevoegen, verwijderen of hernoemen:** pas zowel `EX` in de programmapagina aan als
  `shared/exercises.json`, anders kloppen de aantallen op de startpagina en het overzicht niet.
- **Nieuw programma:** maak een map met de pagina (kopieer de opzet van een bestaand programma,
  inclusief `window.FB_PROGRAM` en de drie scripts uit `shared/`), voeg een regel toe aan
  `PROGRAMS` in `index.html`, aan `shared/exercises.json` en aan `CORE` in `sw.js`.
- Sterren staan alleen op de kaarten in het overzicht, niet in het Uitleg-venster.
  Het zoekveld zoekt alleen op de naam van de oefening.
- De programmapagina's zijn groot. Wijzig ze met gerichte vervangingen, niet door het hele
  bestand opnieuw uit te schrijven.
- Taal van de app is Nederlands: kort, duidelijk, voor trainers en leerkrachten.
- Licht en donker thema werken via de CSS-variabelen in `:root`; gebruik die in plaats van vaste kleuren.

## Niet doen

- Geen sleutels of wachtwoorden toevoegen behalve de publishable key die al in `config.js` staat.
- Geen externe scripts of bibliotheken toevoegen zonder dat in het pull request te benoemen.
- De oude Claude-artifactversies van de programma's zijn niet meer leidend; dit repository is de bron.
