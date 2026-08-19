// Genereert een geldige in-store EAN-13 (prefix 20) uit een volgnummer.
// In-store barcodes (GS1-prefix 20-29) zijn bedoeld voor eigen gebruik binnen
// de winkel — voor producten zonder eigen EAN op de verpakking.
export function genereerBarcode(volgnr: number): string {
  const body = ('20' + String(volgnr).padStart(10, '0')).slice(0, 12);
  let som = 0;
  for (let i = 0; i < 12; i++) {
    const d = Number(body[i]);
    som += i % 2 === 0 ? d : d * 3;
  }
  const check = (10 - (som % 10)) % 10;
  return body + String(check);
}
