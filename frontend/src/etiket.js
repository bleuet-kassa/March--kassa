// Weeg-etiket: barcode herkennen aan de kassa + een scanbaar EAN-13 tekenen
// en afdrukken (gewone printer). Voor de Zebra ZD421t gebruiken we later ZPL.
function ean13Check(body12) {
    let som = 0;
    for (let i = 0; i < 12; i++) {
        const d = Number(body12[i]);
        som += i % 2 === 0 ? d : d * 3;
    }
    return (10 - (som % 10)) % 10;
}
// Weeg-barcode "21" + weegnummer(4) + gram(6) + check(1).
export function parseWeegBarcode(code) {
    const c = (code || '').trim();
    if (!/^21\d{11}$/.test(c))
        return null;
    if (String(ean13Check(c.slice(0, 12))) !== c[12])
        return null;
    return { weegNummer: Number(c.slice(2, 6)), gram: Number(c.slice(6, 12)) };
}
// --- EAN-13 als SVG (zodat het etiket op elke printer scanbaar is) ---
const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
function ean13Modules(code) {
    const d = code.split('').map(Number);
    const patroon = PARITY[d[0]];
    let bits = '101'; // startteken
    for (let i = 0; i < 6; i++)
        bits += (patroon[i] === 'L' ? L : G)[d[1 + i]];
    bits += '01010'; // middenteken
    for (let i = 0; i < 6; i++)
        bits += R[d[7 + i]];
    bits += '101'; // eindteken
    return bits;
}
// Geeft een SVG-string voor een geldige 13-cijferige EAN-13.
export function ean13Svg(code) {
    const c = (code || '').trim();
    if (!/^\d{13}$/.test(c))
        return '';
    const bits = ean13Modules(c);
    const mod = 2; // breedte per module (px)
    const hoogte = 70;
    const quiet = 11 * mod;
    const breedte = quiet * 2 + bits.length * mod;
    let rects = '';
    for (let i = 0; i < bits.length; i++) {
        if (bits[i] === '1')
            rects += `<rect x="${quiet + i * mod}" y="0" width="${mod}" height="${hoogte}" fill="#000"/>`;
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${breedte}" height="${hoogte + 18}" viewBox="0 0 ${breedte} ${hoogte + 18}">`
        + rects
        + `<text x="${breedte / 2}" y="${hoogte + 15}" text-anchor="middle" font-family="monospace" font-size="14">${c}</text>`
        + `</svg>`;
}
// Opent een printvenster met het etiket (naam, gewicht, prijs, barcode).
export function drukEtiketAf(d) {
    const svg = ean13Svg(d.barcode);
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Etiket ${d.naam}</title>
    <style>
      @page { margin: 4mm; }
      body { font-family: system-ui, sans-serif; margin: 0; padding: 6px; width: 52mm; }
      .naam { font-weight: 700; font-size: 15px; }
      .sub { font-size: 12px; color: #333; margin: 2px 0; }
      .prijs { font-size: 22px; font-weight: 800; margin: 4px 0; }
      .bc { margin-top: 4px; }
    </style></head><body>
      <div class="naam">${escapeHtml(d.naam)}</div>
      <div class="sub">${d.gewicht.toFixed(3)} kg &times; € ${d.eenheidsprijs.toFixed(2)}/kg</div>
      <div class="prijs">€ ${d.prijs.toFixed(2)}</div>
      <div class="bc">${svg}</div>
      <script>window.onload=function(){window.print();setTimeout(function(){window.close();},300);};<\/script>
    </body></html>`;
    const w = window.open('', '_blank', 'width=420,height=360');
    if (!w) {
        alert('Sta pop-ups toe om het etiket af te drukken.');
        return;
    }
    w.document.write(html);
    w.document.close();
}
function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
