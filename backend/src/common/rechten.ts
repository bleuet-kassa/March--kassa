// Toegangen per functionaliteit. Een beheerder (BEHEER/BEHEERDER) heeft altijd
// alles en is de enige die toegangen mag toekennen. Voor de andere accounts
// bepaalt de lijst `Gebruiker.rechten` wat ze zien en mogen; staat die nog niet
// ingesteld (null), dan gelden de standaardtoegangen van de kassa.
// Dezelfde lijst staat in de frontend (src/rechten.ts) — samen aanpassen.
export const RECHTEN = [
  'kassa',           // Kassa: verkopen, retour, leeggoed, op rekening
  'verkopen',        // Verkopen: tickets herdrukken, annuleren, betaalwijze corrigeren
  'open_rekeningen', // Open rekeningen: betalingen van klanten ontvangen
  'beheer',          // Beheer: producten, categorieën, voorraad ontvangen
  'cadeaubonnen',    // Cadeaubons: register, aanmaken, inwisselen
  'dagafsluiting',   // Dagafsluiting: zelf afsluiten en register bekijken (zonder: enkel aanvragen)
  'rekeningen',      // Klant factuur: bedrijven op rekening, maandbudget, factureren
  'facturen',        // Facturen inlezen (aankoopfacturen → voorraad)
  'boekhouding',     // Boekhouding: Scrada, verkoopfacturen, rekeningen mailen
  'rapporten',       // Rapporten: omzet, marges, dashboard
  'kortingen',       // Kortingen: regelingen beheren en toepassen aan de kassa
  'webshop',         // Webshop: assortiment en bestellingen
  'website',         // Website: teksten, openingsuren, partners
  'personeel',       // Personeel: accounts (rol en toegangen wijzigen blijft beheerder)
  'instellingen',    // Instellingen: onderneming, meldingen
] as const;
export type Recht = (typeof RECHTEN)[number];

// Wat een gewoon kassa-account mag zolang er niets specifieks is ingesteld.
export const STANDAARD_RECHTEN: Recht[] = ['kassa', 'verkopen', 'open_rekeningen', 'beheer', 'cadeaubonnen'];

export const ADMIN_ROLLEN = ['BEHEER', 'BEHEERDER'];
export const isAdminRol = (rol?: string | null) => ADMIN_ROLLEN.includes(String(rol ?? ''));

// De toegangen die effectief gelden voor een account.
export function effectieveRechten(rol: string, rechten: unknown): Recht[] {
  if (isAdminRol(rol)) return [...RECHTEN];
  if (Array.isArray(rechten)) return rechten.filter((r): r is Recht => (RECHTEN as readonly string[]).includes(String(r)));
  return [...STANDAARD_RECHTEN];
}

// Opgegeven lijst opschonen (onbekende sleutels weg, dubbels weg).
export function normaliseerRechten(input: unknown): Recht[] {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.map(String))].filter((r): r is Recht => (RECHTEN as readonly string[]).includes(r));
}
