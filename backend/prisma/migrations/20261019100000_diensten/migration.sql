-- Uurroosters: geplande diensten per medewerker.
CREATE TABLE IF NOT EXISTS "Dienst" (
  "id" TEXT NOT NULL,
  "gebruikerId" TEXT NOT NULL,
  "dag" TEXT NOT NULL,
  "start" TEXT NOT NULL,
  "eind" TEXT NOT NULL,
  "pauzeMin" INTEGER NOT NULL DEFAULT 0,
  "locatie" TEXT,
  "opmerking" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Dienst_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Dienst_dag_idx" ON "Dienst"("dag");
CREATE INDEX IF NOT EXISTS "Dienst_gebruikerId_dag_idx" ON "Dienst"("gebruikerId", "dag");
DO $$ BEGIN
  ALTER TABLE "Dienst" ADD CONSTRAINT "Dienst_gebruikerId_fkey"
    FOREIGN KEY ("gebruikerId") REFERENCES "Gebruiker"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Kledijmaten in het personeelsdossier.
ALTER TABLE "PersoneelsProfiel" ADD COLUMN IF NOT EXISTS "maatBovenstuk" TEXT;
ALTER TABLE "PersoneelsProfiel" ADD COLUMN IF NOT EXISTS "maatBroek" TEXT;
ALTER TABLE "PersoneelsProfiel" ADD COLUMN IF NOT EXISTS "maatJas" TEXT;
ALTER TABLE "PersoneelsProfiel" ADD COLUMN IF NOT EXISTS "maatSchort" TEXT;
ALTER TABLE "PersoneelsProfiel" ADD COLUMN IF NOT EXISTS "maatSchoenen" TEXT;
ALTER TABLE "PersoneelsProfiel" ADD COLUMN IF NOT EXISTS "kledijOpmerking" TEXT;
