// Import-brug: wijnkelder (localStorage-app van het restaurant) -> kassa-DB.
//
// Leest prisma/data/wijnkelder-backup.json (de 366 producten uit de wijnkelder)
// en zet ze om naar het centrale datamodel:
//   - Product (met interne code = wijnkelder-id, eigen in-store barcode, BTW per
//     type, inkoop- en voorlopige verkoopprijs)
//   - Voorraad op de locatie RESTAURANT (dat is wat de wijnkelder beheert)
//   - Categorie en Leverancier worden aangemaakt/gekoppeld
//
// Idempotent: draai het gerust opnieuw — bestaande producten (zelfde interneCode)
// worden bijgewerkt, niet gedupliceerd.
//
// Draaien:  npm run import:wijnkelder
//
// LET OP — bewuste keuzes (pas aan naar wens, zie ook de coupling-nota):
//   * BARCODES: de wijnkelder heeft er geen. We genereren een eigen in-store
//     EAN-13 (prefix 20) per product, zodat je NU al kunt scannen aan de kassa.
//     Vervang die later door de echte EAN op de verpakking waar die bestaat.
//   * VERKOOPPRIJS: de wijnkelder bewaart enkel de inkoopprijs; de verkoopprijs
//     wordt daar berekend met een marge-staffel. We nemen diezelfde berekening
//     als VOORLOPIGE verkoopprijs (dit is de restaurantprijs — de winkelprijs
//     kan verschillen). Prijzen zijn incl. BTW.
//   * STOCK: komt op de locatie RESTAURANT. De kassa verkoopt uit de WINKEL;
//     verplaats voorraad winkel<->restaurant waar nodig.
//   * BTW: wijn/bier/sterke drank = 21% (alcohol), frisdrank/overig = 6%.
//     "Overig" is een verzamelbak — controleer die producten apart.

import { PrismaClient, LocatieType, Eenheid } from '@prisma/client';
import { readFileSync } from 'fs';
import { join } from 'path';

const prisma = new PrismaClient();

// Marge-instellingen overgenomen uit de wijnkelder (Instellingen).
const FLES_FACTOR = 3.5;
const FLES_DREMPEL = 25;
const FLES_FACTOR_HOOG = 2.5;
const FLES_AFRONDING = 0.5;

type Wijn = {
  id: string;
  huis?: string;
  naam?: string;
  type?: string;
  druif?: string;
  land?: string;
  regio?: string;
  jaargang?: string;
  inhoud?: number;
  inkoop?: number;
  voorraad?: number;
  minVoorraad?: number;
  leverancier?: string;
  omschrijving?: string;
  classificatie?: string;
};

// Welk BTW-tarief + alcoholvlag hoort bij een wijnkelder-"type"?
function btwVoorType(type: string | undefined): { alcohol: boolean } {
  const t = (type ?? '').toLowerCase();
  const nietAlcohol = t.includes('frisdrank');
  // "Overig" defaulten we naar niet-alcohol/6% — controleer apart.
  const overig = t.includes('overig');
  return { alcohol: !(nietAlcohol || overig) };
}

// Verkoopprijs (incl. BTW) zoals de wijnkelder ze berekent, als voorlopige prijs.
function verkoopprijsUitInkoop(inkoop: number): number {
  if (!inkoop || inkoop <= 0) return 0;
  const factor = inkoop <= FLES_DREMPEL ? FLES_FACTOR : FLES_FACTOR_HOOG;
  const ruw = inkoop * factor;
  return Math.round(ruw / FLES_AFRONDING) * FLES_AFRONDING;
}

// Genereer een geldige in-store EAN-13 (prefix 20) uit een volgnummer.
function genereerBarcode(volgnr: number): string {
  const body = ('20' + String(volgnr).padStart(10, '0')).slice(0, 12);
  let som = 0;
  for (let i = 0; i < 12; i++) {
    const d = Number(body[i]);
    som += i % 2 === 0 ? d : d * 3;
  }
  const check = (10 - (som % 10)) % 10;
  return body + String(check);
}

async function getOrCreateBtw(naam: string, percentage: number) {
  const bestaand = await prisma.btwTarief.findFirst({ where: { naam } });
  if (bestaand) return bestaand;
  return prisma.btwTarief.create({ data: { naam, percentage } });
}

