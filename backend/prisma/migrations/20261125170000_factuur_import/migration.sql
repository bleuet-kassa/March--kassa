-- Facturen inlezen: verwerkte facturen (tegen dubbel verwerken) en onthouden koppelingen
-- (factuurregel -> artikel, of "niet voor de winkel"). Idempotent.
CREATE TABLE IF NOT EXISTS "FactuurImport" (
  "id" TEXT NOT NULL,
  "sleutel" TEXT NOT NULL,
  "bestandHash" TEXT,
  "leverancierId" TEXT,
  "factuurnummer" TEXT,
  "factuurdatum" TEXT,
  "ontvangenOp" TEXT NOT NULL,
  "locatieId" TEXT NOT NULL,
  "nieuw" INTEGER NOT NULL DEFAULT 0,
  "bijgeboekt" INTEGER NOT NULL DEFAULT 0,
  "overgeslagen" INTEGER NOT NULL DEFAULT 0,
  "door" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FactuurImport_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "FactuurImport_sleutel_key" ON "FactuurImport"("sleutel");
CREATE INDEX IF NOT EXISTS "FactuurImport_bestandHash_idx" ON "FactuurImport"("bestandHash");
CREATE INDEX IF NOT EXISTS "FactuurImport_leverancierId_factuurnummer_idx" ON "FactuurImport"("leverancierId", "factuurnummer");

CREATE TABLE IF NOT EXISTS "FactuurKoppeling" (
  "id" TEXT NOT NULL,
  "leverancierId" TEXT NOT NULL DEFAULT '',
  "omschrijving" TEXT NOT NULL,
  "productId" TEXT,
  "nietVoorWinkel" BOOLEAN NOT NULL DEFAULT false,
  "perVerpakking" INTEGER NOT NULL DEFAULT 1,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FactuurKoppeling_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "FactuurKoppeling" ADD COLUMN IF NOT EXISTS "perVerpakking" INTEGER NOT NULL DEFAULT 1;
CREATE UNIQUE INDEX IF NOT EXISTS "FactuurKoppeling_leverancierId_omschrijving_key" ON "FactuurKoppeling"("leverancierId", "omschrijving");
CREATE INDEX IF NOT EXISTS "FactuurKoppeling_omschrijving_idx" ON "FactuurKoppeling"("omschrijving");
DO $$ BEGIN
  ALTER TABLE "FactuurKoppeling" ADD CONSTRAINT "FactuurKoppeling_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
