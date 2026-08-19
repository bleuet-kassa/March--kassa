import { useEffect, useState, type CSSProperties } from 'react';
import { getOndernemingen, updateOndernemingById, type Onderneming } from '../api/client';

// Instellingen: ondernemingsgegevens die op de documenten (dagontvangsten-ticket,
// facturen, Scrada) moeten staan. Per entiteit (winkel + import-onderneming).
export function Instellingen() {
  const [lijst, setLijst] = useState<Onderneming[]>([]);
  const [melding, setMelding] = useState('');

  async function laad() { setLijst(await getOndernemingen()); }
  useEffect(() => { laad(); }, []);

  return (
    <div style={{ maxWidth: 640 }}>
      <h2>Instellingen — ondernemingen</h2>
      <p style={{ color: '#6b7280', fontSize: 14 }}>
        Deze gegevens verschijnen op je documenten (dagontvangsten-ticket, facturen, Scrada).
      </p>
      {melding && <p style={{ color: '#16a34a', fontWeight: 600 }}>{melding}</p>}
      {lijst.map((o) => (
        <OndernemingKaart key={o.id} onderneming={o} onOpgeslagen={() => { setMelding('Opgeslagen.'); setTimeout(() => setMelding(''), 2000); laad(); }} />
      ))}
      {lijst.length === 0 && <p style={{ color: '#999' }}>Laden…</p>}
    </div>
  );
}

function OndernemingKaart({ onderneming, onOpgeslagen }: { onderneming: Onderneming; onOpgeslagen: () => void }) {
  const [naam, setNaam] = useState(onderneming.naam);
  const [nr, setNr] = useState(onderneming.ondernemingsnummer);
  const [btw, setBtw] = useState(onderneming.btwNummer ?? '');
  const [adres, setAdres] = useState(onderneming.adres ?? '');
  const [fout, setFout] = useState('');
  const [bezig, setBezig] = useState(false);

  async function opslaan() {
    setFout(''); setBezig(true);
    try {
      await updateOndernemingById(onderneming.id, { naam, ondernemingsnummer: nr, btwNummer: btw, adres });
      onOpgeslagen();
    } catch (e) {
      setFout(e instanceof Error ? e.message : 'Opslaan mislukt');
    } finally { setBezig(false); }
  }

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 16, marginBottom: 14 }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>
        {onderneming.isImporteur ? 'Import-onderneming' : 'Winkel'}
      </div>
      <label style={muted}>Naam</label>
      <input value={naam} onChange={(e) => setNaam(e.target.value)} style={inp} />
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <label style={muted}>Ondernemingsnummer</label>
          <input value={nr} onChange={(e) => setNr(e.target.value)} placeholder="0801.311.258" style={inp} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={muted}>BTW-nummer</label>
          <input value={btw} onChange={(e) => setBtw(e.target.value)} placeholder="BE0801311258" style={inp} />
        </div>
      </div>
      <label style={muted}>Adres</label>
      <input value={adres} onChange={(e) => setAdres(e.target.value)} placeholder="Straat 1, 9680 Maarkedal" style={inp} />
      {fout && <p style={{ color: 'crimson' }}>{fout}</p>}
      <button onClick={opslaan} disabled={bezig} style={btn}>{bezig ? 'Bezig…' : 'Opslaan'}</button>
    </div>
  );
}

const inp: CSSProperties = { width: '100%', padding: 8, fontSize: 14, boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 6, marginBottom: 8 };
const muted: CSSProperties = { fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 2 };
const btn: CSSProperties = { padding: '9px 16px', border: 'none', borderRadius: 6, background: '#2563eb', color: '#fff', cursor: 'pointer', fontWeight: 600 };