async function getOrCreateLocatie(naam: string, type: LocatieType) {
  const bestaand = await prisma.stockLocatie.findFirst({ where: { type } });
  if (bestaand) return bestaand;
  return prisma.stockLocatie.create({ data: { naam, type } });
}

async function getOrCreateAfdeling(naam: string) {
  const bestaand = await prisma.afdeling.findFirst({ where: { naam } });
  return bestaand ?? prisma.afdeling.create({ data: { naam } });
}

async function getOrCreateCategorie(naam: string, afdelingId: string) {
  return prisma.categorie.upsert({
    where: { naam },
    create: { naam, afdelingId },
    update: { afdelingId },
  });
}

async function main() {
  const pad = join(__dirname, 'data', 'wijnkelder-backup.json');
  const wijnen: Wijn[] = JSON.parse(readFileSync(pad, 'utf-8'));
  console.log(`Ingelezen uit back-up: ${wijnen.length} producten.`);

  const btw21 = await getOrCreateBtw('Alcohol 21%', 21);
  const btw6 = await getOrCreateBtw('Voeding 6%', 6);
  const wijnkelder = await getOrCreateAfdeling('Wijnkelder');
  const restaurant = await getOrCreateLocatie('Restaurant', LocatieType.RESTAURANT);
  await getOrCreateLocatie('Winkel', LocatieType.WINKEL); // zodat de kassa een winkellocatie heeft

  // Leveranciers vooraf aanmaken/cachen.
  const levCache = new Map<string, string>();
  async function levId(naam?: string): Promise<string | undefined> {
    if (!naam) return undefined;
    if (levCache.has(naam)) return levCache.get(naam);
    const bestaand =
      (await prisma.leverancier.findFirst({ where: { naam } })) ??
      (await prisma.leverancier.create({ data: { naam } }));
    levCache.set(naam, bestaand.id);
    return bestaand.id;
  }

  let volgnr = 1;
  let nieuw = 0;
  let bijgewerkt = 0;

  for (const w of wijnen) {
    const naam = [w.huis, w.naam].filter(Boolean).join(' — ') || w.naam || w.huis || 'Naamloos';
    const { alcohol } = btwVoorType(w.type);
    const btwId = alcohol ? btw21.id : btw6.id;
    const inkoop = Number(w.inkoop) || 0;
    const verkoop = verkoopprijsUitInkoop(inkoop);
    const categorie = await getOrCreateCategorie(w.type || 'Overig', wijnkelder.id);
    const leverancierId = await levId(w.leverancier);

    // Bestaat het product al (op interne code = wijnkelder-id)?
    const bestaand = await prisma.product.findUnique({
      where: { interneCode: w.id },
    });
    const barcode = bestaand?.barcode ?? genereerBarcode(volgnr++);

    const product = await prisma.product.upsert({
      where: { interneCode: w.id },
      create: {
        naam,
        interneCode: w.id,
        barcode,
        verkoopprijs: verkoop,
        inkoopprijs: inkoop,
        isAlcohol: alcohol,
        eenheid: Eenheid.STUK,
        btwTariefId: btwId,
        categorieId: categorie.id,
        leverancierId: leverancierId ?? null,
      },
      update: {
        naam,
        verkoopprijs: verkoop,
        inkoopprijs: inkoop,
        isAlcohol: alcohol,
        btwTariefId: btwId,
        categorieId: categorie.id,
        leverancierId: leverancierId ?? null,
      },
    });
    bestaand ? bijgewerkt++ : nieuw++;

    // Voorraad op de restaurantlocatie zetten/bijwerken.
    await prisma.voorraad.upsert({
      where: {
        productId_locatieId: { productId: product.id, locatieId: restaurant.id },
      },
      create: {
        productId: product.id,
        locatieId: restaurant.id,
        aantal: Number(w.voorraad) || 0,
        minimumDrempel: Number(w.minVoorraad) || 0,
      },
      update: {
        aantal: Number(w.voorraad) || 0,
        minimumDrempel: Number(w.minVoorraad) || 0,
      },
    });
  }

  console.log(`Klaar. Nieuw: ${nieuw}, bijgewerkt: ${bijgewerkt}.`);
  console.log(
    'Barcodes zijn voorlopige in-store EAN-13 (prefix 20). Vervang door echte EAN waar beschikbaar.',
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
