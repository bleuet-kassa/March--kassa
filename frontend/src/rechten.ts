import { getVerkoper } from './auth';

// Toegangen per functionaliteit — dezelfde sleutels als backend/src/common/rechten.ts.
// Een beheerder (BEHEER/BEHEERDER) heeft altijd alles; de server dwingt dit ook af.
export const RECHTEN: { key: string; naam: string; uitleg: string; groep: string }[] = [
  { key: 'kassa', naam: 'Kassa', uitleg: 'Verkopen, retour, leeggoed, op rekening', groep: 'Dagelijks' },
  { key: 'verkopen', naam: 'Verkopen', uitleg: 'Tickets herdrukken, annuleren, betaalwijze corrigeren', groep: 'Dagelijks' },
  { key: 'open_rekeningen', naam: 'Open rekeningen', uitleg: 'Betalingen van klanten ontvangen', groep: 'Dagelijks' },
  { key: 'beheer', naam: 'Beheer producten', uitleg: 'Producten, categorieën, voorraad ontvangen', groep: 'Dagelijks' },
  { key: 'cadeaubonnen', naam: 'Cadeaubons', uitleg: 'Register, aanmaken, inwisselen', groep: 'Dagelijks' },
  { key: 'dagafsluiting', naam: 'Dagafsluiting', uitleg: 'Zelf afsluiten en register bekijken (zonder: enkel aanvragen)', groep: 'Beheer' },
  { key: 'rekeningen', naam: 'Klant factuur', uitleg: 'Bedrijven op rekening, maandbudget, factureren', groep: 'Beheer' },
  { key: 'facturen', naam: 'Facturen inlezen', uitleg: 'Aankoopfacturen inlezen naar de voorraad', groep: 'Beheer' },
  { key: 'kortingen', naam: 'Kortingen', uitleg: 'Regelingen beheren en toepassen aan de kassa', groep: 'Beheer' },
  { key: 'webshop', naam: 'Webshop', uitleg: 'Assortiment en bestellingen', groep: 'Beheer' },
  { key: 'website', naam: 'Website', uitleg: 'Teksten, openingsuren, partners', groep: 'Beheer' },
  { key: 'personeel', naam: 'Personeel', uitleg: 'Accounts beheren (rol en toegangen wijzigen blijft beheerder)', groep: 'Beheer' },
  { key: 'rapporten', naam: 'Rapporten', uitleg: 'Omzet, marges, dashboard', groep: 'Cijfers' },
  { key: 'boekhouding', naam: 'Boekhouding', uitleg: 'Scrada, verkoopfacturen, rekeningen mailen', groep: 'Cijfers' },
  { key: 'instellingen', naam: 'Instellingen', uitleg: 'Onderneming, meldingen', groep: 'Cijfers' },
];
export const STANDAARD_RECHTEN = ['kassa', 'verkopen', 'open_rekeningen', 'beheer', 'cadeaubonnen'];

export const isAdminRol = (rol?: string | null) => rol === 'BEHEER' || rol === 'BEHEERDER';

// Heeft de ingelogde persoon toegang tot dit onderdeel?
export function heeftRecht(key: string): boolean {
  const v = getVerkoper();
  if (!v) return false;
  if (isAdminRol(v.rol)) return true;
  return (v.rechten ?? STANDAARD_RECHTEN).includes(key);
}
