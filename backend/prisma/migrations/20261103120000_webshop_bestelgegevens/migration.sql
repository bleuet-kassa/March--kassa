-- Contactgegevens per webshopbestelling (de publieke bestelling wijzigt de klantenlijst niet meer).
ALTER TABLE "Verkoop" ADD COLUMN IF NOT EXISTS "bestelNaam" TEXT;
ALTER TABLE "Verkoop" ADD COLUMN IF NOT EXISTS "bestelEmail" TEXT;
ALTER TABLE "Verkoop" ADD COLUMN IF NOT EXISTS "bestelTelefoon" TEXT;
ALTER TABLE "Verkoop" ADD COLUMN IF NOT EXISTS "bestelAdres" TEXT;
