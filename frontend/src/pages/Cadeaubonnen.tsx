import { useEffect, useState, type CSSProperties } from 'react';
import {
  getCadeaubonnen, getNieuwBonNummer, createCadeaubon, bonInwisselen,
  type Cadeaubon,
} from '../api/client';
import { getVerkoper } from '../auth';

const euro = (n: number | string) => '€ ' + Number(n).toFixed(2);

// Cadeaubon-register: bonnen registreren (nummer + uitgiftedatum + bedrag) en
// als ingewisseld markeren. Uitgifte is BTW-vrij (0%); BTW volgt bij inwisseling.
export function Cadeaubonnen() {
  const [lijst, setLijst] = useState<Cadeaubon[]>([]);
  const [zoek, setZoek] = useState('');
  const [nummer, setNummer] = useState('');
  const [bedrag, setBedrag] = useState('');
  const [datum, setDatum] = useState(new Date().toISOString().slice(0, 10));
  const [fout, setFout] = useState('');
  const [bezig, setBezig] = useState(false);

  async function laad() { setLijst(await getCadeaubonnen(zoek)); }
  useEffect(() => { const t = setTimeout(laad, 150); return () => clearTimeout(t); }, [zoek]);
  useEffect(() => { getNieuwBonNummer().then(setNummer); }, []);

  async function registreer() {
    setFout('');
    const b = Number(bedrag.replace(',', '.'));
    if (!(b > 0)) { setFout('Geef een geldig bedrag.'); return; }
    setBezig(true);
    try {
      await createCadeaubon({
        nummer: nummer.trim() || undefined,
        bedrag: b,
        datumUitgifte: datum ? new Date(datum).toISOString() : undefined,
        gebruikerId: getVerkoper()?.id,
      });
      setBedrag('');
      setNummer(await getNieuwBonNummer());
      await laad();
    } catch (e) {
      setFout(e instanceof Error ? e.message : 'Registreren mislukt');
    } finally { setBezig(false); }
  }

  async function inwisselen(id: string) {
    await bonInwisselen(id);
    await laad();
  }

  const openBedrag = lijst.filter((b) => !b.ingewisseld).reduce((s, b) => s + Number(b.bedrag), 0);

  return (
    <div style={{ maxWidth: 820 }}>
      <h2>Cadeaubonnen</h2>

      <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 14, marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <div style={muted}>Nummer</div>
          <input value={nummer} onChange={(e) => setNummer(e.target.value)} style={{ ...inp, width: 140 }} />
        </div>
        <div>
          <div style={muted}>Bedrag</div>
          <input value={bedrag} onChange={(e) => setBedrag(e.target.value)} inputMode="decimal" placeholder="0,00" style={{ ...inp, width: 110 }} />
        </div>
        <div>
          <div style={muted}>Uitgiftedatum</div>
          <input type="date" value={datum} onChange={(e) => setDatum(e.target.value)} style={inp} />
        </div>
        <button onClick={registreer} disabled={bezig} style={btnBlauw}>{bezig ? 'Bezig…' : 'Registreren'}</button>
        {fout && <span style={{ color: 'crimson' }}>{fout}</span>}
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <input value={zoek} onChange={(e) => setZoek(e.target.value)} placeholder="Zoek op nummer…" style={{ ...inp, maxWidth: 220, marginBottom: 0 }} />
        <span style={{ fontSize: 13, color: '#6b7280' }}>Openstaand (niet ingewisseld): <strong>{euro(openBedrag)}</strong></span>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd', fontSize: 12, color: '#666' }}>
            <th style={{ padding: 6 }}>Nummer</th>
            <th style={{ padding: 6 }}>Uitgifte</th>
            <th style={{ padding: 6, textAlign: 'right' }}>Bedrag</th>
            <th style={{ padding: 6 }}>Status</th>
            <th style={{ padding: 6 }}>Door</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {lijst.map((b) => (
            <tr key={b.id} style={{ borderBottom: '1px solid #f0f0f0', opacity: b.ingewisseld ? 0.6 : 1 }}>
              <td style={{ padding: 6, fontFamily: 'monospace' }}>{b.nummer}</td>
              <td style={{ padding: 6 }}>{new Date(b.datumUitgifte).toLocaleDateString('nl-BE')}</td>
              <td style={{ padding: 6, textAlign: 'right' }}>{euro(b.bedrag)}</td>
              <td style={{ padding: 6 }}>
                {b.ingewisseld
                  ? <span style={{ color: '#6b7280' }}>ingewisseld {b.ingewisseldOp ? new Date(b.ingewisseldOp).toLocaleDateString('nl-BE') : ''}</span>
                  : <span style={{ color: '#166534' }}>geldig</span>}
              </td>
              <td style={{ padding: 6, color: '#6b7280' }}>{b.gebruiker?.naam ?? ''}</td>
              <td style={{ padding: 6, textAlign: 'right' }}>
                {!b.ingewisseld && <button onClick={() => inwisselen(b.id)} style={btnMini}>Inwisselen</button>}
              </td>
            </tr>
          ))}
          {lijst.length === 0 && <tr><td colSpan={6} style={{ padding: 16, color: '#999' }}>Nog geen cadeaubonnen.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

const inp: CSSProperties = { padding: 8, fontSize: 14, boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 6, marginBottom: 8 };
const muted: CSSProperties = { fontSize: 12, color: '#6b7280', marginBottom: 2 };
const btnBlauw: CSSProperties = { padding: '9px 16px', border: 'none', borderRadius: 6, background: '#2563eb', color: '#fff', cursor: 'pointer', fontWeight: 600 };
const btnMini: CSSProperties = { padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 5, background: '#fff', cursor: 'pointer', fontSize: 13 };
