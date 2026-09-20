-- Boekdatum van een dagafsluiting: de gestarte kassadag = dag (Brusselse tijd) van de EERSTE
-- verkoop sinds de vorige afsluiting, i.p.v. het moment van afsluiten. Afsluiten na middernacht
-- blijft zo op de dag zelf geboekt.
ALTER TABLE "Dagafsluiting" ADD COLUMN IF NOT EXISTS "boekdatum" TEXT;

UPDATE "Dagafsluiting" d
SET "boekdatum" = to_char(
  (COALESCE((SELECT MIN(v."datum") FROM "Verkoop" v WHERE v."dagafsluitingId" = d."id"), d."vanaf", d."tot")
     AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Brussels',
  'YYYY-MM-DD')
WHERE d."boekdatum" IS NULL;
