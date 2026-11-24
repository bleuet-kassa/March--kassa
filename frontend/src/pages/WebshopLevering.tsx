import { useEffect, useState, type CSSProperties } from 'react';
import { getLeverInstellingen, testLevering, zetLeverInstellingen, type Leveradres, type LeverRegel } from '../api/client';

// Invulvelden houden tekst bij (komma mag); bij het bewaren worden het getallen.
type RegelVelden = { actief: boolean; naam: string; vanafBedrag: string; vanafKm: string; totKm: string; soort: LeverRegel['soort']; bedrag: string };
const AANTAL_REGELS = 4;
const leegRegel = (): RegelVelden => ({ actief: false, naam: '', vanafBedrag: '', vanafKm: '', totKm: '', soort: 'FORFAIT', bedrag: '' });
const tekst = (n: number | null | undefined) => (n == null ? '' : String(n).replace('.', ','));
// Een getal zoals 250, 0,80 of 12.5: hoogstens één komma (of punt) met 1 of 2 cijfers erna.
// Geen duizendtalpunten: "1.000" zou anders stilletjes 1 worden.
const GETAL = /^\d{1,6}([.,]\d{1,2})?$/;
const geldig = (s: string) => s.trim() === '' || GETAL.test(s.trim());
const getal = (s: string) => (s.trim() === '' || !GETAL.test(s.trim()) ? null : Number(s.trim().replace(',', '.')));
const euro = (n: number) => '€ ' + n.toFixed(2).replace('.', ',');
const heeftVoorwaarde = (r: RegelVelden) => !!(r.vanafBedrag.trim() || r.vanafKm.trim() || r.totKm.trim());
// Kunnen twee regels voor dezelfde afstand gelden? (Bedragen zijn altijd "vanaf", die overlappen altijd.)
const zelfdeAfstand = (a: RegelVelden, b: RegelVelden) =>
  Math.max(getal(a.vanafKm) ?? 0, getal(b.vanafKm) ?? 0) <= Math.min(getal(a.totKm) ?? Infinity, getal(b.totKm) ?? Infinity);

