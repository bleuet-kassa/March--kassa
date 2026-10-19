-- Aankopen op rekening van bedrijven (op factuur) tellen niet meer in de dagontvangsten.
ALTER TABLE "Verkoop" ADD COLUMN IF NOT EXISTS "buitenDagontvangsten" BOOLEAN NOT NULL DEFAULT false;
