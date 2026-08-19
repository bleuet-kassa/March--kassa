import { useEffect, useState, type CSSProperties } from 'react';
import {
  getKortingsregelingen, nieuweKortingsregeling,
  getBegunstigden, nieuweBegunstigde, verwijderBegunstigde,
  type Kortingsregeling, type Begunstigde,
} from '../api/client';

// Beheer van kortingsregelingen (personeel / friends & family) en het
// e-mailregister van begunstigden. Dat register bereidt ook de webshop voor:
// een ingelogd e-mailadres krijgt daar later automatisch zijn korting.
export function Kortingen() {
  const [regelingen, setRegelingen] = useState<Kortingsregeling[]>([]);
  const [begunstigden, setBegunstigden] = useState<Begunstigde[]>([]);
  const [zoek, setZoek] = useState('');
  const [fout, setFout] = useState('');

  // Nieuwe regeling
  const [rNaam, setRNaam] = useState('');
  const [rPct, setRPct] = useState('');
  // Nieuwe begunstigde
  const [bEmail, setBEmail] = useState('');
  const [bNaam, setBNaam] = useState('');
  const [bRegeling, setBRegeling] = useState('');

  async function laadRegelingen() { setRegelingen(await getKortingsregelingen()); }
  async function laadBegunstigden() { setBegunstigden(await getBegunstigden(zoek)); }

  useEffect(() => { laadRegelingen(); }, []);
  useEffect(() => { const t = setTimeout(laadBegunstigden, 150); return () => clearTimeout(t); }, [zoek]);

  async function voegRegelingToe() {
    setFout('');
    const pct = Number(rPct.replace(',', '.'));
    if (!rNaam.trim() || !(pct > 0 && pct <= 100)) { setFout('Geef een naam en een percentage (1-100).'); return; }
    try {
      await nieuweKortingsregeling({ naam: rNaam.trim(), pct });
      setRNaam(''); setRPct('');
      await laadRegelingen();
    } catch (e) { setFout(e instanceof Error ? e.message : 'Mislukt'); }
  }

  async function voegBegunstigdeToe() {
    setFout('');
    if (!bEmail.trim() || !bRegeling) { setFout('Geef een e-mailadres en kies een regeling.'); return; }
    try {
      await nieuweBegunstigde({ email: bEmail.trim(), naam: bNaam.trim() || undefined, regelingId: bRegeling });
      setBEmail(''); setBNaam('');
      await laadBegunstigden();
    } catch (e) { setFout(e instanceof Error ? e.message : 'Mislukt'); }
  }

  async function schrap(id: string) {
    await verwijderBegunstigde(id);
    await laadBegunstigden();
  }

  return (
    <div style={{ maxWidth: 860 }}>
      <h2>Kortingen</h2>
      {fout && <p style={{ color: 'crimson' }}>{fout}</p>}

      <h3 style={{ marginBottom: 8 }}>Regelingen</h3>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
        <div>
          <div style={muted}>Naam</div>
          <input value={rNaam} onChange={(e) => setRNaam(e.target.value)} placeholder="bv. Personeel" style={{ ...inp, width: 180 }} />
        </div>
        <div>
          <div style={muted}>Percentage</div>
          <input value={rPct} onChange={(e) => setRPct(e.target.value)} inputMode="decimal" placeholder="20" style={{ ...inp, width: 80 }} />
        </div>
        <button onClick={voegRegelingToe} style={btnBlauw}>Toevoegen</button>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 24 }}>
        {regelingen.map((r) => (
          <span key={r.id} style={{ padding: '6px 12px', borderRadius: 20, background: '#eff6ff', border: '1px solid #c7d2fe', fontSize: 14 }}>
            {r.naam} — <strong>{Number(r.pct)}%</strong>
          </span>
        ))}
        {regelingen.length === 0 && <span style={{ color: '#999' }}>Nog geen regelingen.</span>}
      </div>

      <h3 style={{ marginBottom: 8 }}>E-mailregister (begunstigden)</h3>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
        <div>
          <div style={muted}>E-mailadres</div>
          <input value={bEmail} onChange={(e) => setBEmail(e.target.value)} placeholder="naam@voorbeeld.be" style={{ ...inp, width: 220 }} />
        </div>
        <div>
          <div style={muted}>Naam (optioneel)</div>
          <input value={bNaam} onChange={(e) => setBNaam(e.target.value)} style={{ ...inp, width: 160 }} />
        </div>
        <div>
          <div style={muted}>Regeling</div>
          <select value={bRegeling} onChange={(e) => setBRegeling(e.target.value)} style={{ ...inp, width: 180 }}>
            <option value="">Kies…</option>
            {regelingen.map((r) => <option key={r.id} value={r.id}>{r.naam} ({Number(r.pct)}%)</option>)}
          </select>
        </div>
        <button onClick={voegBegunstigdeToe} style={btnBlauw}>Toevoegen</button>
      </div>

      <input value={zoek} onChange={(e) => setZoek(e.target.value)} placeholder="Zoek op e-mail of naam…" style={{ ...inp, maxWidth: 260 }} />
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd', fontSize: 12, color: '#666' }}>
            <th style={{ padding: 6 }}>E-mail</th>
            <th style={{ padding: 6 }}>Naam</th>
            <th style={{ padding: 6 }}>Regeling</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {begunstigden.map((b) => (
            <tr key={b.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
              <td style={{ padding: 6, fontFamily: 'monospace' }}>{b.email}</td>
              <td style={{ padding: 6 }}>{b.naam ?? ''}</td>
              <td style={{ padding: 6 }}>{b.regeling ? `${b.regeling.naam} (${Number(b.regeling.pct)}%)` : ''}</td>
              <td style={{ padding: 6, textAlign: 'right' }}>
                <button onClick={() => schrap(b.id)} style={{ ...btnMini, color: 'crimson' }}>Verwijderen</button>
              </td>
            </tr>
          ))}
          {begunstigden.length === 0 && <tr><td colSpan={4} style={{ padding: 16, color: '#999' }}>Nog geen begunstigden.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

const inp: CSSProperties = { padding: 8, fontSize: 14, boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 6, marginBottom: 8 };
const muted: CSSProperties = { fontSize: 12, color: '#6b7280', marginBottom: 2 };
const btnBlauw: CSSProperties = { padding: '9px 16px', border: 'none', borderRadius: 6, background: '#2563eb', color: '#fff', cursor: 'pointer', fontWeight: 600 };
const btnMini: CSSProperties = { padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 5, background: '#fff', cursor: 'pointer', fontSize: 13 };
