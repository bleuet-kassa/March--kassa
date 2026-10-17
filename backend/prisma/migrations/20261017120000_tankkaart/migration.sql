-- Tankkaart per personeelslid (nummer + versleutelde pincode).
ALTER TABLE "Gebruiker" ADD COLUMN IF NOT EXISTS "tankkaart" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Gebruiker" ADD COLUMN IF NOT EXISTS "tankkaartNummer" TEXT;
ALTER TABLE "Gebruiker" ADD COLUMN IF NOT EXISTS "tankkaartCodeGeheim" TEXT;
