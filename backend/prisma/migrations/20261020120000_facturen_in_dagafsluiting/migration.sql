-- Bedrijfsfacturen tellen mee op de dagafsluiting van de dag waarop ze gemaakt worden
-- (onderdeel "Facturen", niet in het dagontvangstenboek naar Scrada).
ALTER TABLE "Verkoopfactuur" ADD COLUMN IF NOT EXISTS "dagafsluitingId" TEXT;
ALTER TABLE "Dagafsluiting" ADD COLUMN IF NOT EXISTS "facturenTotaal" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- Maand handmatig als gefactureerd aangeduid (factuur buiten de kassa gemaakt): referentie.
ALTER TABLE "Verkoop" ADD COLUMN IF NOT EXISTS "factuurReferentie" TEXT;
