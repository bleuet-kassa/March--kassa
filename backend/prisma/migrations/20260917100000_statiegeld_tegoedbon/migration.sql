-- Statiegeld: statiegeldsoorten zijn producten (isStatiegeld); artikelen verwijzen ernaar.
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "isStatiegeld" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "statiegeldProductId" TEXT;
DO $$ BEGIN
  ALTER TABLE "Product" ADD CONSTRAINT "Product_statiegeldProductId_fkey"
    FOREIGN KEY ("statiegeldProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Tegoedbon (uit een terugbetaling, bv. leeggoed) in het cadeaubon-register.
ALTER TABLE "Cadeaubon" ADD COLUMN IF NOT EXISTS "soort" TEXT NOT NULL DEFAULT 'CADEAUBON';
ALTER TABLE "Cadeaubon" ADD COLUMN IF NOT EXISTS "verkoopId" TEXT;
