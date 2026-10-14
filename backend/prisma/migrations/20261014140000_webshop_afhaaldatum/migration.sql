-- Webshop: gewenste afhaal-/leverdatum; agenda: "gelezen" + verplaatsen naar die datum.
ALTER TABLE "Verkoop" ADD COLUMN IF NOT EXISTS "gewensteDag" TEXT;
ALTER TABLE "Verkoop" ADD COLUMN IF NOT EXISTS "gewensteTijd" TEXT;
ALTER TABLE "AgendaItem" ADD COLUMN IF NOT EXISTS "gelezen" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AgendaItem" ADD COLUMN IF NOT EXISTS "afhaalDag" TEXT;
ALTER TABLE "AgendaItem" ADD COLUMN IF NOT EXISTS "afhaalTijd" TEXT;
-- Manuele items en al bestaande items gelden als gelezen.
UPDATE "AgendaItem" SET "gelezen" = true WHERE "bron" <> 'WEBSHOP';
-- Categorie van een agendapunt (BROOD | CATERING | BOODSCHAPPEN) voor de gesplitste Excel-export.
ALTER TABLE "AgendaItem" ADD COLUMN IF NOT EXISTS "categorie" TEXT;
UPDATE "AgendaItem" SET "categorie" = 'BOODSCHAPPEN' WHERE "categorie" IS NULL AND "bron" = 'WEBSHOP';
