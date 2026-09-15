-- Rekening per e-mail verstuurd vanuit de kassa (particulieren, niet via Scrada/Peppol).
ALTER TABLE "Verkoopfactuur" ADD COLUMN IF NOT EXISTS "gemaildOp" TIMESTAMP(3);
ALTER TABLE "Verkoopfactuur" ADD COLUMN IF NOT EXISTS "gemaildNaar" TEXT;
