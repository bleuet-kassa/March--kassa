-- Maand handmatig als gefactureerd aangeduid: telt mee op de dagafsluiting van die dag
-- (onderdeel "Facturen"). Deze kolom onthoudt op welke afsluiting dat gebeurde.
ALTER TABLE "Verkoop" ADD COLUMN IF NOT EXISTS "gefactureerdDagafsluitingId" TEXT;
