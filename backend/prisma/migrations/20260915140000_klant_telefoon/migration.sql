-- Telefoonnummer van de klant (verplicht bij kopen op rekening) + kopie op de factuur. Idempotent.
ALTER TABLE "Klant" ADD COLUMN IF NOT EXISTS "telefoon" TEXT;
ALTER TABLE "Verkoopfactuur" ADD COLUMN IF NOT EXISTS "klantTelefoon" TEXT;
