-- Leverkosten: opgezochte adressen voor de afstand naar het leveradres.
CREATE TABLE IF NOT EXISTS "Adrescache" (
    "sleutel" TEXT NOT NULL,
    "gevonden" BOOLEAN NOT NULL,
    "lat" DOUBLE PRECISION,
    "lon" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Adrescache_pkey" PRIMARY KEY ("sleutel")
);
