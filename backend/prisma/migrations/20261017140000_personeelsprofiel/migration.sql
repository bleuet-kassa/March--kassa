-- Personeelsdossier per account (enkel beheerder).
CREATE TABLE IF NOT EXISTS "PersoneelsProfiel" (
  "id" TEXT NOT NULL,
  "gebruikerId" TEXT NOT NULL,
  "voornaam" TEXT, "achternaam" TEXT, "telefoon" TEXT, "privEmail" TEXT, "adres" TEXT, "geboortedatum" TEXT,
  "rijksregisterGeheim" TEXT, "ibanGeheim" TEXT, "noodcontactNaam" TEXT, "noodcontactTelefoon" TEXT,
  "statuut" TEXT, "ondernemingId" TEXT, "functie" TEXT,
  "afdelingen" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "verantwoordelijkVoor" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "inDienst" TEXT, "uitDienst" TEXT,
  "urenPerWeek" DECIMAL(5,2), "urenPerDag" DECIMAL(4,2), "maxUrenDag" DECIMAL(4,2), "maxUrenWeek" DECIMAL(5,2),
  "maxUrenMaand" DECIMAL(6,2), "jaarContingent" DECIMAL(6,2),
  "verlofdagenJaar" DECIMAL(5,2), "verlofdagenSaldo" DECIMAL(5,2), "recupUrenSaldo" DECIMAL(6,2),
  "notities" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PersoneelsProfiel_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PersoneelsProfiel_gebruikerId_key" ON "PersoneelsProfiel"("gebruikerId");
DO $$ BEGIN
  ALTER TABLE "PersoneelsProfiel" ADD CONSTRAINT "PersoneelsProfiel_gebruikerId_fkey"
    FOREIGN KEY ("gebruikerId") REFERENCES "Gebruiker"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
