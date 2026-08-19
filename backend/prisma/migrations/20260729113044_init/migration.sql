-- CreateEnum
CREATE TYPE "LocatieType" AS ENUM ('WINKEL', 'RESTAURANT', 'MAGAZIJN');

-- CreateEnum
CREATE TYPE "Eenheid" AS ENUM ('STUK', 'KG');

-- CreateEnum
CREATE TYPE "KlantType" AS ENUM ('PARTICULIER', 'B2B');

-- CreateEnum
CREATE TYPE "GebruikerRol" AS ENUM ('KASSA', 'BEHEER', 'BEHEERDER');

-- CreateEnum
CREATE TYPE "Betaalwijze" AS ENUM ('CASH', 'BANCONTACT', 'KAART', 'OVERSCHRIJVING', 'ONLINE');

-- CreateEnum
CREATE TYPE "VerkoopKanaal" AS ENUM ('KASSA', 'WEBSHOP');

-- CreateEnum
CREATE TYPE "ScradaStatus" AS ENUM ('NIET_VERSTUURD', 'VERSTUURD', 'FOUT');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('CONCEPT', 'VERSTUURD', 'ONTVANGEN', 'GEANNULEERD');

-- CreateTable
CREATE TABLE "Onderneming" (
    "id" TEXT NOT NULL,
    "naam" TEXT NOT NULL,
    "ondernemingsnummer" TEXT NOT NULL,
    "btwNummer" TEXT,
    "isImporteur" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Onderneming_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockLocatie" (
    "id" TEXT NOT NULL,
    "naam" TEXT NOT NULL,
    "type" "LocatieType" NOT NULL,
    "actief" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "StockLocatie_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BtwTarief" (
    "id" TEXT NOT NULL,
    "naam" TEXT NOT NULL,
    "percentage" DECIMAL(5,2) NOT NULL,
    "actief" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "BtwTarief_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Categorie" (
    "id" TEXT NOT NULL,
    "naam" TEXT NOT NULL,

    CONSTRAINT "Categorie_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Leverancier" (
    "id" TEXT NOT NULL,
    "naam" TEXT NOT NULL,
    "contact" TEXT,
    "land" TEXT,

    CONSTRAINT "Leverancier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "naam" TEXT NOT NULL,
    "interneCode" TEXT,
    "barcode" TEXT,
    "verkoopprijs" DECIMAL(10,2) NOT NULL,
    "inkoopprijs" DECIMAL(10,2),
    "isAlcohol" BOOLEAN NOT NULL DEFAULT false,
    "eenheid" "Eenheid" NOT NULL DEFAULT 'STUK',
    "allergenen" TEXT,
    "actief" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "btwTariefId" TEXT NOT NULL,
    "categorieId" TEXT,
    "leverancierId" TEXT,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Voorraad" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "locatieId" TEXT NOT NULL,
    "aantal" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "minimumDrempel" DECIMAL(12,3),

    CONSTRAINT "Voorraad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Voorraadverplaatsing" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "vanLocatieId" TEXT NOT NULL,
    "naarLocatieId" TEXT NOT NULL,
    "aantal" DECIMAL(12,3) NOT NULL,
    "datum" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "gebruikerId" TEXT,

    CONSTRAINT "Voorraadverplaatsing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prijslijst" (
    "id" TEXT NOT NULL,
    "naam" TEXT NOT NULL,

    CONSTRAINT "Prijslijst_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrijslijstItem" (
    "id" TEXT NOT NULL,
    "prijslijstId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "prijs" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "PrijslijstItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Klant" (
    "id" TEXT NOT NULL,
    "naam" TEXT NOT NULL,
    "type" "KlantType" NOT NULL DEFAULT 'PARTICULIER',
    "btwNummer" TEXT,
    "email" TEXT,
    "adres" TEXT,
    "prijslijstId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Klant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Gebruiker" (
    "id" TEXT NOT NULL,
    "naam" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "wachtwoordHash" TEXT NOT NULL,
    "rol" "GebruikerRol" NOT NULL DEFAULT 'KASSA',
    "actief" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Gebruiker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Verkoop" (
    "id" TEXT NOT NULL,
    "ondernemingId" TEXT NOT NULL,
    "locatieId" TEXT,
    "klantId" TEXT,
    "gebruikerId" TEXT,
    "kanaal" "VerkoopKanaal" NOT NULL DEFAULT 'KASSA',
    "betaalwijze" "Betaalwijze",
    "totaal" DECIMAL(10,2) NOT NULL,
    "datum" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leverwijze" TEXT,
    "status" TEXT,
    "scradaStatus" "ScradaStatus" NOT NULL DEFAULT 'NIET_VERSTUURD',
    "scradaRef" TEXT,
    "afgesloten" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Verkoop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerkoopLijn" (
    "id" TEXT NOT NULL,
    "verkoopId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "aantal" DECIMAL(12,3) NOT NULL,
    "eenheidsprijs" DECIMAL(10,2) NOT NULL,
    "btwPercentage" DECIMAL(5,2) NOT NULL,
    "btwBedrag" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "VerkoopLijn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Importbestelling" (
    "id" TEXT NOT NULL,
    "ondernemingId" TEXT NOT NULL,
    "leverancierId" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'CONCEPT',
    "datum" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "referentie" TEXT,

    CONSTRAINT "Importbestelling_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportbestellingLijn" (
    "id" TEXT NOT NULL,
    "importbestellingId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "aantal" DECIMAL(12,3) NOT NULL,
    "aankoopprijs" DECIMAL(10,2) NOT NULL,
    "accijns" DECIMAL(10,2),
    "douane" DECIMAL(10,2),
    "transport" DECIMAL(10,2),

    CONSTRAINT "ImportbestellingLijn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dagafsluiting" (
    "id" TEXT NOT NULL,
    "locatieId" TEXT NOT NULL,
    "gebruikerId" TEXT,
    "vanaf" TIMESTAMP(3) NOT NULL,
    "tot" TIMESTAMP(3) NOT NULL,
    "aantalVerkopen" INTEGER NOT NULL,
    "totaal" DECIMAL(10,2) NOT NULL,
    "perBetaalwijze" JSONB NOT NULL,
    "perBtwTarief" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Dagafsluiting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Onderneming_ondernemingsnummer_key" ON "Onderneming"("ondernemingsnummer");

-- CreateIndex
CREATE UNIQUE INDEX "Categorie_naam_key" ON "Categorie"("naam");

-- CreateIndex
CREATE UNIQUE INDEX "Product_interneCode_key" ON "Product"("interneCode");

-- CreateIndex
CREATE UNIQUE INDEX "Product_barcode_key" ON "Product"("barcode");

-- CreateIndex
CREATE UNIQUE INDEX "Voorraad_productId_locatieId_key" ON "Voorraad"("productId", "locatieId");

-- CreateIndex
CREATE UNIQUE INDEX "PrijslijstItem_prijslijstId_productId_key" ON "PrijslijstItem"("prijslijstId", "productId");

-- CreateIndex
CREATE UNIQUE INDEX "Gebruiker_email_key" ON "Gebruiker"("email");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_btwTariefId_fkey" FOREIGN KEY ("btwTariefId") REFERENCES "BtwTarief"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categorieId_fkey" FOREIGN KEY ("categorieId") REFERENCES "Categorie"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_leverancierId_fkey" FOREIGN KEY ("leverancierId") REFERENCES "Leverancier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voorraad" ADD CONSTRAINT "Voorraad_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voorraad" ADD CONSTRAINT "Voorraad_locatieId_fkey" FOREIGN KEY ("locatieId") REFERENCES "StockLocatie"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voorraadverplaatsing" ADD CONSTRAINT "Voorraadverplaatsing_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voorraadverplaatsing" ADD CONSTRAINT "Voorraadverplaatsing_vanLocatieId_fkey" FOREIGN KEY ("vanLocatieId") REFERENCES "StockLocatie"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voorraadverplaatsing" ADD CONSTRAINT "Voorraadverplaatsing_naarLocatieId_fkey" FOREIGN KEY ("naarLocatieId") REFERENCES "StockLocatie"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voorraadverplaatsing" ADD CONSTRAINT "Voorraadverplaatsing_gebruikerId_fkey" FOREIGN KEY ("gebruikerId") REFERENCES "Gebruiker"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrijslijstItem" ADD CONSTRAINT "PrijslijstItem_prijslijstId_fkey" FOREIGN KEY ("prijslijstId") REFERENCES "Prijslijst"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrijslijstItem" ADD CONSTRAINT "PrijslijstItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Klant" ADD CONSTRAINT "Klant_prijslijstId_fkey" FOREIGN KEY ("prijslijstId") REFERENCES "Prijslijst"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Verkoop" ADD CONSTRAINT "Verkoop_ondernemingId_fkey" FOREIGN KEY ("ondernemingId") REFERENCES "Onderneming"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Verkoop" ADD CONSTRAINT "Verkoop_locatieId_fkey" FOREIGN KEY ("locatieId") REFERENCES "StockLocatie"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Verkoop" ADD CONSTRAINT "Verkoop_klantId_fkey" FOREIGN KEY ("klantId") REFERENCES "Klant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Verkoop" ADD CONSTRAINT "Verkoop_gebruikerId_fkey" FOREIGN KEY ("gebruikerId") REFERENCES "Gebruiker"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerkoopLijn" ADD CONSTRAINT "VerkoopLijn_verkoopId_fkey" FOREIGN KEY ("verkoopId") REFERENCES "Verkoop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerkoopLijn" ADD CONSTRAINT "VerkoopLijn_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Importbestelling" ADD CONSTRAINT "Importbestelling_ondernemingId_fkey" FOREIGN KEY ("ondernemingId") REFERENCES "Onderneming"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Importbestelling" ADD CONSTRAINT "Importbestelling_leverancierId_fkey" FOREIGN KEY ("leverancierId") REFERENCES "Leverancier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportbestellingLijn" ADD CONSTRAINT "ImportbestellingLijn_importbestellingId_fkey" FOREIGN KEY ("importbestellingId") REFERENCES "Importbestelling"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportbestellingLijn" ADD CONSTRAINT "ImportbestellingLijn_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dagafsluiting" ADD CONSTRAINT "Dagafsluiting_locatieId_fkey" FOREIGN KEY ("locatieId") REFERENCES "StockLocatie"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dagafsluiting" ADD CONSTRAINT "Dagafsluiting_gebruikerId_fkey" FOREIGN KEY ("gebruikerId") REFERENCES "Gebruiker"("id") ON DELETE SET NULL ON UPDATE CASCADE;
