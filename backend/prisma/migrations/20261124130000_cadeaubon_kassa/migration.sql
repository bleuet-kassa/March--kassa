-- Cadeaubonnen verkocht aan de kassa komen automatisch in het register. Een bon vervalt
-- als de verkoop waaruit hij ontstond geannuleerd of verwijderd wordt. Idempotent.
ALTER TABLE "Cadeaubon" ADD COLUMN IF NOT EXISTS "geannuleerd" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Cadeaubon" ADD COLUMN IF NOT EXISTS "geannuleerdOp" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "Cadeaubon_verkoopId_idx" ON "Cadeaubon"("verkoopId");
