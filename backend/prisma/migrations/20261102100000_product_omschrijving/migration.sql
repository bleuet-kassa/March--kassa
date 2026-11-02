-- Omschrijving per artikel (vrije tekst op de artikelfiche, ook zichtbaar in de webshop).
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "omschrijving" TEXT;
