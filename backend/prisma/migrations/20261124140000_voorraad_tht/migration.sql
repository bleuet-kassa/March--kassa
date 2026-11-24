-- Voorraad: elke ontvangst met ontvangstdatum en THT, correcties (afboeken en tellen), en per
-- artikel of een THT nodig is. Idempotent.
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "thtNodig" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS "Voorraadontvangst" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "locatieId" TEXT NOT NULL,
    "aantal" DECIMAL(12,3) NOT NULL,
    "ontvangenOp" TEXT NOT NULL,
    "tht" TEXT,
    "aankoopprijs" DECIMAL(10,2),
    "bron" TEXT NOT NULL DEFAULT 'MANUEEL',
    "opmerking" TEXT,
    "door" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Voorraadontvangst_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Voorraadontvangst_productId_locatieId_idx" ON "Voorraadontvangst"("productId", "locatieId");
CREATE INDEX IF NOT EXISTS "Voorraadontvangst_tht_idx" ON "Voorraadontvangst"("tht");

CREATE TABLE IF NOT EXISTS "Voorraadcorrectie" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "locatieId" TEXT NOT NULL,
    "aantal" DECIMAL(12,3) NOT NULL,
    "reden" TEXT NOT NULL,
    "opmerking" TEXT,
    "door" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Voorraadcorrectie_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Voorraadcorrectie_productId_locatieId_idx" ON "Voorraadcorrectie"("productId", "locatieId");

DO $$ BEGIN
  ALTER TABLE "Voorraadontvangst" ADD CONSTRAINT "Voorraadontvangst_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "Voorraadontvangst" ADD CONSTRAINT "Voorraadontvangst_locatieId_fkey" FOREIGN KEY ("locatieId") REFERENCES "StockLocatie"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "Voorraadcorrectie" ADD CONSTRAINT "Voorraadcorrectie_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "Voorraadcorrectie" ADD CONSTRAINT "Voorraadcorrectie_locatieId_fkey" FOREIGN KEY ("locatieId") REFERENCES "StockLocatie"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Klantregel 2026-11-24: geen THT voor non-food, wijn en groenten (per artikel aan te passen).
-- Ook niet voor vrije bedragen en statiegeld (die hebben geen voorraad).
UPDATE "Product" AS p SET "thtNodig" = false
WHERE p."vrijePrijs" = true
   OR p."isStatiegeld" = true
   OR COALESCE(p."afdelingId", (SELECT c."afdelingId" FROM "Categorie" c WHERE c."id" = p."categorieId")) IN (
        SELECT a."id" FROM "Afdeling" a
        WHERE a."naam" ILIKE 'Onderhoud%' OR a."naam" ILIKE 'Private hygi%' OR a."naam" ILIKE 'Lifestyle%'
           OR a."naam" ILIKE 'Wijn%' OR a."naam" ILIKE 'Groente%'
      );
