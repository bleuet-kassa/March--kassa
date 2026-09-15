-- Verkoopfactuur: weergave naar Scrada samenvatten (enkel totalen per BTW-tarief + eigen omschrijving). Idempotent.
ALTER TABLE "Verkoopfactuur" ADD COLUMN IF NOT EXISTS "samenvatten" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Verkoopfactuur" ADD COLUMN IF NOT EXISTS "omschrijving" TEXT;
