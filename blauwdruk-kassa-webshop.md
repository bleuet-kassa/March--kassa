# Blauwdruk — Kassa-, stock- & webshopsysteem

**Voor:** Yoran & Pieter-jan
**Type zaak:** Voedings-/traiteurwinkel + wijnwinkel (retail, België)
**Taal van het systeem:** Nederlands
**Datum:** 27 juli 2026

Dit document is de gemeenschappelijke leidraad. Het beschrijft *wat* we bouwen, *hoe* het in elkaar zit, wat *wettelijk* moet, en in *welke volgorde* we het aanpakken. Het is bedoeld om samen te delen en bij te werken.

---

## 1. Visie in het kort

Eén centraal systeem waar de **voorraad** de spil is. Dezelfde producten en dezelfde stock worden gebruikt door de **kassa in de winkel**, door het **beheer** (inkoop, prijzen, rapporten) én door de **publieke webshop**. Alles draait op een **centrale server**, is bereikbaar via de browser op **pc en mobiel**, en werkt met **barcodes**. Facturatie, kasboek en boekhouding bouwen we niet zelf — die **koppelen** we aan Scrada en MyZen.

Kernprincipe: *één product, voorraad per locatie, overal zichtbaar.* Een verkoop aan de kassa en een bestelling in de webshop verlagen de stock van de juiste locatie.

**Meerdere fysieke stocklocaties.** Er zijn minstens twee locaties: de **winkel** en het **restaurant**. Voorraad wordt dus *per locatie* bijgehouden, met **verplaatsingen** ertussen (bv. wijn die van de winkelstock naar het restaurant gaat). De **kassa is voorlopig enkel voor de winkel** — het restaurant heeft (nog) geen kassa in dit systeem. (Het restaurant is horeca; mócht daar ooit een kassa bijkomen voor consumptie ter plaatse, dan komt de GKS/witte-kassa-verplichting daar apart in beeld — los van dit winkelsysteem.)

### 1b. Twee ondernemingen: import + winkel

Een deel van de wijn wordt **geïmporteerd via een tweede onderneming** (ander ondernemingsnummer). Het systeem is dus **multi-onderneming**:

- **Import-onderneming** (ondernemingsnummer A): importeert wijn, plaatst **importbestellingen** bij buitenlandse leveranciers, en **verkoopt** door — zowel aan "onze winkel" (intercompany) als aan **andere klanten** (B2B/groothandel). Elke klant kan een eigen verkoopprijs krijgen.
- **Winkel** (ondernemingsnummer B): de retailzaak met kassa + webshop, die o.a. bij de import-onderneming inkoopt.

Gevolgen voor het systeem:

- **Importbestellingen** worden vanuit het systeem opgemaakt en **gepusht** naar de leverancier; bij ontvangst verhoogt de importstock.
- **Verkoopprijzen per klant(groep)**: één prijs "aan onze winkel", andere prijzen aan externe klanten — beheerd via **prijslijsten**.
- De verkoop van A → B is een **echte B2B-verkoop tussen twee BTW-entiteiten**: voor A een verkoopfactuur (via Scrada/Peppol), voor B een inkoop die de winkelstock verhoogt. Geen dubbele boekhouding, wél een correcte intercompany-factuur.
- Elke onderneming heeft een **eigen BTW-nummer en eigen facturatie/boekhouding** (elk gekoppeld aan Scrada/MyZen).

---

## 2. Modules

