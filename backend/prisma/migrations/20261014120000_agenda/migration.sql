-- Agenda: manuele bestellingen/agendapunten + webshopbestellingen (exporteerbaar naar Excel).
CREATE TABLE IF NOT EXISTS "AgendaItem" (
  "id" TEXT NOT NULL,
  "dag" TEXT NOT NULL,
  "tijd" TEXT,
  "soort" TEXT NOT NULL DEFAULT 'AFSPRAAK',
  "bron" TEXT NOT NULL DEFAULT 'MANUEEL',
  "titel" TEXT NOT NULL,
  "omschrijving" TEXT,
  "klantNaam" TEXT,
  "klantTelefoon" TEXT,
  "klantEmail" TEXT,
  "bedrag" DECIMAL(10,2),
  "locatie" TEXT,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "verkoopId" TEXT,
  "aangemaaktDoor" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgendaItem_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AgendaItem_verkoopId_key" ON "AgendaItem"("verkoopId");
CREATE INDEX IF NOT EXISTS "AgendaItem_dag_idx" ON "AgendaItem"("dag");
