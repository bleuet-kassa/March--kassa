-- Scrada-dagontvangstenboek: verzendstatus per dagafsluiting. Idempotent.
ALTER TABLE "Dagafsluiting" ADD COLUMN IF NOT EXISTS "scradaStatus" TEXT NOT NULL DEFAULT 'NIET_VERSTUURD';
ALTER TABLE "Dagafsluiting" ADD COLUMN IF NOT EXISTS "scradaRef" TEXT;
ALTER TABLE "Dagafsluiting" ADD COLUMN IF NOT EXISTS "scradaVerstuurdOp" TIMESTAMP(3);
ALTER TABLE "Dagafsluiting" ADD COLUMN IF NOT EXISTS "scradaFout" TEXT;
