import { useEffect, useState, type CSSProperties } from 'react';
import {
  getKortingsregelingen, nieuweKortingsregeling, verwijderKortingsregeling,
  getBegunstigden, nieuweBegunstigde, verwijderBegunstigde,
  type Kortingsregeling, type Begunstigde,
} from '../api/client';
import { getVerkoper } from '../auth';
import { isAdminRol } from '../rechten';

// Beheer van kortingsregelingen (personeel / friends & family) en het
// e-mailregister van begunstigden. Dat register bereidt ook de webshop voor:
// een ingelogd e-mailadres krijgt daar later automatisch zijn korting.
export function Kortingen() {
  const [regelingen, setRegelingen] = useState<Kortingsregeling[]>([]);
  const [begunstigden, setBegunstigden] = useState<Begunstigde[]>([]);
  const [zoek, setZoek] = useState('');
  const [fout, setFout] = useState('');
  const [melding, setMelding] = useState('');
  // Kortingsgroep verwijderen: enkel een beheerder, na een bevestiging op het scherm.
  const isAdmin = isAdminRol(getVerkoper()?.rol ?? '');
  const [teVerwijderen, setTeVerwijderen] = useState<Kortingsregeling | null>(null);
  const [bezig, setBezig] = useState(false);

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
    setFout('');
    try { await verwijderBegunstigde(id); }
    catch (e) { setFout(e instanceof Error ? e.message : 'Verwijderen mislukt'); }
    await laadBegunstigden();
  }

  async function verwijderGroep(r: Kortingsregeling) {
    setFout(''); setMelding(''); setBezig(true);
    try {
      const x = await verwijderKortingsregeling(r.id);
      setMelding(`Kortingsgroep "${x.naam}" verwijderd${x.begunstigden ? ` (met ${x.begunstigden} e-mailadres${x.begunstigden === 1 ? '' : 'sen'} uit het register)` : ''}.`);
      if (bRegeling === r.id) setBRegeling('');
    } catch (e) { setFout(e instanceof Error ? e.message : 'Verwijderen mislukt'); }
    finally { setTeVerwijderen(null); setBezig(false); }
    await Promise.all([laadRegelingen(), laadBegunstigden()]);
  }

  return (
    <div style={{ maxWidth: 860 }}>
      <h2>Kortingen</h2>
      {fout && <p style={{ color: 'crimson' }}>{fout}</p>}
      {melding && <p style={{ color: '#166534' }}>{melding}</p>}

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
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: teVerwijderen ? 10 : 24 }}>
        {regelingen.map((r) => (
          <span key={r.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 20, background: '#eff6ff', border: '1px solid #c7d2fe', fontSize: 14 }}>
            {r.naam} — <strong>{Number(r.pct)}%</strong>
            {isAdmin && (
              <button onClick={() => { setTeVerwijderen(r); setMelding(''); setFout(''); }} title={`Kortingsgroep ${r.naam} verwijderen`} aria-label={`Kortingsgroep ${r.naam} verwijderen`}
                style={{ border: 'none', background: 'none', color: '#b91c1c', cursor: 'pointer', fontSize: 16, lineHeight: 1, padding: '0 2px' }}>×</button>
            )}
          </span>
        ))}
        {regelingen.length === 0 && <span style={{ color: '#999' }}>Nog geen regelingen.</span>}
      </div>
      {teVerwijderen && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '8px 12px', marginBottom: 24, fontSize: 14 }}>
          <span style={{ flex: '1 1 260px' }}>
            Kortingsgroep <strong>{teVerwijderen.naam}</strong> ({Number(teVerwijderen.pct)}%) verwijderen?{' '}
            {teVerwijderen._count?.begunstigden
              ? `${teVerwijderen._count.begunstigden} e-mailadres${teVerwijderen._count.begunstigden === 1 ? '' : 'sen'} in het register ${teVerwijderen._count.begunstigden === 1 ? 'gaat' : 'gaan'} mee weg. `
              : ''}
            Verkopen die deze korting al kregen, blijven ongewijzigd.
          </span>
          <button onClick={() => verwijderGroep(teVerwijderen)} disabled={bezig} style={{ ...btnMini, color: '#b91c1c', borderColor: '#fca5a5' }}>{bezig ? 'Bezig…' : 'Ja, verwijderen'}</button>
          <button onClick={() => setTeVerwijderen(null)} style={btnMini}>Nee</button>
        </div>
      )}

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