- **Stockbeheer** (kern, bouwt voort op het wijnstock-programma): producten, voorraadstanden **per locatie** (winkel/restaurant), leveranciers, inkoop/ontvangst, **verplaatsingen tussen locaties**, minimumdrempels en bestelsuggesties.
- **Kassa (POS)**: verkopen scannen, afrekenen, meerdere betaalwijzen, ticket, dagafsluiting.
- **Barcodes**: scannen aan de kassa en bij ontvangst; eigen barcodes printen voor producten zonder EAN (bv. losse wijn, traiteur per gewicht).
- **Webshop**: publieke website met dezelfde catalogus en stock, bestellen + betalen, afhalen/leveren.
- **Klanten & relaties**: klantfiches, eventueel klantenkaart/getrouwheid, B2B-klanten (horeca/bedrijven) voor facturen.
- **Import & groothandel** (import-onderneming): importbestellingen aanmaken en pushen, landed cost (aankoop + accijns + douane + transport), doorverkoop aan de winkel en externe B2B-klanten.
- **Prijslijsten**: verkoopprijzen per klant of klantgroep (intercompany naar de eigen winkel, en aparte prijzen voor externe klanten).
- **Rapportage**: omzet per dag/tarief, best verkochte producten, marges, voorraadwaarde.
- **Koppelingen**: Scrada (facturatie/kasboek/Peppol), MyZen (boekhouding), betaalprovider, hardware.

---

## 3. Architectuur

Eén centrale server met één database, en drie "gezichten" die er allemaal op praten:

```
                     ┌─────────────────────────────┐
                     │      CENTRALE SERVER         │
                     │   (API + database)           │
                     │  producten · stock · verkoop │
                     │  klanten · webshop-orders     │
                     └──────────────┬──────────────┘
                                    │  (beveiligde API)
        ┌───────────────────────────┼───────────────────────────┐
        │                           │                           │
┌───────▼────────┐        ┌─────────▼────────┐        ┌─────────▼────────┐
│  KASSA-app      │        │  BEHEER-app       │        │  WEBSHOP          │
│  (pc + tablet)  │        │  (pc + mobiel)    │        │  (publiek)        │
│  scannen,       │        │  stock, prijzen,  │        │  catalogus,       │
│  afrekenen      │        │  rapporten        │        │  bestellen        │
└────────────────┘        └──────────────────┘        └──────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
              ┌───────────┐                   ┌───────────┐
              │  SCRADA    │                   │   MYZEN    │
              │ facturen,  │──────────────────▶│ boekhouding│
              │ kasboek,   │  (doorstroom)     └───────────┘
              │ Peppol     │
              └───────────┘
```

Belangrijk: de kassa- en beheer-app zijn **web-apps (PWA)** — geen aparte installatie nodig, werken in de browser op pc, tablet en gsm, en kunnen kort **offline** doorwerken als het internet even wegvalt (transacties worden lokaal bewaard en gesynchroniseerd zodra de verbinding terug is). Dat is voor een kassa essentieel.

---

## 4. Aanbevolen tech-stack (voorstel, nog te bevestigen)

Dit is een aanbeveling op basis van jullie eisen (centraal, web + mobiel, webshop, EU/GDPR). Alles is open voor overleg — vooral als het wijnstock-programma al in een bepaalde taal staat, houden we daar rekening mee.

- **Backend / server:** één API-service. Voorstel: Node.js (NestJS) of Python (Django/FastAPI). Beide zijn robuust en hebben goede Scrada/Peppol- en betaalkoppelingen.
- **Database:** PostgreSQL — betrouwbaar, sterk in voorraad/transacties, gratis.
- **Frontend (kassa + beheer):** één web-app als PWA (bv. React of Vue), Nederlandstalig, met offline-buffer voor de kassa.
- **Webshop:** deelt dezelfde database/API. Kan als tweede front-end in hetzelfde project, of een gespecialiseerd webshop-platform dat op onze stock-API koppelt.
- **Hosting:** EU-gebaseerde cloud (GDPR) — bv. een Belgische/Europese provider of Hetzner/OVH. Dagelijkse back-ups.
- **Hardware:** USB-barcodescanner (werkt als toetsenbord — geen driver nodig), bonprinter (ESC/POS), kassalade, optioneel weegschaal voor traiteur.

Beslispunt: bouwen we de webshop *in* hetzelfde project, of nemen we een bestaand webshop-platform dat op onze API koppelt? (Zie §9.)

---

## 5. Datamodel (kern)

