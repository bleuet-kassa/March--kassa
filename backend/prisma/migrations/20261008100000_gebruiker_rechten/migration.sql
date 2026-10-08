-- Toegangen per persoon (lijst van functionaliteit-sleutels). null = standaard kassa-toegangen.
ALTER TABLE "Gebruiker" ADD COLUMN IF NOT EXISTS "rechten" JSONB;