// Leverkosten instellen: vanwaar we leveren, de standaardprijs (per km of een forfait) en
// maximaal 4 uitzonderingsregels. De eerste regel die past, telt.
export function WebshopLevering() {
  const [vertrek, setVertrek] = useState<Leveradres>({ straat: '', postcode: '', gemeente: '' });
  const [standaardSoort, setStandaardSoort] = useState<'KM' | 'FORFAIT'>('KM');
  const [standaardBedrag, setStandaardBedrag] = useState('');
  const [regels, setRegels] = useState<RegelVelden[]>(() => Array.from({ length: AANTAL_REGELS }, leegRegel));
  const [klaar, setKlaar] = useState(false);
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState('');
  const [melding, setMelding] = useState('');
  const [proef, setProef] = useState({ straat: '', postcode: '', gemeente: '', bedrag: '' });
  const [proefUitkomst, setProefUitkomst] = useState('');

  useEffect(() => {
    getLeverInstellingen().then((i) => {
      if (i.vertrekadres) setVertrek(i.vertrekadres);
      setStandaardSoort(i.standaard.soort);
      setStandaardBedrag(tekst(i.standaard.bedrag));
      setRegels(Array.from({ length: AANTAL_REGELS }, (_, k) => {
        const r = i.regels[k];
        return r ? { actief: r.actief, naam: r.naam, vanafBedrag: tekst(r.vanafBedrag), vanafKm: tekst(r.vanafKm), totKm: tekst(r.totKm), soort: r.soort, bedrag: tekst(r.bedrag) } : leegRegel();
      }));
      setKlaar(i.klaar);
    }).catch((e) => setFout(e instanceof Error ? e.message : 'Laden mislukt'));
  }, []);

  function zetRegel(k: number, wijziging: Partial<RegelVelden>) {
    setRegels((lijst) => lijst.map((r, i) => (i === k ? { ...r, ...wijziging } : r)));
  }
  // De volgorde telt (de eerste regel die past): een regel een plaats hoger of lager zetten.
  function verschuif(k: number, richting: -1 | 1) {
    setRegels((lijst) => {
      const j = k + richting;
      if (j < 0 || j >= lijst.length) return lijst;
      const kopie = [...lijst];
      [kopie[k], kopie[j]] = [kopie[j], kopie[k]];
      return kopie;
    });
  }

  async function bewaar() {
    setFout(''); setMelding('');
    // Eerst de getallen nakijken: een tikfout mag nooit stilletjes "geen voorwaarde" worden.
    const fouten = [
      ...(geldig(standaardBedrag) ? [] : ['de standaardprijs']),
      ...regels.flatMap((r, k) => [
        ...(geldig(r.vanafBedrag) ? [] : [`regel ${k + 1}: bestelling vanaf`]),
        ...(geldig(r.vanafKm) ? [] : [`regel ${k + 1}: afstand vanaf`]),
        ...(geldig(r.totKm) ? [] : [`regel ${k + 1}: afstand tot`]),
        ...(geldig(r.bedrag) ? [] : [`regel ${k + 1}: bedrag`]),
      ]),
    ];
    if (fouten.length) { setFout(`Kijk na: ${fouten.join(', ')}. Schrijf een getal zoals 250 of 0,80, zonder punt voor de duizendtallen.`); return; }
    setBezig(true);
    try {
      await zetLeverInstellingen({
        vertrekadres: vertrek, vertrekpunt: null,
        standaard: { soort: standaardSoort, bedrag: getal(standaardBedrag) },
        regels: regels.map((r) => ({ actief: r.actief, naam: r.naam, vanafBedrag: getal(r.vanafBedrag), vanafKm: getal(r.vanafKm), totKm: getal(r.totKm), soort: r.soort, bedrag: getal(r.bedrag) })),
      });
      setKlaar(true);
      setMelding('Leverkosten bewaard.');
    } catch (e) { setFout(e instanceof Error ? e.message : 'Bewaren mislukt'); }
    finally { setBezig(false); }
  }

  async function probeer() {
    if (!geldig(proef.bedrag)) { setProefUitkomst('Schrijf het bestelbedrag als een getal, bv. 250 of 42,50.'); return; }
    setProefUitkomst('Berekenen…');
    try {
      const r = await testLevering({ straat: proef.straat, postcode: proef.postcode, gemeente: proef.gemeente }, getal(proef.bedrag) ?? 0);
      const afstand = r.km != null ? `${String(r.km).replace('.', ',')} km` : '';
      setProefUitkomst(r.ok
        ? `${afstand}: leverkost ${r.bedrag ? euro(r.bedrag) : 'gratis'}${r.regel ? ` (${r.regel})` : ' (standaard)'}`
        : `${afstand ? afstand + ': ' : ''}${r.melding}`);
    } catch (e) { setProefUitkomst(e instanceof Error ? e.message : 'Proberen mislukt'); }
  }

  return (
    <div style={{ maxWidth: 900 }}>
      <p style={{ color: '#6b7280', marginTop: 0 }}>
        De leverkost hangt af van de afstand in vogelvlucht tussen de winkel en het leveradres. Je kan uitzonderingen maken, bijvoorbeeld niet leveren verder dan 30 km, of gratis leveren vanaf € 250.
        De klant ziet de leverkost in het mandje, nog voor de betaling.
      </p>
      <div style={{ padding: '8px 12px', borderRadius: 8, marginBottom: 12, background: klaar ? '#dcfce7' : '#fef3c7', color: klaar ? '#166534' : '#92400e', fontSize: 14 }}>
        {klaar ? 'Leveren is ingesteld. Zet in de kalender de dagen aan waarop je levert.' : 'Nog niet ingesteld: vul het vertrekadres en de standaardprijs in. Tot dan kan niemand levering kiezen.'}
      </div>

      <section style={kaart}>
        <h3 style={{ marginTop: 0 }}>Vertrekadres (de winkel)</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr) minmax(0, 2fr)', gap: 8 }}>
          <label style={lab}>Straat en huisnummer<input value={vertrek.straat} onChange={(e) => setVertrek({ ...vertrek, straat: e.target.value })} style={inp} /></label>
          <label style={lab}>Postcode<input value={vertrek.postcode} onChange={(e) => setVertrek({ ...vertrek, postcode: e.target.value })} inputMode="numeric" maxLength={4} style={inp} /></label>
          <label style={lab}>Gemeente<input value={vertrek.gemeente} onChange={(e) => setVertrek({ ...vertrek, gemeente: e.target.value })} style={inp} /></label>
        </div>
      </section>

      <section style={kaart}>
        <h3 style={{ marginTop: 0 }}>Standaard</h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={standaardSoort} onChange={(e) => setStandaardSoort(e.target.value as 'KM' | 'FORFAIT')} aria-label="Soort standaardprijs" style={inp}>
            <option value="KM">Per kilometer</option>
            <option value="FORFAIT">Forfait</option>
          </select>
          <span>€</span>
          <input value={standaardBedrag} onChange={(e) => setStandaardBedrag(e.target.value)} inputMode="decimal" aria-label="Standaardprijs" style={{ ...inp, width: 90 }} />
          <span style={{ color: '#6b7280', fontSize: 14 }}>{standaardSoort === 'KM' ? 'per km (vogelvlucht, enkele rit)' : 'per levering'}</span>
        </div>
      </section>

      <section style={kaart}>
        <h3 style={{ marginTop: 0 }}>Uitzonderingen</h3>
        <div style={{ color: '#6b7280', fontSize: 13, marginBottom: 8 }}>
          De eerste regel die past, telt. Zet "Niet leveren" daarom bovenaan, tenzij een regel erboven bewust voorgaat (bv. grote bestellingen toch ver leveren tegen een forfait).
          Een lege voorwaarde telt niet mee. Een forfait van € 0 betekent gratis leveren. Het bestelbedrag is wat de artikels samen kosten, zonder statiegeld.
        </div>
        {regels.map((r, k) => {
          // Een "Niet leveren"-regel onder een regel die ook kan passen: die erboven gaat voor.
          const voorgaand = r.actief && r.soort === 'NIET'
            ? regels.slice(0, k).map((x, i) => ({ x, i })).filter(({ x }) => x.actief && x.soort !== 'NIET' && heeftVoorwaarde(x) && zelfdeAfstand(x, r)).map(({ i }) => i + 1)
            : [];
          return (
          <div key={k} style={{ borderTop: '1px solid #f0f0f0', padding: '10px 0', opacity: r.actief ? 1 : 0.6 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <button type="button" onClick={() => verschuif(k, -1)} disabled={k === 0} aria-label={`Regel ${k + 1} hoger`} style={btnPijl}>↑</button>
              <button type="button" onClick={() => verschuif(k, 1)} disabled={k === regels.length - 1} aria-label={`Regel ${k + 1} lager`} style={btnPijl}>↓</button>
            </div>
            <label style={{ ...lab, flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 70 }}>
              <input type="checkbox" checked={r.actief} onChange={(e) => zetRegel(k, { actief: e.target.checked })} /> Regel {k + 1}
            </label>
            <label style={lab}>Naam<input value={r.naam} onChange={(e) => zetRegel(k, { naam: e.target.value })} placeholder="bv. Grote bestelling" maxLength={40} style={{ ...inp, width: 150 }} /></label>
            <label style={lab}>Bestelling vanaf €<input value={r.vanafBedrag} onChange={(e) => zetRegel(k, { vanafBedrag: e.target.value })} inputMode="decimal" style={{ ...inp, width: 80 }} /></label>
            <label style={lab}>Afstand vanaf km<input value={r.vanafKm} onChange={(e) => zetRegel(k, { vanafKm: e.target.value })} inputMode="decimal" style={{ ...inp, width: 70 }} /></label>
            <label style={lab}>Afstand tot km<input value={r.totKm} onChange={(e) => zetRegel(k, { totKm: e.target.value })} inputMode="decimal" style={{ ...inp, width: 70 }} /></label>
            <label style={lab}>Dan
              <select value={r.soort} onChange={(e) => zetRegel(k, { soort: e.target.value as LeverRegel['soort'] })} style={inp}>
                <option value="FORFAIT">Forfait</option>
                <option value="KM">Per kilometer</option>
                <option value="NIET">Niet leveren</option>
              </select>
            </label>
            {r.soort !== 'NIET' && (
              <label style={lab}>{r.soort === 'KM' ? '€ per km' : '€'}<input value={r.bedrag} onChange={(e) => zetRegel(k, { bedrag: e.target.value })} inputMode="decimal" style={{ ...inp, width: 80 }} /></label>
            )}
          </div>
          {voorgaand.length > 0 && (
            <div style={{ marginTop: 6, fontSize: 13, color: '#92400e', background: '#fef3c7', borderRadius: 6, padding: '6px 10px' }}>
              Let op: {voorgaand.length === 1 ? `regel ${voorgaand[0]} staat` : `regels ${voorgaand.join(' en ')} staan`} hoger en {voorgaand.length === 1 ? 'kan' : 'kunnen'} ook voor deze afstanden gelden.
              Een bestelling die daaraan voldoet, wordt dan toch geleverd. Is dat niet de bedoeling? Zet deze regel dan hoger met ↑ en bewaar.
            </div>
          )}
          </div>
          );
        })}
      </section>

      {fout && <p style={{ color: 'crimson' }}>{fout}</p>}
      {melding && <p style={{ color: '#166534' }}>{melding}</p>}
      <button onClick={bewaar} disabled={bezig} style={btnBlauw}>{bezig ? 'Bewaren…' : 'Leverkosten bewaren'}</button>

      <section style={kaart}>
        <h3 style={{ marginTop: 0 }}>Uitproberen</h3>
        <div style={{ color: '#6b7280', fontSize: 13, marginBottom: 8 }}>Met de bewaarde instellingen: wat kost een levering naar dit adres?</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={lab}>Straat en huisnummer<input value={proef.straat} onChange={(e) => setProef({ ...proef, straat: e.target.value })} style={{ ...inp, width: 200 }} /></label>
          <label style={lab}>Postcode<input value={proef.postcode} onChange={(e) => setProef({ ...proef, postcode: e.target.value })} inputMode="numeric" maxLength={4} style={{ ...inp, width: 70 }} /></label>
          <label style={lab}>Gemeente<input value={proef.gemeente} onChange={(e) => setProef({ ...proef, gemeente: e.target.value })} style={{ ...inp, width: 140 }} /></label>
          <label style={lab}>Bestelbedrag €<input value={proef.bedrag} onChange={(e) => setProef({ ...proef, bedrag: e.target.value })} inputMode="decimal" style={{ ...inp, width: 80 }} /></label>
          <button onClick={probeer} style={btnMini}>Bereken</button>
        </div>
        {proefUitkomst && <div style={{ marginTop: 8, fontWeight: 600 }}>{proefUitkomst}</div>}
      </section>
      <div style={{ fontSize: 12, color: '#6b7280' }}>Adressen worden opgezocht met gegevens van © OpenStreetMap-bijdragers.</div>
    </div>
  );
}

const kaart: CSSProperties = { border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, margin: '12px 0' };
const lab: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12, color: '#6b7280' };
const inp: CSSProperties = { padding: 6, fontSize: 14, boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 6, minWidth: 0 };
const btnBlauw: CSSProperties = { padding: '9px 16px', border: 'none', borderRadius: 6, background: '#0d4589', color: '#fff', cursor: 'pointer', fontWeight: 600 };
const btnMini: CSSProperties = { padding: '6px 12px', border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 13 };
const btnPijl: CSSProperties = { padding: '0 6px', border: '1px solid #e5e7eb', borderRadius: 4, background: '#fff', cursor: 'pointer', fontSize: 12, lineHeight: '16px' };
