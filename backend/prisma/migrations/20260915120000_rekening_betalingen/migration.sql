-- Betalingen van openstaande rekeningen/facturen aan de kassa. Idempotent.
ALTER TABLE "Verkoopfactuur" ADD COLUMN IF NOT EXISTS "betaaldBedrag" DECIMAL(10,2) NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "RekeningBetaling" (
    "id"              TEXT NOT NULL,
    "factuurId"       TEXT NOT NULL,
    "datum"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bedrag"          DECIMAL(10,2) NOT NULL,
    "betalingen"      JSONB NOT NULL,
    "gebruikerId"     TEXT,
    "afgesloten"      BOOLEAN NOT NULL DEFAULT false,
    "dagafsluitingId" TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RekeningBetaling_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "RekeningBetaling_factuurId_idx" ON "RekeningBetaling"("factuurId");
CREATE INDEX IF NOT EXISTS "RekeningBetaling_afgesloten_idx" ON "RekeningBetaling"("afgesloten");
ALTER TABLE "RekeningBetaling" DROP CONSTRAINT IF EXISTS "RekeningBetaling_factuurId_fkey";
ALTER TABLE "RekeningBetaling" ADD CONSTRAINT "RekeningBetaling_factuurId_fkey"
    FOREIGN KEY ("factuurId") REFERENCES "Verkoopfactuur"("id") ON DELETE CASCADE ON UPDATE CASCADE;
