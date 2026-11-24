-- Terugkerende activiteiten in de agenda (AgendaHerhaling + AgendaItem.herhalingId).
-- Kwamen op 14/10/2026 in het schema, maar zonder migratie: zonder deze tabel en kolom
-- geeft een nieuw agendapunt een serverfout. Idempotent: verandert niets als ze al bestaan.
CREATE TABLE IF NOT EXISTS "AgendaHerhaling" (
    "id" TEXT NOT NULL,
    "titel" TEXT NOT NULL,
    "soort" TEXT NOT NULL DEFAULT 'AFSPRAAK',
    "categorie" TEXT,
    "locatie" TEXT,
    "tijd" TEXT,
    "omschrijving" TEXT,
    "klantNaam" TEXT,
    "frequentie" TEXT NOT NULL,
    "weekdagen" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "dagVanMaand" INTEGER,
    "start" TEXT NOT NULL,
    "einde" TEXT,
    "actief" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgendaHerhaling_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AgendaItem" ADD COLUMN IF NOT EXISTS "herhalingId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "AgendaItem_herhalingId_dag_key" ON "AgendaItem"("herhalingId", "dag");

DO $$ BEGIN
  ALTER TABLE "AgendaItem" ADD CONSTRAINT "AgendaItem_herhalingId_fkey" FOREIGN KEY ("herhalingId") REFERENCES "AgendaHerhaling"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
