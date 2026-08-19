# Kassa-, stock- & webshopsysteem

Startklaar projectskelet (Fase 0 — fundament). Zie `blauwdruk-kassa-webshop.md`
voor de volledige visie, wettelijke eisen en het stappenplan.

## Wat zit erin

```
kassa-systeem/
├─ backend/     NestJS-server (TypeScript) + Prisma-datamodel (PostgreSQL)
│  └─ prisma/schema.prisma   ← het volledige datamodel (producten, voorraad
│                              per locatie, ondernemingen, prijslijsten,
│                              verkopen, import ...)
├─ frontend/    React-app (TypeScript): kassascherm + beheer (uitbreidbaar
│               naar webshop)
├─ legacy/      map om het bestaande wijnstock-HTML in te droppen
└─ docker-compose.yml   lokale PostgreSQL-database
```

## Benodigdheden

- Node.js 20+
- Docker (voor de database), of een eigen PostgreSQL

## Opstarten (lokaal)

```bash
# 1. Database starten
docker compose up -d

# 2. Backend
cd backend
cp .env.example .env
npm install
npm run prisma:migrate      # maakt de tabellen aan
npm run seed                # vult een paar testproducten
npm run start:dev           # server op http://localhost:3000

# 3. Frontend (nieuwe terminal)
cd frontend
npm install
npm run dev                 # kassa op http://localhost:5173
```

Scan of typ een barcode (bv. `5410228000011`) op het kassascherm om te testen.

**Aanmelden (testomgeving):** de seed maakt twee verkopers aan —
`beheerder@winkel.be` en `kassa@winkel.be`, wachtwoord `kassa1234`. De verkoper
verschijnt op het ticket en bij de dagafsluiting. **Wijzig deze wachtwoorden voor
productie.**

**Kassa (Fase 2):** scannen met aantallen, betaalwijze, cash-teruggave +
€3.000-limiet, BTW-uitsplitsing, afdrukbaar ticket, alcohol-leeftijdscheck en een
**Dagafsluiting** (Z-rapport: totalen per betaalwijze en per BTW-tarief, wordt
onwijzigbaar vastgelegd).

## Wijnkelder importeren (echte catalogus)

De bestaande **wijnkelder**-app (localStorage) is geëxporteerd naar
`backend/prisma/data/wijnkelder-backup.json` (366 producten). Laad ze in de
centrale database met:

```bash
cd backend
npm run import:wijnkelder
```

Dit maakt per wijn een `Product` (met eigen in-store EAN-13-barcode, BTW per
type, inkoop- en voorlopige verkoopprijs) en zet de voorraad op de locatie
**Restaurant**. De import is *idempotent* (opnieuw draaien werkt bij, dupliceert
niet). Zie de kop van `prisma/import-wijnkelder.ts` voor de gemaakte keuzes
(barcodes, verkoopprijs, BTW-per-type, stocklocatie) en de aandachtspunten.

## Volgende stappen

- **Fase 1:** stockbeheer + barcodes verder uitbouwen (voortbouwend op de
  legacy-HTML).
- **Fase 2:** kassa afmaken (betaling, ticket, BTW-uitsplitsing, dagafsluiting).
- **Fase 3:** Scrada-koppeling (facturatie/Peppol/kasboek).
- **Fase 4:** webshop.
- Zie de blauwdruk voor de volledige fasering.
