import { useEffect, useState, type CSSProperties } from 'react';
import {
  getPersoneel, nieuwPersoneelslid, updatePersoneelslid,
  type Personeelslid,
} from '../api/client';

const ROLLEN = ['KASSA', 'BEHEER', 'BEHEERDER'];

// Personeelsbeheer: een account per medewerker/gérante. Elke verkoop kan zo op
// naam van de juiste persoon geboekt worden (zie verkoper-keuze aan de kassa).
export function Personeel() {
  const [lijst, setLijst] = useState<Personeelslid[]>([]);
  const [naam, setNaam] = useState('');
  const [email, setEmail] = useState('');
  const [wachtwoord, setWachtwoord] = useState('');
  const [rol, setRol] = useState('KASSA');
  const [fout, setFout] = useState('');
  const [bezig, setBezig] = useState(false);

  async function laad() { setLijst(await getPersoneel()); }
  useEffect(() => { laad(); }, []);

  async function voegToe() {
    setFout('');
    if (!naam.trim() || !email.trim()) { setFout('Naam en e-mail zijn vereist.'); return; }
    if (wachtwoord.length < 4) { setFout('Kies een wachtwoord van minstens 4 tekens.'); return; }
    setBezig(true);
    try {
      await nieuwPersoneelslid({ naam: naam.trim(), email: email.trim(), wachtwoord, rol });
      setNaam(''); setEmail(''); setWachtwoord(''); setRol('KASSA');
      await laad();
    } catch (e) {
      setFout(e instanceof Error ? e.message : 'Aanmaken mislukt');
    } finally { setBezig(false); }
  }

  async function wijzigRol(p: Personeelslid, nieuweRol: string) {
    await updatePersoneelslid(p.id, { rol: nieuweRol });
    await laad();
  }
  async function zetActief(p: Personeelslid, actief: boolean) {
    await updatePersoneelslid(p.id, { actief });
    await laad();
  }
  async function resetWachtwoord(p: Personeelslid) {
    const nw = window.prompt(`Nieuw wachtwoord voor ${p.naam}?`);
    if (!nw) return;
    if (nw.length < 4) { setFout('Wachtwoord van minstens 4 tekens vereist.'); return; }
    await updatePersoneelslid(p.id, { wachtwoord: nw });
    setFout('');
    window.alert('Wachtwoord aangepast.');
  }

  return (
    <div style={{ maxWidth: 800 }}>
      <h2>Personeel</h2>
      <p style={{ color: '#6b7280', marginTop: 4 }}>
        Maak een account per medewerker. Aan de kassa kies je per ticket wie bedient, zodat elke verkoop op de juiste naam staat.
      </p>

      <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 14, margin: '12px 0 20px', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div><div style={muted}>Naam</div><input value={naam} onChange={(e) => setNaam(e.target.value)} style={{ ...inp, width: 160 }} /></div>
        <div><div style={muted}>E-mail (login)</div><input value={email} onChange={(e) => setEmail(e.target.value)} style={{ ...inp, width: 200 }} /></div>
        <div><div style={muted}>Wachtwoord</div><input value={wachtwoord} onChange={(e) => setWachtwoord(e.target.value)} type="text" placeholder="min. 4 tekens" style={{ ...inp, width: 130 }} /></div>
        <div><div style={muted}>Rol</div>
          <select value={rol} onChange={(e) => setRol(e.target.value)} style={inp}>
            {ROLLEN.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <button onClick={voegToe} disabled={bezig} style={btnBlauw}>{bezig ? 'Bezig…' : 'Account aanmaken'}</button>
        {fout && <span style={{ color: 'crimson' }}>{fout}</span>}
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd', fontSize: 12, color: '#666' }}>
            <th style={{ padding: 6 }}>Naam</th>
            <th style={{ padding: 6 }}>E-mail</th>
            <th style={{ padding: 6 }}>Rol</th>
            <th style={{ padding: 6 }}>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {lijst.map((p) => (
            <tr key={p.id} style={{ borderBottom: '1px solid #f0f0f0', opacity: p.actief ? 1 : 0.5 }}>
              <td style={{ padding: 6 }}>{p.naam}</td>
              <td style={{ padding: 6, fontFamily: 'monospace' }}>{p.email}</td>
              <td style={{ padding: 6 }}>
                <select value={p.rol} onChange={(e) => wijzigRol(p, e.target.value)} style={{ ...inp, marginBottom: 0, padding: 4 }}>
                  {ROLLEN.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </td>
              <td style={{ padding: 6 }}>{p.actief ? <span style={{ color: '#166534' }}>actief</span> : <span style={{ color: '#6b7280' }}>uit dienst</span>}</td>
              <td style={{ padding: 6, textAlign: 'right', whiteSpace: 'nowrap' }}>
                <button onClick={() => resetWachtwoord(p)} style={btnMini}>Wachtwoord…</button>{' '}
                {p.actief
                  ? <button onClick={() => zetActief(p, false)} style={{ ...btnMini, color: 'crimson' }}>Deactiveren</button>
                  : <button onClick={() => zetActief(p, true)} style={{ ...btnMini, color: '#166534' }}>Heractiveren</button>}
              </td>
            </tr>
          ))}
          {lijst.length === 0 && <tr><td colSpan={5} style={{ padding: 16, color: '#999' }}>Nog geen accounts.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

const inp: CSSProperties = { padding: 8, fontSize: 14, boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 6, marginBottom: 8 };
const muted: CSSProperties = { fontSize: 12, color: '#6b7280', marginBottom: 2 };
const btnBlauw: CSSProperties = { padding: '9px 16px', border: 'none', borderRadius: 6, background: '#0d4589', color: '#fff', cursor: 'pointer', fontWeight: 600 };
const btnMini: CSSProperties = { padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 5, background: '#fff', cursor: 'pointer', fontSize: 13 };
