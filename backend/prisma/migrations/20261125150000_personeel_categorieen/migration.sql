-- Categorieën (ploegen) van het personeel, zelf te beheren in de kassa (Personeel).
-- De eerste drie dragen de oude vaste sleutels als id, zodat wat al in de dossiers staat
-- (afdelingen, verantwoordelijk voor) gewoon blijft kloppen. Idempotent.
CREATE TABLE IF NOT EXISTS "Personeelscategorie" (
  "id" TEXT NOT NULL,
  "naam" TEXT NOT NULL,
  "locatie" TEXT NOT NULL,
  "volgorde" INTEGER NOT NULL DEFAULT 0,
  "actief" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Personeelscategorie_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Personeelscategorie_naam_key" ON "Personeelscategorie"("naam");

-- Standaardcategorieën + de gevraagde restaurantploegen (klantvraag 2026-11-25).
INSERT INTO "Personeelscategorie" ("id", "naam", "locatie", "volgorde") VALUES
  ('WINKEL', 'Winkel', 'WINKEL', 10),
  ('RESTAURANT', 'Restaurant', 'RESTAURANT', 20),
  ('RESTAURANT_KEUKEN', 'Keuken restaurant', 'RESTAURANT', 30),
  ('RESTAURANT_ZAAL', 'Zaal restaurant', 'RESTAURANT', 40),
  ('RESTAURANT_FLEXI', 'Flexi restaurant', 'RESTAURANT', 50),
  ('CATERING', 'Catering', 'CATERING', 60)
ON CONFLICT DO NOTHING;
