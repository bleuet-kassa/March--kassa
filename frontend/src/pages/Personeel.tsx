import { useEffect, useState, type CSSProperties } from 'react';
import {
  getPersoneel, nieuwPersoneelslid, updatePersoneelslid,
  type Personeelslid,
} from '../api/client';
import { getVerkoper } from '../auth';
import { RECHTEN, STANDAARD_RECHTEN, isAdminRol } from '../rechten';

const ROLLEN = ['KASSA', 'BEHEER', 'BEHEERDER'];
const GROEPEN = ['Dagelijks', 'Beheer', 'Cijfers'];

// Personeelsbeheer: een account per medewerker, met per persoon de toegangen
// tot de verschillende functionaliteiten. Rol en toegangen wijzigen kan enkel
// een beheerder (de server dwingt dat ook af).
export function Personeel() {
  const [lijst, setLijst] = useState<Personeelslid[]>([]);
  const [naam, setNaam] = useState('');
  const [email, setEmail] = useState('');
  const [wachtwoord, setWachtwoord] = useState('');
  const [rol, setRol] = useState('KASSA');
  const [nieuweRechten, setNieuweRechten] = useState<string[]>(STANDAARD_RECHTEN);
  const [fout, setFout] = useState('');
  const [melding, setMelding] = useState('');
  const [bezig, setBezig] = useState(false);
  const [open, setOpen] = useState<string | null>(null); // account waarvan de toegangen open staan
  const ik = getVerkoper();
  const magToekennen = isAdminRol(ik?.rol);

  async function laad() { setLijst(await getPersoneel()); }
  useEffect(() => { laad(); }, []);

  async function voegToe() {
    setFout(''); setMelding('');
    if (!naam.trim() || !email.trim()) { setFout('Naam en e-mail zijn vereist.'); return; }
    if (wachtwoord.length < 4) { setFout('Kies een wachtwoord van minstens 4 tekens.'); return; }
    setBezig(true);
    try {
      await nieuwPersoneelslid({ naam: naam.trim(), email: email.trim(), wachtwoord, ...(magToekennen ? { rol, rechten: isAdminRol(rol) ? undefined : nieuweRechten } : {}) });
      setNaam(''); setEmail(''); setWachtwoord(''); setRol('KASSA'); setNieuweRechten(STANDAARD_RECHTEN);
      await laad();
    } catch (e) {
      setFout(e instanceof Error ? e.message : 'Aanmaken mislukt');
    } finally { setBezig(false); }
  }

  async function wijzig(p: Personeelslid, input: Parameters<typeof updatePersoneelslid>[1], tekst?: string) {
    setFout(''); setMelding('');
    try { await updatePersoneelslid(p.id, input); await laad(); if (tekst) setMelding(tekst); }
    catch (e) { setFout(e instanceof Error ? e.message : 'Aanpassen mislukt'); }
  }
  async function wijzigRol(p: Personeelslid, nieuweRol: string) {
    if (isAdminRol(nieuweRol) && !isAdminRol(p.rol) && !window.confirm(`${p.naam} beheerder maken? Een beheerder heeft toegang tot ALLES, ook omzet, boekhouding en het toekennen van toegangen.`)) return;
    await wijzig(p, { rol: nieuweRol }, `Rol van ${p.naam} gewijzigd naar ${nieuweRol}.`);
  }
  async function zetActief(p: Personeelslid, actief: boolean) { await wijzig(p, { actief }); }
  async function resetWachtwoord(p: Personeelslid) {
    const nw = window.prompt(`Nieuw wachtwoord voor ${p.naam}?`);
    if (!nw) return;
    if (nw.length < 4) { setFout('Wachtwoord van minstens 4 tekens vereist.'); return; }
    await wijzig(p, { wachtwoord: nw }, `Wachtwoord van ${p.naam} aangepast.`);
  }
  // Eén toegang aan- of uitzetten; wordt meteen bewaard en geldt direct (ook zonder herlogin).
  async function toggleRecht(p: Personeelslid, key: string, aan: boolean) {
    const rechten = aan ? [...new Set([...p.rechten, key])] : p.rechten.filter((r) => r !== key);
    await wijzig(p, { rechten }, `Toegangen van ${p.naam} bewaard.`);
  }
  async function zetAlles(p: Personeelslid, alles: boolean) {
    await wijzig(p, { rechten: alles ? RECHTEN.map((r) => r.key) : [] }, `Toegangen van ${p.naam} bewaard.`);
  }
  async function terugNaarStandaard(p: Personeelslid) {
    await wijzig(p, { rechten: null }, `${p.naam} heeft terug de standaardtoegangen van de kassa.`);
  }

  const vinkjes = (rechten: string[], onChange: (key: string, aan: boolean) => void, uit: boolean) => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 10 }}>
      {GROEPEN.map((groep) => (
        <div key={groep}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', marginBottom: 4 }}>{groep}</div>
          {RECHTEN.filter((r) => r.groep === groep).map((r) => (
            <label key={r.key} title={r.uitleg} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '4px 0', cursor: uit ? 'default' : 'pointer', opacity: uit ? 0.6 : 1 }}>
              <input type="checkbox" checked={rechten.includes(r.key)} disabled={uit} onChange={(e) => onChange(r.key, e.target.checked)} style={{ marginTop: 3 }} />
              <span><span style={{ fontWeight: 600 }}>{r.naam}</span><br /><span style={{ fontSize: 12, color: '#6b7280' }}>{r.uitleg}</span></span>
            </label>
          ))}
        </div>
      ))}
    </div>
  );

  return (
    <div style={{ maxWidth: 960 }}>
      <h2>Personeel</h2>
      <p style={{ color: '#6b7280', marginTop: 4 }}>
        Een account per medewerker, met per persoon de toegangen tot de verschillende onderdelen. Een <strong>beheerder</strong> heeft altijd alles en is de enige die rollen en toegangen kan toekennen.
        {!magToekennen && <span style={{ color: '#b45309' }}> Jij kan accounts bekijken en wachtwoorden resetten; toegangen wijzigen is voorbehouden aan de beheerder.</span>}
      </p>

      <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 14, margin: '12px 0 20px' }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div><div style={muted}>Naam</div><input value={naam} onChange={(e) => setNaam(e.target.value)} style={{ ...inp, width: 160 }} /></div>
          <div><div style={muted}>E-mail (login)</div><input value={email} onChange={(e) => setEmail(e.target.value)} style={{ ...inp, width: 200 }} /></div>
          <div><div style={muted}>Wachtwoord</div><input value={wachtwoord} onChange={(e) => setWachtwoord(e.target.value)} type="text" placeholder="min. 4 tekens" style={{ ...inp, width: 130 }} /></div>
          {magToekennen && (
            <div><div style={muted}>Rol</div>
              <select value={rol} onChange={(e) => setRol(e.target.value)} style={inp}>
                {ROLLEN.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          )}
          <button onClick={voegToe} disabled={bezig} style={btnBlauw}>{bezig ? 'Bezig…' : 'Account aanmaken'}</button>
        </div>
        {magToekennen && !isAdminRol(rol) && (
          <details style={{ marginTop: 10 }}>
            <summary style={{ cursor: 'pointer', fontSize: 14, color: '#0d4589' }}>Toegangen voor dit nieuwe account ({nieuweRechten.length} van {RECHTEN.length})</summary>
            <div style={{ marginTop: 8 }}>{vinkjes(nieuweRechten, (key, aan) => setNieuweRechten(aan ? [...new Set([...nieuweRechten, key])] : nieuweRechten.filter((r) => r !== key)), false)}</div>
          </details>
        )}
        {fout && <p style={{ color: 'crimson', margin: '8px 0 0' }}>{fout}</p>}
        {melding && <p style={{ color: '#166534', margin: '8px 0 0' }}>{melding}</p>}
      </div>

      <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, minWidth: 640 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd', fontSize: 12, color: '#666' }}>
            <th style={{ padding: 6 }}>Naam</th>
            <th style={{ padding: 6 }}>E-mail</th>
            <th style={{ padding: 6 }}>Rol</th>
            <th style={{ padding: 6 }}>Toegangen</th>
            <th style={{ padding: 6 }}>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {lijst.map((p) => {
            const admin = isAdminRol(p.rol);
            const isOpen = open === p.id;
            return (
              <FragmentRij key={p.id}>
                <tr style={{ borderBottom: isOpen ? 'none' : '1px solid #f0f0f0', opacity: p.actief ? 1 : 0.5 }}>
                  <td style={{ padding: 6, fontWeight: 600 }}>{p.naam}{p.id === ik?.id && <span style={{ fontWeight: 400, color: '#6b7280' }}> (jij)</span>}</td>
                  <td style={{ padding: 6, fontFamily: 'monospace' }}>{p.email}</td>
                  <td style={{ padding: 6 }}>
                    {magToekennen
                      ? <select value={p.rol} onChange={(e) => wijzigRol(p, e.target.value)} style={{ ...inp, marginBottom: 0, padding: 4 }}>{ROLLEN.map((r) => <option key={r} value={r}>{r}</option>)}</select>
                      : p.rol}
                  </td>
                  <td style={{ padding: 6 }}>
                    {admin
                      ? <span style={{ color: '#166534', fontWeight: 600 }}>alles (beheerder)</span>
                      : (
                        <button onClick={() => setOpen(isOpen ? null : p.id)} style={{ ...btnMini, color: '#0d4589' }}>
                          {p.rechten.length} van {RECHTEN.length}{p.rechtenIngesteld ? '' : ' (standaard)'} {isOpen ? '▴' : '▾'}
                        </button>
                      )}
                  </td>
                  <td style={{ padding: 6 }}>{p.actief ? <span style={{ color: '#166534' }}>actief</span> : <span style={{ color: '#6b7280' }}>uit dienst</span>}</td>
                  <td style={{ padding: 6, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button onClick={() => resetWachtwoord(p)} style={btnMini}>Wachtwoord…</button>{' '}
                    {p.actief
                      ? <button onClick={() => zetActief(p, false)} disabled={p.id === ik?.id} style={{ ...btnMini, color: 'crimson' }}>Deactiveren</button>
                      : <button onClick={() => zetActief(p, true)} style={{ ...btnMini, color: '#166534' }}>Heractiveren</button>}
                  </td>
                </tr>
                {isOpen && !admin && (
                  <tr style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td colSpan={6} style={{ padding: '4px 6px 14px' }}>
                      <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, background: '#fafafa' }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
                          <strong>Toegangen van {p.naam}</strong>
                          <span style={{ fontSize: 12, color: '#6b7280' }}>{magToekennen ? 'Een vinkje wordt meteen bewaard en geldt direct.' : 'Enkel een beheerder kan dit wijzigen.'}</span>
                          {magToekennen && (
                            <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                              <button onClick={() => zetAlles(p, true)} style={btnMini}>Alles aan</button>
                              <button onClick={() => zetAlles(p, false)} style={btnMini}>Alles uit</button>
                              <button onClick={() => terugNaarStandaard(p)} style={btnMini} title={`Standaard: ${STANDAARD_RECHTEN.join(', ')}`}>Standaard kassa</button>
                            </span>
                          )}
                        </div>
                        {vinkjes(p.rechten, (key, aan) => toggleRecht(p, key, aan), !magToekennen)}
                      </div>
                    </td>
                  </tr>
                )}
              </FragmentRij>
            );
          })}
          {lijst.length === 0 && <tr><td colSpan={6} style={{ padding: 16, color: '#999' }}>Nog geen accounts.</td></tr>}
        </tbody>
      </table>
      </div>
    </div>
  );
}

// Twee rijen per account (gegevens + uitklapbare toegangen) zonder extra DOM-element.
function FragmentRij({ children }: { children: React.ReactNode }) { return <>{children}</>; }

const inp: CSSProperties = { padding: 8, fontSize: 14, boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 6, marginBottom: 8 };
const muted: CSSProperties = { fontSize: 12, color: '#6b7280', marginBottom: 2 };
const btnBlauw: CSSProperties = { padding: '9px 16px', border: 'none', borderRadius: 6, background: '#0d4589', color: '#fff', cursor: 'pointer', fontWeight: 600 };
const btnMini: CSSProperties = { padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 5, background: '#fff', cursor: 'pointer', fontSize: 13 };
