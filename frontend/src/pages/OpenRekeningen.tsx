import { useEffect, useState, type CSSProperties } from 'react';
import { getOpenRekeningen, registreerRekeningBetaling, type OpenRekening } from '../api/client';

const euro = (n: number) => '€ ' + Number(n).toFixed(2);
const datumNl = (s: string) => new Date(s).toLocaleDateString('nl-BE');
// Echte betaalwijzen om een rekening te vereffenen — nooit opnieuw "op rekening".
const BETAALWIJZEN: [string, string][] = [
  ['BANCONTACT', 'Bancontact'], ['CASH', 'Cash'], ['KAART', 'Kaart'], ['OVERSCHRIJVING', 'Overschrijving'], ['QR', 'QR-code'], ['CADEAUBON', 'Cadeaubon'],
];

// Open rekeningen — voor alle medewerkers: per klant het openstaande bedrag
// (rekeningen én facturen die nog niet betaald zijn) en een knop om een
// betaling in ontvangst te nemen. De betaling komt op de dagafsluiting van
// vandaag (+ betaalwijze, − op rekening) en wordt oudste-eerst toegewezen.
export function OpenRekeningen() {
  const [lijst, setLijst] = useState<OpenRekening[]>([]);
  const [fout, setFout] = useState('');
  const [melding, setMelding] = useState('');
  const [bezig, setBezig] = useState(false);
  const [actief, setActief] = useState<string | null>(null); // sleutel van de klant waarvoor het betaalformulier open staat
  const [bedrag1, setBedrag1] = useState('');
  const [bw1, setBw1] = useState('BANCONTACT');
  const [gesplitst, setGesplitst] = useState(false);
  const [bedrag2, setBedrag2] = useState('');
  const [bw2, setBw2] = useState('CASH');
  const [zoek, setZoek] = useState('');

  async function laad() {
    setFout('');
    try { setLijst(await getOpenRekeningen()); }
    catch (e) { setFout(e instanceof Error ? e.message : 'Laden mislukt'); }
  }
  useEffect(() => { laad(); }, []);

  const parse = (s: string) => { const n = Number(s.replace(',', '.')); return Number.isNaN(n) ? 0 : Math.round(n * 100) / 100; };

  function open(g: OpenRekening) {
    setActief(g.sleutel); setBedrag1(g.open.toFixed(2)); setBw1('BANCONTACT'); setGesplitst(false); setBedrag2(''); setBw2('CASH'); setMelding('');
  }

  async function betaal(g: OpenRekening) {
    const betalingen = [{ betaalwijze: bw1, bedrag: parse(bedrag1) }];
    if (gesplitst) betalingen.push({ betaalwijze: bw2, bedrag: parse(bedrag2) });
    const totaal = Math.round(betalingen.reduce((s, b) => s + b.bedrag, 0) * 100) / 100;
    if (totaal <= 0) { setFout('Vul een bedrag in.'); return; }
    if (totaal > g.open + 0.005) { setFout(`Het bedrag (${euro(totaal)}) is hoger dan het openstaande (${euro(g.open)}).`); return; }
    if (!window.confirm(`Betaling van ${euro(totaal)} ontvangen van ${g.naam}?\n\n${betalingen.map((b) => `${BETAALWIJZEN.find(([k]) => k === b.betaalwijze)?.[1] ?? b.betaalwijze}: ${euro(b.bedrag)}`).join('\n')}${totaal < g.open ? `\n\nBlijft open: ${euro(g.open - totaal)}` : '\n\nDe rekening is daarmee volledig betaald.'}`)) return;
    setBezig(true); setFout(''); setMelding('');
    try {
      const r = await registreerRekeningBetaling(g.sleutel, betalingen);
      setMelding(`✔ ${euro(r.totaal)} ontvangen van ${g.naam}${r.restNaBetaling > 0.005 ? ` — blijft open: ${euro(r.restNaBetaling)}` : ' — rekening volledig betaald'}. Staat op de dagafsluiting van vandaag.`);
      setActief(null);
      await laad();
    } catch (e) { setFout(e instanceof Error ? e.message : 'Betaling registreren mislukt'); }
    finally { setBezig(false); }
  }

  const zichtbaar = lijst.filter((g) => !zoek.trim() || g.naam.toLowerCase().includes(zoek.trim().toLowerCase()));
  const totaalOpen = lijst.reduce((s, g) => s + g.open, 0);

  return (
    <div style={{ maxWidth: 860 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>Open rekeningen</h2>
        <span style={{ color: '#6b7280' }}>Totaal openstaand: <strong>{euro(totaalOpen)}</strong> · {lijst.length} klant(en)</span>
      </div>
      <p style={{ color: '#6b7280', marginTop: 4, fontSize: 14 }}>
        Klanten die op rekening kochten, betalen hier hun rekening: met Bancontact, cash, overschrijving, cadeaubon… (nooit opnieuw op rekening). De betaling komt op de dagafsluiting van vandaag.
      </p>
      <input value={zoek} onChange={(e) => setZoek(e.target.value)} placeholder="Zoek klant…" style={{ ...inp, width: '100%', maxWidth: 360, marginBottom: 12 }} />
      {fout && <p style={{ color: 'crimson' }}>{fout}</p>}
      {melding && <p style={{ color: '#166534', background: '#f0fdf4', border: '1px solid #86efac', padding: '8px 12px', borderRadius: 8, fontWeight: 600 }}>{melding}</p>}

      {zichtbaar.map((g) => (
        <div key={g.sleutel} style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 14, marginBottom: 10 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{g.naam}</div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>
                {g.btwNummer ? g.btwNummer : 'particulier'}{g.telefoon ? ` · ☎ ${g.telefoon}` : ''}{g.adres ? ` · ${g.adres}` : ''} · {g.items.length} open post(en)
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 12, color: '#6b7280' }}>Openstaand</div>
              <div style={{ fontWeight: 700, fontSize: 20, color: '#b45309' }}>{euro(g.open)}</div>
            </div>
            {actief !== g.sleutel && <button onClick={() => open(g)} style={btnGroen}>Betaling ontvangen</button>}
          </div>

          <div style={{ overflowX: 'auto', marginTop: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 420 }}>
              <tbody>
                {g.items.map((it) => (
                  <tr key={it.id} style={{ borderTop: '1px solid #f3f4f6' }}>
                    <td style={{ padding: 4, whiteSpace: 'nowrap' }}>{datumNl(it.datum)}</td>
                    <td style={{ padding: 4 }}>{it.nummer} · {it.bron === 'MAANDFACTUUR' ? `maandfactuur ${it.periode ?? ''}` : 'ticket'}{it.naarScrada ? '' : ' (rekening)'}</td>
                    <td style={{ padding: 4, textAlign: 'right', whiteSpace: 'nowrap', color: '#6b7280' }}>{it.betaald > 0 ? `${euro(it.betaald)} betaald van ${euro(it.totaal)}` : euro(it.totaal)}</td>
                    <td style={{ padding: 4, textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600 }}>{euro(it.rest)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {actief === g.sleutel && (
            <div style={{ marginTop: 10, padding: 12, border: '1px solid #e5e7eb', borderRadius: 10, background: '#fafafa' }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Betaling ontvangen van {g.naam}</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <select value={bw1} onChange={(e) => setBw1(e.target.value)} style={inp}>
                  {BETAALWIJZEN.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
                </select>
                <input value={bedrag1} onChange={(e) => setBedrag1(e.target.value)} inputMode="decimal" placeholder="Bedrag" style={{ ...inp, width: 110, textAlign: 'right' }} />
                <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}>
                  <input type="checkbox" checked={gesplitst} onChange={(e) => { setGesplitst(e.target.checked); if (e.target.checked) { const r = Math.round((g.open - parse(bedrag1)) * 100) / 100; setBedrag2(r > 0 ? r.toFixed(2) : ''); } }} />
                  Gesplitst (2 betaalwijzen)
                </label>
              </div>
              {gesplitst && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
                  <select value={bw2} onChange={(e) => setBw2(e.target.value)} style={inp}>
                    {BETAALWIJZEN.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
                  </select>
                  <input value={bedrag2} onChange={(e) => setBedrag2(e.target.value)} inputMode="decimal" placeholder="Bedrag" style={{ ...inp, width: 110, textAlign: 'right' }} />
                </div>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <button onClick={() => betaal(g)} disabled={bezig} style={btnGroen}>{bezig ? 'Bezig…' : `✔ ${euro(Math.round((parse(bedrag1) + (gesplitst ? parse(bedrag2) : 0)) * 100) / 100)} ontvangen`}</button>
                <button onClick={() => setActief(null)} disabled={bezig} style={btnGrijs}>Annuleren</button>
                <span style={{ fontSize: 12, color: '#6b7280' }}>Minder dan het openstaande = gedeeltelijke betaling; de rest blijft open.</span>
              </div>
            </div>
          )}
        </div>
      ))}
      {lijst.length === 0 && !fout && <p style={{ color: '#999' }}>Geen openstaande rekeningen. 🎉</p>}
      {lijst.length > 0 && zichtbaar.length === 0 && <p style={{ color: '#999' }}>Geen klant gevonden voor "{zoek}".</p>}
    </div>
  );
}

const inp: CSSProperties = { padding: 9, fontSize: 15, border: '1px solid #cbd5e1', borderRadius: 6, boxSizing: 'border-box' };
const btnGroen: CSSProperties = { padding: '10px 16px', border: 'none', borderRadius: 8, background: '#16a34a', color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: 15 };
const btnGrijs: CSSProperties = { padding: '10px 14px', border: '1px solid #cbd5e1', borderRadius: 8, background: '#fff', cursor: 'pointer', fontSize: 14 };
