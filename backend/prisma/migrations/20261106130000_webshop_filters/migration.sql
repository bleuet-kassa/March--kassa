-- Zoekfilters van de webshop, zelf aan te maken en toe te kennen aan artikels.
CREATE TABLE IF NOT EXISTS "Webshopfilter" (
    "id" TEXT NOT NULL,
    "naam" TEXT NOT NULL,
    "volgorde" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Webshopfilter_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Webshopfilter_naam_key" ON "Webshopfilter"("naam");

CREATE TABLE IF NOT EXISTS "ProductFilter" (
    "productId" TEXT NOT NULL,
    "filterId" TEXT NOT NULL,
    CONSTRAINT "ProductFilter_pkey" PRIMARY KEY ("productId","filterId")
);

DO $$ BEGIN
  ALTER TABLE "ProductFilter" ADD CONSTRAINT "ProductFilter_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE "ProductFilter" ADD CONSTRAINT "ProductFilter_filterId_fkey" FOREIGN KEY ("filterId") REFERENCES "Webshopfilter"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
