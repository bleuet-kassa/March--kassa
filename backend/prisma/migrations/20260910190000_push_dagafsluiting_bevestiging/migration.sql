-- Dagafsluiting op afstand bevestigen + pushmeldingen (beheerder-smartphone).
-- Idempotent (IF NOT EXISTS) zodat een herhaalde deploy nooit vastloopt.

-- Sleutel/waarde-instellingen van de server (o.a. VAPID-sleutels).
CREATE TABLE IF NOT EXISTS "Instelling" (
    "sleutel"   TEXT NOT NULL,
    "waarde"    TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Instelling_pkey" PRIMARY KEY ("sleutel")
);

-- Browser-push-abonnement van een beheerder (één per toestel/browser).
CREATE TABLE IF NOT EXISTS "PushAbonnement" (
    "id"          TEXT NOT NULL,
    "gebruikerId" TEXT NOT NULL,
    "endpoint"    TEXT NOT NULL,
    "p256dh"      TEXT NOT NULL,
    "auth"        TEXT NOT NULL,
    "toestel"     TEXT,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PushAbonnement_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "PushAbonnement_endpoint_key" ON "PushAbonnement"("endpoint");
ALTER TABLE "PushAbonnement" DROP CONSTRAINT IF EXISTS "PushAbonnement_gebruikerId_fkey";
ALTER TABLE "PushAbonnement" ADD CONSTRAINT "PushAbonnement_gebruikerId_fkey"
    FOREIGN KEY ("gebruikerId") REFERENCES "Gebruiker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Aanvraag om de dag af te sluiten (kassa vraagt, beheerder bevestigt).
CREATE TABLE IF NOT EXISTS "DagafsluitingAanvraag" (
    "id"                TEXT NOT NULL,
    "token"             TEXT NOT NULL,
    "status"            TEXT NOT NULL DEFAULT 'OPEN',
    "aangevraagdDoorId" TEXT,
    "bevestigdDoorId"   TEXT,
    "totaal"            DECIMAL(10,2) NOT NULL,
    "aantalVerkopen"    INTEGER NOT NULL DEFAULT 0,
    "verlooptOp"        TIMESTAMP(3) NOT NULL,
    "bevestigdOp"       TIMESTAMP(3),
    "dagafsluitingId"   TEXT,
    "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DagafsluitingAanvraag_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "DagafsluitingAanvraag_token_key" ON "DagafsluitingAanvraag"("token");
CREATE UNIQUE INDEX IF NOT EXISTS "DagafsluitingAanvraag_dagafsluitingId_key" ON "DagafsluitingAanvraag"("dagafsluitingId");
ALTER TABLE "DagafsluitingAanvraag" DROP CONSTRAINT IF EXISTS "DagafsluitingAanvraag_aangevraagdDoorId_fkey";
ALTER TABLE "DagafsluitingAanvraag" ADD CONSTRAINT "DagafsluitingAanvraag_aangevraagdDoorId_fkey"
    FOREIGN KEY ("aangevraagdDoorId") REFERENCES "Gebruiker"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DagafsluitingAanvraag" DROP CONSTRAINT IF EXISTS "DagafsluitingAanvraag_bevestigdDoorId_fkey";
ALTER TABLE "DagafsluitingAanvraag" ADD CONSTRAINT "DagafsluitingAanvraag_bevestigdDoorId_fkey"
    FOREIGN KEY ("bevestigdDoorId") REFERENCES "Gebruiker"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DagafsluitingAanvraag" DROP CONSTRAINT IF EXISTS "DagafsluitingAanvraag_dagafsluitingId_fkey";
ALTER TABLE "DagafsluitingAanvraag" ADD CONSTRAINT "DagafsluitingAanvraag_dagafsluitingId_fkey"
    FOREIGN KEY ("dagafsluitingId") REFERENCES "Dagafsluiting"("id") ON DELETE SET NULL ON UPDATE CASCADE;
