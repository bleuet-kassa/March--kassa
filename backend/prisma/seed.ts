// Vult de database met een minimale startset zodat je meteen kan testen:
// twee ondernemingen, twee locaties, twee BTW-tarieven en een paar producten.
import { PrismaClient, LocatieType, GebruikerRol } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  // Verkopers/medewerkers (voor login + verkoper op het ticket).
  // Standaardwachtwoord voor de testomgeving: "kassa1234" — wijzig in productie.
  const hash = await bcrypt.hash('kassa1234', 10);
  await prisma.gebruiker.upsert({
    where: { email: 'beheerder@winkel.be' },
    create: { naam: 'Beheerder', email: 'beheerder@winkel.be', wachtwoordHash: hash, rol: GebruikerRol.BEHEERDER },
    update: {},
  });
  await prisma.gebruiker.upsert({
    where: { email: 'kassa@winkel.be' },
    create: { naam: 'Kassa', email: 'kassa@winkel.be', wachtwoordHash: hash, rol: GebruikerRol.KASSA },
    update: {},
  });

  // Afdelingen = winkelsecties (de eerste tegels op de kassa). Producten
  // hangen rechtstreeks aan een afdeling; een categorie is optioneel fijner.
  const afdelingen = [
    'Fruit', 'Groenten', 'Vlees', 'Vis', 'Kaas / Zuivel', 'Traiteur',
    'Droge voeding', 'Onderhoudsproducten', 'Private hygiëne', 'Lifestyle',
  ];
  for (let i = 0; i < afdelingen.length; i++) {
    await prisma.afdeling.upsert({
      where: { naam: afdelingen[i] },
      create: { naam: afdelingen[i], volgorde: i + 1 },
      update: { volgorde: i + 1 },
    });
  }
  // De wijnkelder wordt door de importer aangemaakt; zet 'm achteraan.
  await prisma.afdeling.upsert({
    where: { naam: 'Wijnkelder' },
    create: { naam: 'Wijnkelder', volgorde: 20 },
    update: { volgorde: 20 },
  });

  // Startinhoud voor de publieke website (zelf aanpasbaar via het beheer).
  const siteTeksten: Record<string, string> = {
    hero_eyebrow: 'Versmarkt · Traiteur · Wijnkelder',
    hero_titel: 'De markt in je buurt,',
    hero_titel_accent: 'elke dag vers.',
    hero_intro: 'Fruit en groenten, vlees en vis, kazen, dagverse traiteurgerechten en een goed gevulde wijnkelder — zorgvuldig gekozen en klaar om mee te nemen of te laten leveren.',
    trust1_titel: 'Vers', trust1_sub: 'dagelijks aangevoerd',
    trust2_titel: 'Traiteur', trust2_sub: 'elke dag iets nieuws',
    trust3_titel: 'Wijnkelder', trust3_sub: 'ruime selectie',
    ribbon: 'Vers vandaag',
    card1_naam: 'Belgische aardbeien', card1_sub: 'per bakje · 400 g', card1_prijs: '€ 4,50',
    card2_naam: "Bourgogne rouge '21", card2_sub: 'wijnkelder · 75 cl', card2_prijs: '€ 18,90',
    card3_naam: 'Traiteur: lasagne', card3_sub: 'vers bereid · per portie', card3_prijs: '€ 12,90',
    aanbod_titel: 'Alles voor een goede tafel, onder één dak',
    aanbod_intro: 'Van het ontbijt tot het aperitief. Dit vind je bij Marché — de volledige versafdeling, de traiteur en de wijnkelder.',
    webshop_titel: 'Vandaag online,', webshop_titel_accent: 'straks afgehaald.',
    webshop_intro: 'Een selectie van ons versaanbod en traiteur staat online — elke dag bijgewerkt. Bestel gemakkelijk vooraf en haal af in de winkel, of laat leveren.',
    contact_adres: 'Marktstraat 1, 0000 Gemeente',
    contact_telefoon: '+32 (0)00 00 00 00',
    contact_email: 'info@marché.eu',
  };
  for (const [sleutel, waarde] of Object.entries(siteTeksten)) {
    await prisma.siteTekst.upsert({ where: { sleutel }, create: { sleutel, waarde }, update: {} });
  }
  const uren = [
    { dag: 1, gesloten: true, van: null, tot: null },
    { dag: 2, gesloten: false, van: '08:30', tot: '18:30' },
    { dag: 3, gesloten: false, van: '08:30', tot: '18:30' },
    { dag: 4, gesloten: false, van: '08:30', tot: '18:30' },
    { dag: 5, gesloten: false, van: '08:30', tot: '18:30' },
    { dag: 6, gesloten: false, van: '08:00', tot: '18:00' },
    { dag: 7, gesloten: false, van: '08:00', tot: '12:30' },
  ];
  for (const u of uren) {
    await prisma.openingsuur.upsert({ where: { dag: u.dag }, create: u, update: {} });
  }

  const btwVoeding = await prisma.btwTarief.create({
    data: { naam: 'Voeding 6%', percentage: 6 },
  });
  const btwAlcohol = await prisma.btwTarief.create({
    data: { naam: 'Alcohol 21%', percentage: 21 },
  });
  await prisma.btwTarief.create({
    data: { naam: 'Cadeaubon 0%', percentage: 0 },
  });

  await prisma.onderneming.createMany({
    data: [
      { naam: 'De Winkel', ondernemingsnummer: '0000.000.001', isImporteur: false },
      { naam: 'De Import', ondernemingsnummer: '0000.000.002', isImporteur: true },
    ],
  });

  const winkel = await prisma.stockLocatie.create({
    data: { naam: 'Winkel', type: LocatieType.WINKEL },
  });
  const restaurant = await prisma.stockLocatie.create({
    data: { naam: 'Restaurant', type: LocatieType.RESTAURANT },
  });

  const wijn = await prisma.product.create({
    data: {
      naam: 'Rode wijn — huiswijn',
      barcode: '5410228000011',
      verkoopprijs: 12.5,
      isAlcohol: true,
      btwTariefId: btwAlcohol.id,
    },
  });
  const kaas = await prisma.product.create({
    data: {
      naam: 'Boerenkaas per stuk',
      barcode: '5410228000028',
      verkoopprijs: 6.9,
      isAlcohol: false,
      btwTariefId: btwVoeding.id,
    },
  });

  await prisma.voorraad.createMany({
    data: [
      { productId: wijn.id, locatieId: winkel.id, aantal: 40 },
      { productId: wijn.id, locatieId: restaurant.id, aantal: 10 },
      { productId: kaas.id, locatieId: winkel.id, aantal: 25 },
    ],
  });

  console.log('Startdata toegevoegd.');
}

main().finally(() => prisma.$disconnect());
