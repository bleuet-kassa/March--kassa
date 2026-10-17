-- Nieuwe toegang "bestellingen" (webshopbestellingen opvolgen): ook toevoegen aan
-- accounts waarvan de toegangen al apart ingesteld zijn (wie standaard heeft, krijgt ze vanzelf).
UPDATE "Gebruiker"
SET "rechten" = "rechten" || '["bestellingen"]'::jsonb
WHERE "rechten" IS NOT NULL
  AND jsonb_typeof("rechten") = 'array'
  AND NOT ("rechten" @> '["bestellingen"]'::jsonb);
