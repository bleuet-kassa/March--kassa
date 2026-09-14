-- Verkoopfacturen uit de kassa (per ticket of maandfactuur per bedrijf) -> Scrada concept-facturen.
-- Idempotent (IF NOT EXISTS) zodat een herhaalde deploy nooit vastloopt.

CREATE TABLE IF NOT EXISTS "Verkoopfactuur" (
    "id"                TEXT NOT NULL,
    "nummer"            TEXT NOT NULL,
    "boekjaar"          TEXT NOT NULL,
    "datum"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vervaldatum"       TIMESTAMP(3),
    "bron"              TEXT NOT NULL,
    "periode"           TEXT,
    "klantNaam"         TEXT NOT NULL,
    "klantBtw"          TEXT,
    "klantEmail"        TEXT,
    "klantAdres"        TEXT,
    "klantId"           TEXT,
    "rekeningBedrijfId" TEXT,
    "totaalExcl"        DECIMAL(10,2) NOT NULL,
    "totaalBtw"         DECIMAL(10,2) NOT NULL,
    "totaalIncl"        DECIMAL(10,2) NOT NULL,
    "perBtw"            JSONB NOT NULL,
    "lijnen"            JSONB NOT NULL,
    "betaalstatus"      TEXT NOT NULL DEFAULT 'OPENSTAAND',
    "betaaldOp"         TIMESTAMP(3),
    "betaalwijze"       TEXT,
    "scradaStatus"      TEXT NOT NULL DEFAULT 'NIET_VERSTUURD',
    "scradaRef"         TEXT,
    "scradaVerstuurdOp" TIMESTAMP(3),
    "scradaFout"        TEXT,
    "correctieStatus"   TEXT NOT NULL DEFAULT 'NIET_VERSTUURD',
    "correctieRef"      TEXT,
    "correctieFout"     TEXT,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Verkoopfactuur_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Verkoopfactuur_nummer_key" ON "Verkoopfactuur"("nummer");
ALTER TABLE "Verkoopfactuur" DROP CONSTRAINT IF EXISTS "Verkoopfactuur_klantId_fkey";
ALTER TABLE "Verkoopfactuur" ADD CONSTRAINT "Verkoopfactuur_klantId_fkey"
    FOREIGN KEY ("klantId") REFERENCES "Klant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Verkoopfactuur" DROP CONSTRAINT IF EXISTS "Verkoopfactuur_rekeningBedrijfId_fkey";
ALTER TABLE "Verkoopfactuur" ADD CONSTRAINT "Verkoopfactuur_rekeningBedrijfId_fkey"
    FOREIGN KEY ("rekeningBedrijfId") REFERENCES "RekeningBedrijf"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Verkoop: factuur gewenst (aan de kassa gekozen) + koppeling met de factuur.
ALTER TABLE "Verkoop" ADD COLUMN IF NOT EXISTS "factuurGewenst" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Verkoop" ADD COLUMN IF NOT EXISTS "factuurId" TEXT;
ALTER TABLE "Verkoop" DROP CONSTRAINT IF EXISTS "Verkoop_factuurId_fkey";
ALTER TABLE "Verkoop" ADD CONSTRAINT "Verkoop_factuurId_fkey"
    FOREIGN KEY ("factuurId") REFERENCES "Verkoopfactuur"("id") ON DELETE SET NULL ON UPDATE CASCADE;
