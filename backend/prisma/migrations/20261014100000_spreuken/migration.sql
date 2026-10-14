-- Spreuk van de dag (startscherm kassa); wekelijks automatisch aangevuld.
CREATE TABLE IF NOT EXISTS "Spreuk" (
  "id" TEXT NOT NULL,
  "tekst" TEXT NOT NULL,
  "auteur" TEXT,
  "emoji" TEXT,
  "bron" TEXT NOT NULL DEFAULT 'MANUEEL',
  "actief" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Spreuk_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Spreuk_tekst_key" ON "Spreuk"("tekst");
