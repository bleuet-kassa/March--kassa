-- Vaste prijsfactor per artikel: verkoopprijs incl. btw = aankoopprijs x factor (naar boven op
-- 5 cent). Leeg = verkoopprijs met de hand. Idempotent.
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "factor" DECIMAL(6,3);
