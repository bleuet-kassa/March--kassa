// Zoeken op naam in het scanvak van de kassa. Werkt op de lokale productcache (dus ook offline).
// Hoofdletters, accenten, apostrofs en leestekens tellen niet ("creme" vindt "Crème", "kopke - porto"
// vindt "Kopke — Porto"), en elk woord moet in de naam voorkomen, in eender welke volgorde
// ("tonic fever" vindt "Fever Tree — Indian Tonic").

// Het minimum dat de zoekfunctie van een product nodig heeft.
export type Zoekbaar = { naam: string; barcode: string | null; vrijePrijs?: boolean; isStatiegeld?: boolean };
type Ingang<T> = { p: T; woorden: string[]; kern: string };
export type ZoekIndex<T extends Zoekbaar> = Ingang<T>[];
export type Zoekresultaat<T> = {
  treffers: T[]; // de beste eerst, hoogstens MAX_TREFFERS
  meer: number; // hoeveel er nog meer zijn
  enige: T | null; // zonder twijfel dit artikel (Enter mag het meteen toevoegen)
};

export const MAX_TREFFERS = 12;

// Accenten, hoofdletters en apostrofs weg: "L'Oréal" -> "loreal".
export function normaal(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/['’`´]/g, '').toLowerCase().trim();
}
// De woorden van een tekst (letters en cijfers; leestekens zoals "—", "-", "/", "%" vallen weg).
export const woordenVan = (s: string) => normaal(s).split(/[^a-z0-9]+/).filter(Boolean);

// Vrije bedragen (cadeaubon) en statiegeld zoek je niet op naam: die hebben hun eigen knop of
// komen automatisch mee met het artikel.
export function maakZoekIndex<T extends Zoekbaar>(producten: T[]): ZoekIndex<T> {
  return producten
    .filter((p) => !p.vrijePrijs && !p.isStatiegeld)
    .map((p) => {
      const woorden = woordenVan(p.naam);
      return { p, woorden, kern: woorden.join(' ') };
    });
}

// Een barcode (of weeg-etiket) en geen naam? Een gekende barcode, of minstens 6 cijfers.
export function isCode(tekst: string, producten: Zoekbaar[]): boolean {
  const t = tekst.trim();
  return /^\d{6,}$/.test(t) || (t !== '' && producten.some((p) => p.barcode === t));
}

// Wordt er op naam gezocht? Minstens 2 tekens, minstens één letter of cijfer, en geen lange
// cijferreeks (dat is een barcode).
export function zoektOpNaam(tekst: string): boolean {
  const t = tekst.trim();
  return t.length >= 2 && !/^\d{6,}$/.test(t) && woordenVan(t).length > 0;
}

// De beste treffers eerst: exact dezelfde naam (0), namen die ermee beginnen (1), namen waarin elk
// woord het begin van een woord is (2), dan de rest, middenin een woord (3); daarbinnen alfabetisch.
// "enige": één treffer die op een woordbegin past, of één artikel met precies die naam. Een losse
// treffer middenin een woord ("rum" in "Arums") is nooit zeker: die toont de kassa eerst.
export function zoekOpNaam<T extends Zoekbaar>(index: ZoekIndex<T>, tekst: string): Zoekresultaat<T> {
  if (!zoektOpNaam(tekst)) return { treffers: [], meer: 0, enige: null };
  const delen = woordenVan(tekst);
  const kern = delen.join(' ');
  const gevonden: { p: T; kern: string; rang: number }[] = [];
  for (const x of index) {
    if (!delen.every((d) => x.kern.includes(d))) continue;
    const rang = x.kern === kern ? 0
      : x.kern.startsWith(kern) ? 1
      : delen.every((d) => x.woorden.some((w) => w.startsWith(d))) ? 2
      : 3;
    gevonden.push({ p: x.p, kern: x.kern, rang });
  }
  gevonden.sort((a, b) => a.rang - b.rang || a.kern.localeCompare(b.kern, 'nl'));
  const exact = gevonden.filter((g) => g.rang === 0);
  const enige = gevonden.length === 1 && gevonden[0].rang <= 2 ? gevonden[0].p
    : exact.length === 1 ? exact[0].p
    : null;
  return { treffers: gevonden.slice(0, MAX_TREFFERS).map((g) => g.p), meer: Math.max(0, gevonden.length - MAX_TREFFERS), enige };
}
