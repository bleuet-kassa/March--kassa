-- Voorraad: een ontvangst kan door een beheerder geannuleerd worden (telt dan niet meer mee,
-- blijft zichtbaar in de geschiedenis).
ALTER TABLE "Voorraadontvangst" ADD COLUMN IF NOT EXISTS "geannuleerdOp" TIMESTAMP(3);
ALTER TABLE "Voorraadontvangst" ADD COLUMN IF NOT EXISTS "geannuleerdDoor" TEXT;

-- Wijnkelder: enkel wijn en sterke drank (vanaf 10% alcohol) hebben geen THT. Bier, frisdrank,
-- tonics, siropen, koekjes, snoep en alcoholvrije dranken wel; accessoires (Coravin, Vacu Vin) niet.
-- Ook voor artikels zonder categorie (dan telt enkel de naam). Zelfde regel als backend/src/common/tht.ts.
UPDATE "Product" AS p SET "thtNodig" = true
WHERE p."vrijePrijs" = false
  AND p."isStatiegeld" = false
  AND p."thtNodig" = false
  AND COALESCE(p."afdelingId", (SELECT c."afdelingId" FROM "Categorie" c WHERE c."id" = p."categorieId"))
      IN (SELECT a."id" FROM "Afdeling" a WHERE a."naam" ILIKE 'Wijn%')
  AND p."naam" !~* '(coravin|vacu ?vin)'
  AND (
       EXISTS (SELECT 1 FROM "Categorie" c WHERE c."id" = p."categorieId"
               AND (c."naam" ILIKE 'Bier%' OR c."naam" ILIKE 'Frisdrank%' OR c."naam" ILIKE 'Overig%'))
    OR p."naam" ~* '((^|[^0-9.,])0 ?%|non[ -]?alcoholic|alcoholvrij|alcohol[ -]?free)'
  );

-- Artikels die na de vorige voorraadmigratie (24/11/2026) aan de kassa ontstonden, kregen nog
-- geen standaard volgens de afdeling. Zet ze alsnog volgens de regel, behalve wie er al een THT
-- voor registreerde: wijn en sterke drank in de wijnkelder, non-food en groenten zonder THT.
UPDATE "Product" AS p SET "thtNodig" = false
WHERE p."createdAt" >= TIMESTAMP '2026-11-24 23:00:00'
  AND p."thtNodig" = true
  AND p."vrijePrijs" = false
  AND p."isStatiegeld" = false
  AND NOT EXISTS (SELECT 1 FROM "Voorraadontvangst" o WHERE o."productId" = p."id" AND o."tht" IS NOT NULL)
  AND (
       COALESCE(p."afdelingId", (SELECT c."afdelingId" FROM "Categorie" c WHERE c."id" = p."categorieId"))
         IN (SELECT a."id" FROM "Afdeling" a
             WHERE a."naam" ILIKE 'Onderhoud%' OR a."naam" ILIKE 'Private hygi%' OR a."naam" ILIKE 'Lifestyle%' OR a."naam" ILIKE 'Groente%')
    OR (
         COALESCE(p."afdelingId", (SELECT c."afdelingId" FROM "Categorie" c WHERE c."id" = p."categorieId"))
           IN (SELECT a."id" FROM "Afdeling" a WHERE a."naam" ILIKE 'Wijn%')
         AND (p."naam" ~* '(coravin|vacu ?vin)'
              OR (NOT EXISTS (SELECT 1 FROM "Categorie" c WHERE c."id" = p."categorieId"
                              AND (c."naam" ILIKE 'Bier%' OR c."naam" ILIKE 'Frisdrank%' OR c."naam" ILIKE 'Overig%'))
                  AND p."naam" !~* '((^|[^0-9.,])0 ?%|non[ -]?alcoholic|alcoholvrij|alcohol[ -]?free)'))
       )
  );
