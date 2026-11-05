-- Webshopkalender: afhalen en leveren per dag.
CREATE TABLE IF NOT EXISTS "Webshopdag" (
    "datum" TEXT NOT NULL,
    "afhalen" BOOLEAN,
    "leveren" BOOLEAN,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Webshopdag_pkey" PRIMARY KEY ("datum")
);

-- De vroegere "extra afhaaldagen" gaan mee naar de kalender. Een onleesbare waarde mag de
-- update niet tegenhouden: dan blijft ze gewoon staan.
DO $$
BEGIN
  INSERT INTO "Webshopdag" ("datum", "afhalen")
  SELECT d, true
  FROM "SiteTekst", json_array_elements_text("waarde"::json) AS d
  WHERE "sleutel" = 'extra_afhaaldagen' AND d ~ '^\d{4}-\d{2}-\d{2}$'
  ON CONFLICT ("datum") DO NOTHING;
  DELETE FROM "SiteTekst" WHERE "sleutel" = 'extra_afhaaldagen';
EXCEPTION WHEN others THEN
  NULL;
END $$;
