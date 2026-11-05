-- Webshop: bestellingen worden pas verkopen als ze via Mollie betaald zijn.
ALTER TABLE "Verkoop" ADD COLUMN IF NOT EXISTS "bestelnummer" TEXT;
ALTER TABLE "Verkoop" ADD COLUMN IF NOT EXISTS "testBetaling" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Verkoop" ADD COLUMN IF NOT EXISTS "terugbetalingVanId" TEXT;
ALTER TABLE "Verkoop" ADD COLUMN IF NOT EXISTS "telDag" TEXT;

CREATE TABLE IF NOT EXISTS "WebshopBetaling" (
    "id" TEXT NOT NULL,
    "sleutel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "mollieId" TEXT,
    "mollieStatus" TEXT,
    "lijnen" JSONB NOT NULL,
    "totaal" DECIMAL(10,2) NOT NULL,
    "naam" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "telefoon" TEXT,
    "adres" TEXT,
    "leverwijze" TEXT NOT NULL,
    "gewensteDag" TEXT NOT NULL,
    "gewensteTijd" TEXT,
    "verkoopId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WebshopBetaling_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "WebshopBetaling_sleutel_key" ON "WebshopBetaling"("sleutel");
CREATE UNIQUE INDEX IF NOT EXISTS "WebshopBetaling_mollieId_key" ON "WebshopBetaling"("mollieId");
CREATE UNIQUE INDEX IF NOT EXISTS "WebshopBetaling_verkoopId_key" ON "WebshopBetaling"("verkoopId");
