// Weeg-etiketbarcode: een EAN-13 met prefix "21", zodat ze te onderscheiden is
// van de vaste in-store barcodes (prefix "20"). De barcode draagt het weegnummer
// van het product en het gewicht, zodat de kassa bij het scannen meteen het juiste
// product én gewicht kent (prijs = €/kg × gewicht, server berekent).
//
// Layout (13 cijfers):  2 1 | AAAA (weegnummer) | GGGGGG (gewicht in gram) | C (check)

function ean13Check(body12: string): number {
  let som = 0;
  for (let i = 0; i < 12; i++) {
    const d = Number(body12[i]);
    som += i % 2 === 0 ? d : d * 3;
  }
  return (10 - (som % 10)) % 10;
}

export function encodeWeegBarcode(weegNummer: number, gram: number): string {
  const nr = String(Math.max(0, Math.floor(weegNummer))).padStart(4, '0').slice(-4);
  const g = String(Math.max(0, Math.round(gram))).padStart(6, '0').slice(-6);
  const body = '21' + nr + g;
  return body + String(ean13Check(body));
}

export function parseWeegBarcode(code: string): { weegNummer: number; gram: number } | null {
  const c = (code || '').trim();
  if (!/^21\d{11}$/.test(c)) return null;
  if (String(ean13Check(c.slice(0, 12))) !== c[12]) return null;
  return { weegNummer: Number(c.slice(2, 6)), gram: Number(c.slice(6, 12)) };
}
