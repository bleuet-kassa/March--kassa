import { Prisma } from '@prisma/client';

// Wat in de dagontvangsten en de omzet telt: kassaverkopen en webshopbestellingen die echt
// online betaald zijn (testbetalingen en oudere bestellingen hebben die betaalwijze niet).
export const TELT_IN_ONTVANGSTEN: Prisma.VerkoopWhereInput = { OR: [{ kanaal: 'KASSA' }, { kanaal: 'WEBSHOP', betaalwijze: 'ONLINE' }] };

// Kalenderdag (YYYY-MM-DD) van een tijdstip in Brusselse tijd.
export function kassadag(d: Date): string {
  const p = new Intl.DateTimeFormat('nl-BE', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')}`;
}

// Boekdatum van een dagafsluiting = de gestarte kassadag: de dag van de EERSTE verkoop
// sinds de vorige afsluiting (bewaard in `boekdatum`; `vanaf` is diezelfde eerste verkoop).
// Afsluiten na middernacht boekt dus nog op de dag zelf, niet op de volgende.
export function boekdatumVan(a: { boekdatum?: string | null; vanaf?: Date | null; tot: Date }): string {
  return a.boekdatum || kassadag(a.vanaf ?? a.tot);
}
