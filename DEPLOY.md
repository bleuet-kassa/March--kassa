# De kassa online zetten (Render, EU-regio)

Deze handleiding brengt de kassa + website online op **Render** met een beheerde
PostgreSQL-database. De backend serveert zowel de **API** (`/api/...`) als de
**website** (kassa op `/kassa`, publieke site op `/`). Regio **Frankfurt** (EU).

> De lokale opzet blijft ondertussen gewoon werken. Alle productie-gedrag is
> afhankelijk van `NODE_ENV=production`, dus lokaal verandert er niets.

---

## Wat er al klaar is (stap 1 — code productieklaar)
- `Dockerfile` — bouwt website + backend tot één image die alles serveert.
- `render.yaml` — Render-blueprint: database + server in één keer.
- `backend` — API komt in productie onder `/api`; serveert de gebouwde website.
- `.dockerignore`, `.gitignore` — nette, veilige build.
- Lokaal getest: website, `/kassa`, `/api` en de JS-bundel werken op één service. ✅

---

## Stap 2 — Code op GitHub zetten
Render deployt vanaf een Git-repository.
1. Maak (indien nodig) een gratis account op https://github.com
2. Maak een **nieuwe, privé** repository, bv. `bleuet-kassa` (leeg, zonder README).
3. Vanaf deze map (`kassa-systeem`) de code pushen — de exacte commando's geef ik
   je klaar op het moment zelf (git init → commit → push naar jouw repo).

## Stap 3 — Deployen op Render
1. Maak een account op https://render.com (kies EU-regio waar gevraagd).
2. **New + → Blueprint** → koppel je GitHub-repo → Render leest `render.yaml`.
3. Render maakt automatisch aan:
   - **kassa-db** — beheerde PostgreSQL (Frankfurt), met dagelijkse back-ups.
   - **kassa** — de webservice (bouwt de Dockerfile).
4. `AUTH_SECRET` wordt automatisch gegenereerd; `DATABASE_URL` automatisch gekoppeld.
5. Eerste deploy: Render bouwt de image en past de database-migraties toe
   (`prisma migrate deploy`). Na een paar minuten krijg je een adres zoals
   `https://kassa-xxxx.onrender.com`.

> Plannen kies je in het dashboard. Richtprijs: kleine database + kleine
> webservice ≈ **$14/maand**. (Een gratis database bestaat, maar verloopt/pauzeert
> — voor een winkel raad ik het kleinste betaalde plan aan.)

## Stap 4 — Bestaande gegevens verhuizen
De producten, verkopen en dagafsluitingen van de laptop naar de online database.
- Ik maak een export van de lokale database (`pg_dump`) en laad die in de
  Render-database (via de externe connectie-URL die Render geeft).
- Dit doen we samen; de online database heeft dan al de juiste structuur
  (uit de migraties), ik laad enkel de gegevens in.

## Stap 5 — Eigen domein koppelen (via Combell)
1. In Render bij de webservice: **Settings → Custom Domains → Add** je domein
   (bv. `www.jouwdomein.be` en `jouwdomein.be`).
2. Render toont dan de DNS-records die je moet instellen.
3. Bij **Combell** (waar je domein staat): DNS-beheer openen en die records
   toevoegen (een `CNAME` voor `www` en een `A`/`ALIAS` voor het kale domein).
   De exacte waarden geef ik je door zodra we bij deze stap zijn.
4. Render regelt automatisch **HTTPS** (gratis certificaat).

## Stap 6 — Kassa-PC en toestellen omschakelen
- Op de kassa-PC en andere toestellen open je voortaan het **online adres**
  (`https://jouwdomein.be/kassa`) i.p.v. `http://192.168.0.223:5173/kassa`.
- De lokale laptop-server is dan niet meer nodig voor de kassa.
- Gebruik op de kassa-PC een **recente browser** (Chrome of Edge).

---

## Belangrijk / aandachtspunten
- **Internet nodig:** met een online server heeft de winkel internet nodig om te
  verkopen. De app buffert korte onderbrekingen, maar bij een lange storing valt
  de kassa stil. (Zorg eventueel voor een 4G-back-up in de winkel.)
- **Geheimen:** `AUTH_SECRET`, `DATABASE_URL` en eventuele API-sleutels (Scrada,
  Axepta) vul jíj in het Render-dashboard in — ik zie of bewaar die niet.
- **Gegevens in de EU:** database en server staan in Frankfurt (GDPR).
- **Back-ups:** Render maakt automatische database-back-ups.