De belangrijkste gegevens en hoe ze samenhangen:

- **Product**: naam, interne code, **barcode/EAN**, **BTW-tarief** (6% voeding / 21% alcohol), verkoopprijs, inkoopprijs, leverancier, categorie, is-alcohol (ja/nee → leeftijdscontrole), eenheid (stuk/kg), allergenen/etiketinfo.
- **Stocklocatie**: bv. winkel en restaurant (uitbreidbaar naar magazijn). Elke locatie heeft zijn eigen voorraadstanden.
- **Voorraad**: stand per product **per locatie**, minimumdrempel per locatie.
- **Voorraadverplaatsing**: verplaatsing van een product van de ene locatie naar de andere (verlaagt bron, verhoogt bestemming; traceerbaar).
- **Leverancier**: contact, leveringen, inkoopvoorwaarden.
- **Inkoop/ontvangst**: binnenkomende goederen → verhoogt stock.
- **Verkoop (ticket)**: lijnen met product, aantal, prijs, BTW per lijn; betaalwijze(s); tijdstip; verkoper. Verlaagt stock. Onwijzigbaar bewaard.
- **Webshop-order**: zelfde principe als een verkoop, met klant, leverwijze (afhalen/leveren), status, betaling. Verlaagt dezelfde stock.
- **Onderneming/entiteit**: import-onderneming (A) en winkel (B), elk met eigen ondernemings-/BTW-nummer en eigen facturatie/boekhouding. Stock en verkopen hangen aan een entiteit + locatie.
- **Prijslijst / klantprijs**: verkoopprijs van een product per klant of klantgroep (intercompany vs. externe B2B vs. retail).
- **Importbestelling**: bestelling van de import-onderneming bij een (buitenlandse) leverancier; pushbaar; verhoogt bij ontvangst de importstock; draagt landed cost (accijns/douane/transport).
- **Klant**: particulier of B2B (met BTW-nummer, voor Peppol-facturen via Scrada). B2B-klanten van de import-onderneming kunnen een eigen prijslijst hebben.
- **Gebruiker/medewerker**: login, rol (kassa/beheer/beheerder), voor traceerbaarheid.
- **BTW-tarief**: als aparte tabel, zodat een tariefwijziging (zoals de hervorming van 1 maart 2026) centraal aanpasbaar is.

---

## 6. Wettelijke eisen — ingebouwd

Retail voedings-/wijnwinkel in België (géén GKS/witte kassa nodig — dat is horeca voor consumptie ter plaatse). Wat het systeem wél correct moet doen:

- **Meerdere BTW-tarieven per ticket.** Voeding 6%, wijn/alcohol 21%. Het ticket/factuur splitst BTW per tarief uit. Tarieven centraal beheerd (i.v.m. hervorming maart 2026).
- **E-facturatie via Peppol** (verplicht B2B sinds 1 jan 2026): niet zelf bouwen — verkopen aan bedrijven/horeca gaan via **Scrada** als gestructureerde e-factuur.
- **Kasboek & boekhouding**: verkoopdata stroomt naar **Scrada** (kasboek) en **MyZen** (boekhouding). Geen dubbele invoer — enkel koppelen.
- **Cash-limiet €3.000** en **prijzen incl. BTW** duidelijk zichtbaar voor consumenten.
- **Alcohol = leeftijdscontrole**: producten met "is-alcohol" vragen bevestiging aan de kassa; in de webshop een leeftijdscheck bij afrekenen (wijn/bier niet aan -16, sterke drank niet aan -18).
- **Bewaarplicht 7 jaar**: verkopen worden onwijzigbaar en traceerbaar bewaard (geen stille verwijderingen; correcties als tegenboeking).
- **Webshop**: herroepingsrecht 14 dagen (bederfbare voeding uitgezonderd, wijn niet), GDPR voor klantgegevens, allergenen-/etiketinfo bij voeding.
- **Invoer van wijn (import-onderneming)**: wijn is een **accijnsgoed**. Bij invoer komen **accijns + BTW** kijken; die kosten horen in de **landed cost/inkoopprijs**. Concrete afhandeling gebeurt met de boekhouder/Scrada — het systeem moet deze kosten enkel kunnen dragen en tonen.
- **Intercompany-facturatie**: verkoop van de import-onderneming aan de eigen winkel is een gewone B2B-verkoop tussen twee BTW-entiteiten → correcte factuur via Scrada/Peppol, geen dubbele boeking.

