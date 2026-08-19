import { useEffect, useState, type CSSProperties } from 'react';
import {
  getScradaStatus, getScradaOpenstaande, getScradaPreview,
  scradaVerstuurEen, scradaVerstuurAlles,
  type ScradaStatus, type OpenstaandeVerkoop, type ScradaFactuur,
} from '../api/client';

// Boekhouding (Fase 3): verkopen "Scrada-klaar" doorsturen (facturen/kasboek/
// Peppol). Zonder API-sleutel draait alles in TESTMODUS (dry-run).
export function Boekhouding() {
  const [status, setStatus] = useState<ScradaStatus | null>(null);
  const [open, setOpen] = useState<OpenstaandeVerkoop[]>([]);
  const [preview, setPreview] = useState<ScradaFactuur | null>(null);
  const [melding, setMelding] = useState('');
  const [bezig, setBezig] = useState(false);

  async function laad() {
    setStatus(await getScradaStatus());
    setOpen(await getScradaOpenstaande());
  }
  useEffect(() => { laad(); }, []);

  async function toon(id: string) {
    setPreview(await getScradaPreview(id));
  }
  async function verstuurEen(id: string) {
    setBezig(true); setMelding('');
    const res = await scradaVerstuurEen(id);
    setMelding(res.modus === 'test'
      ? 'Testmodus: dit zou naar Scrada gaan (niets echt verstuurd).'
      : res.verstuurd ? `Verstuurd (ref ${res.scradaRef}).` : `Fout: ${res.fout}`);
    await laad(); setBezig(false);
  }
  async function verstuurAlles() {
    setBezig(true); setMelding('');
    const res = await scradaVerstuurAlles();
    setMelding(`${res.modus === 'test' ? 'Testmodus — ' : ''}${res.gevonden} gevonden, ${res.verstuurd} verstuurd${res.mislukt ? `, ${res.mislukt} mislukt` : ''}.`);
    await laad(); setBezig(false);
  }

  const euro = (n: number | string) => '€ ' + Number(n).toFixed(2);

  return (
    <div style={{ maxWidth: 1000, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 440px' }}>
        <h2>Boekhouding — Scrada</h2>
        {status && (
          <div style={{ marginBottom: 12 }}>
            <span style={{
              padding: '3px 10px', borderRadius: 99, fontSize: 13, fontWeight: 600,
              background: status.modus === 'live' ? '#dcfce7' : '#fef3c7',
              color: status.modus === 'live' ? '#166534' : '#92400e',
            }}>
              {status.modus === 'live' ? '● Live (Scrada gekoppeld)' : '● Testmodus (geen API-sleutel)'}
            </span>
            <div style={{ marginTop: 10, display: 'flex', gap: 16, fontSize: 14 }}>
              <span>Nog te versturen: <strong>{status.NIET_VERSTUURD}</strong></span>
              <span style={{ color: '#166534' }}>Verstuurd: {status.VERSTUURD}</span>
              {status.FOUT > 0 && <span style={{ color: 'crimson' }}>Fout: {status.FOUT}</span>}
            </div>
          </div>
        )}

        <button onClick={verstuurAlles} disabled={bezig || !open.length}
          style={{ padding: '10px 16px', border: 'none', borderRadius: 8, background: open.length ? '#2563eb' : '#9ca3af', color: '#fff', fontWeight: 700, cursor: open.length ? 'pointer' : 'default' }}>
          {bezig ? 'Bezig…' : `Alle openstaande versturen (${open.length})`}
        </button>
        {melding && <p style={{ color: '#374151', background: '#f3f4f6', padding: '8px 12px', borderRadius: 8 }}>{melding}</p>}

        <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8, fontSize: 14 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd', fontSize: 12, color: '#666' }}>
              <th style={{ padding: 4 }}>Datum</th>
              <th style={{ padding: 4 }}>Klant</th>
              <th style={{ padding: 4, textAlign: 'right' }}>Totaal</th>
              <th style={{ padding: 4 }}>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {open.map((v) => (
              <tr key={v.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                <td style={{ padding: 4 }}>{new Date(v.datum).toLocaleString('nl-BE')}</td>
                <td style={{ padding: 4 }}>{v.klant?.naam ?? 'Particulier (kasticket)'}</td>
                <td style={{ padding: 4, textAlign: 'right' }}>{euro(v.totaal)}</td>
                <td style={{ padding: 4 }}>{v.scradaStatus === 'FOUT' ? <span style={{ color: 'crimson' }}>fout</span> : 'open'}</td>
                <td style={{ padding: 4, whiteSpace: 'nowrap' }}>
                  <button onClick={() => toon(v.id)} style={btn}>Bekijk</button>{' '}
                  <button onClick={() => verstuurEen(v.id)} disabled={bezig} style={btn}>Verstuur</button>
                </td>
              </tr>
            ))}
            {open.length === 0 && <tr><td colSpan={5} style={{ padding: 16, color: '#999' }}>Niets openstaand — alles is verstuurd.</td></tr>}
          </tbody>
        </table>
      </div>

      {preview && (
        <div style={{ flex: '1 1 320px' }}>
          <div style={{ border: '1px solid #ddd', borderRadius: 10, padding: 16 }}>
            <h3 style={{ marginTop: 0 }}>Scrada-payload</h3>
            <div style={{ fontSize: 13, color: '#555', marginBottom: 8 }}>
              Type: <strong>{preview.type === 'peppol_factuur' ? 'Peppol-factuur (B2B)' : 'Kasticket (kasboek)'}</strong><br />
              Onderneming: {preview.onderneming.naam}<br />
              Klant: {preview.klant?.naam ?? 'particulier'}<br />
              Betaalwijze: {preview.betaalwijze} · Kanaal: {preview.kanaal}
            </div>
            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
              <tbody>
                {preview.lijnen.map((l, i) => (
                  <tr key={i}><td>{l.aantal}× {l.omschrijving}</td><td style={{ textAlign: 'right' }}>{euro(l.totaalInclBtw)}</td></tr>
                ))}
              </tbody>
            </table>
            <hr />
            {preview.btwPerTarief.map((b) => (
              <div key={b.percentage} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#555' }}>
                <span>BTW {b.percentage}% (maatstaf {euro(b.maatstaf)})</span><span>{euro(b.btw)}</span>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, marginTop: 6 }}>
              <span>Totaal incl. BTW</span><span>{euro(preview.totaalInclBtw)}</span>
            </div>
            <details style={{ marginTop: 10 }}>
              <summary style={{ cursor: 'pointer', fontSize: 12, color: '#6b7280' }}>Ruwe JSON</summary>
              <pre style={{ fontSize: 11, overflow: 'auto', maxHeight: 200 }}>{JSON.stringify(preview, null, 2)}</pre>
            </details>
          </div>
        </div>
      )}
    </div>
  );
}

const btn: CSSProperties = { padding: '5px 10px', border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 13 };
