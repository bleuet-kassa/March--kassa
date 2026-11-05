import type { Openingsuur } from '../api/client';

// Op welke dagen kan een klant afhalen: de dagen dat de winkel open is, plus de extra
// afhaaldagen uit het Website-scherm (SiteTekst `extra_afhaaldagen`). De server controleert hetzelfde.
export type Afhaaldag = { iso: string; van: string | null; tot: string | null; extra: boolean };

const VOORUIT_DAGEN = 120;

export const vandaagBrussel = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Brussels' }).format(new Date());
const uurBrussel = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' }).format(new Date());

export const dagNaam = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('nl-BE', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' });

export function leesExtraAfhaaldagen(waarde: string | undefined): string[] {
  if (!waarde) return [];
  try { const v = JSON.parse(waarde); return Array.isArray(v) ? v.filter((x) => typeof x === 'string').sort() : []; }
  catch { return []; }
}

export function komendeAfhaaldagen(openingsuren: Openingsuur[], extra: string[]): Afhaaldag[] {
  const perDag = new Map(openingsuren.map((u) => [u.dag, u]));
  const vandaag = vandaagBrussel();
  const uit: Afhaaldag[] = [];
  const start = new Date(`${vandaag}T12:00:00Z`).getTime();
  for (let i = 0; i < VOORUIT_DAGEN; i++) {
    const d = new Date(start + i * 24 * 3600 * 1000);
    const iso = d.toISOString().slice(0, 10);
    if (extra.includes(iso)) { uit.push({ iso, van: null, tot: null, extra: true }); continue; }
    const uren = perDag.get(((d.getUTCDay() + 6) % 7) + 1);
    if (uren?.gesloten) continue;
    if (i === 0 && uren?.tot && uurBrussel() >= uren.tot) continue; // vandaag al dicht
    uit.push({ iso, van: uren?.van ?? null, tot: uren?.tot ?? null, extra: false });
  }
  const laatste = uit[uit.length - 1]?.iso ?? vandaag;
  for (const iso of extra) if (iso > laatste) uit.push({ iso, van: null, tot: null, extra: true });
  return uit;
}