---

## 7. Koppelingen (integraties)

- **Scrada** — facturatie, kasboek, Peppol. Heeft een publieke API en koppelt al met kassasystemen. Onze taak: verkopen "Scrada-klaar" aanleveren (per lijn BTW-tarief, klant, betaalwijze).
- **MyZen** — boekhouding. Wordt normaal gevoed via Scrada; exacte koppeling nog te bevestigen (rechtstreeks of via Scrada).
- **Betaalprovider** — voor de webshop en eventueel Bancontact/Payconiq aan de kassa (bv. Mollie of een terminalkoppeling).
- **Hardware** — barcodescanner, bonprinter, kassalade, (optioneel) weegschaal.

---

## 8. Gefaseerd stappenplan

Elke fase levert iets bruikbaars op. We bouwen bovenop het bestaande wijnstock-programma.

1. **Fase 0 — Fundament.** Centrale server, database, gebruikers/login, basis-productmodel met barcode en BTW-tarief.
2. **Fase 1 — Stockbeheer + barcodes.** Wijnstock-logica uitbreiden: producten, voorraad, leveranciers, ontvangst, scannen, eigen barcodes printen.
3. **Fase 2 — Kassa.** Scannen, afrekenen, meerdere betaalwijzen, ticket met BTW-uitsplitsing, dagafsluiting, offline-buffer, alcohol-leeftijdscheck.
4. **Fase 3 — Scrada-koppeling.** Verkopen automatisch doorsturen (facturen/kasboek/Peppol). MyZen-doorstroom bevestigen.
5. **Fase 4 — Webshop.** Publieke catalogus op dezelfde stock, bestellen + betalen, afhalen/leveren, leeftijdscontrole, herroeping/GDPR.
6. **Fase 5 — Import & groothandel.** Tweede onderneming toevoegen: importbestellingen pushen, landed cost, prijslijsten per klant, intercompany-verkoop A → winkel via Scrada, verkoop aan externe B2B-klanten.
7. **Fase 6 — Rapportage.** Omzet per dag/tarief, topproducten, marges, voorraadwaarde, bestelsuggesties.
8. **Fase 7 (laatste) — Samenvoegen met Pieter-jan's assistent.** Zijn programma (dat meer als assistent dient) koppelen/integreren als sluitstuk.

---

## 9. Openstaande beslissingen

- **Tech-stack** definitief kiezen (§4) — hangt mee af van de taal van het huidige wijnstock-programma.
- **Webshop**: zelf bouwen in hetzelfde project, of bestaand platform op onze API koppelen?
- **Betaalprovider** kiezen (kassa-terminal en/of online).
- **MyZen-koppeling**: rechtstreeks of volledig via Scrada?
- **Hosting** en back-up-provider (EU/GDPR) kiezen.
- **Traiteur-specifiek**: verkoop per gewicht (weegschaal) nodig? Bevestigen dat er nergens consumptie ter plaatse is (anders komt GKS toch in beeld).
- **Import/accijns**: hoe worden accijns en douane concreet in de kostprijs verrekend (met boekhouder/Scrada)? Importeren jullie intra-EU of ook van buiten de EU?
- **Prijslijsten**: welke klantgroepen bestaan er (eigen winkel, horeca, wederverkopers…) en hebben die vaste prijzen of kortingen?
- **Elke entiteit eigen Scrada/MyZen-koppeling**: bevestigen dat import-onderneming en winkel elk hun eigen facturatie/boekhouding-koppeling krijgen.
