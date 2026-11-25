import { useEffect, useState, type CSSProperties } from 'react';
import {
  getPersoneelCategorieen, maakPersoneelCategorie, wijzigPersoneelCategorie, verwijderPersoneelCategorie,
  type Personeelscategorie,
} from '../api/client';

const LOCATIES: [string, string][] = [['WINKEL', 'Winkel'], ['RESTAURANT', 'Restaurant'], ['CATERING', 'Catering']];

// Categorieën (ploegen) van het personeel: Winkel, Keuken restaurant, Zaal restaurant, Flexi
// restaurant... Gebruikt in het personeelsdossier (werkt in, verantwoordelijke van) en als filter in
// de planning. Enkel voor beheerders (op de pagina Personeel).
export function PersoneelCategorieen() {
  const [lijst, setLijst] = useState<Personeelscategorie[] | null>(null);
  const [naam, setNaam] = useState('');
  const [locatie, setLocatie] = useState('RESTAURANT');
  const [fout, setFout] = useState('');
  const [melding, setMelding] = useState('');
  const [bezig, setBezig] = useState(false);
  const [teVerwijderen, setTeVerwijderen] = useState<string | null>(null);

  useEffect(() => { getPersoneelCategorieen().then(setLijst).catch((e) => setFout(e instanceof Error ? e.message : 'Laden mislukt')); }, []);

  async function doe(actie: () => Promise<Personeelscategorie[]>, tekst: string) {
    setFout(''); setMelding(''); setBezig(true);
    try { setLijst(await actie()); setMelding(tekst); }
    catch (e) { setFout(e instanceof Error ? e.message : 'Bewaren mislukt'); }
    finally { setBezig(false); }
  }

  async function voegToe() {
    if (!naam.trim()) { setFout('Geef een naam (bv. Keuken restaurant).'); return; }
    await doe(() => maakPersoneelCategorie({ naam: naam.trim(), locatie }), `"${naam.trim()}" toegevoegd.`);
    setNaam('');
  }

  // Een plaats omhoog of omlaag: de volgorde van de twee buren omwisselen.
  async function verschuif(i: number, richting: -1 | 1) {
    if (!lijst) return;
    const a = lijst[i], b = lijst[i + richting];
    if (!a || !b) return;
    const va = a.volgorde === b.volgorde ? b.volgorde + richting : b.volgorde;
    await doe(async () => { await wijzigPersoneelCategorie(a.id, { volgorde: Math.max(0, va) }); return wijzigPersoneelCategorie(b.id, { volgorde: Math.max(0, a.volgorde) }); }, 'Volgorde aangepast.');
  }

  if (!lijst) return <div style={{ color: fout ? 'crimson' : '#6b7280', marginTop: 24 }}>{fout || 'Categorieën laden…'}</div>;

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 14, marginTop: 24 }}>
      <h3 style={{ margin: '0 0 4px' }}>Categorieën van het personeel</h3>
      <p style={{ color: '#6b7280', fontSize: 13, margin: '0 0 10px' }}>
        Ploegen zoals Keuken restaurant of Zaal restaurant. Je duidt ze aan in het personeelsdossier (werkt in, verantwoordelijke van) en filtert er de planning mee.
        Een nieuwe dienst krijgt de locatie van de ploeg. Zet een categorie uit als ze niet meer gebruikt wordt; wie ze nog heeft, houdt ze.
      </p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
        <label style={lab}>Nieuwe categorie
          <input value={naam} onChange={(e) => setNaam(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void voegToe(); }} maxLength={60} placeholder="bv. Afwas restaurant" style={{ ...inp, width: 200 }} />
        </label>
        <label style={lab}>Werkt in
          <select value={locatie} onChange={(e) => setLocatie(e.target.value)} style={inp}>
            {LOCATIES.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
          </select>
        </label>
        <button onClick={() => void voegToe()} disabled={bezig} style={btnBlauw}>Toevoegen</button>
      </div>
      {fout && <p style={{ color: 'crimson', margin: '0 0 8px' }}>{fout}</p>}
      {melding && <p style={{ color: '#166534', margin: '0 0 8px' }}>{melding}</p>}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14, minWidth: 560 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd', fontSize: 12, color: '#666' }}>
              <th style={th}>Naam</th><th style={th}>Werkt in</th><th style={{ ...th, textAlign: 'right' }}>Medewerkers</th><th style={th}>Volgorde</th><th style={th}>Actief</th><th style={th} />
            </tr>
          </thead>
          <tbody>
            {lijst.map((c, i) => {
              const inGebruik = c.medewerkers + c.verantwoordelijken;
              return (
                <tr key={c.id} style={{ borderBottom: '1px solid #f0f0f0', opacity: c.actief ? 1 : 0.55 }}>
                  <td style={td}>
                    <input key={c.naam} defaultValue={c.naam} maxLength={60} aria-label={`Naam van ${c.naam}`}
                      onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== c.naam) void doe(() => wijzigPersoneelCategorie(c.id, { naam: v }), `Hernoemd naar "${v}".`); else e.target.value = c.naam; }}
                      style={{ ...inp, width: 190, padding: 5 }} />
                  </td>
                  <td style={td}>
                    <select value={c.locatie} onChange={(e) => void doe(() => wijzigPersoneelCategorie(c.id, { locatie: e.target.value }), 'Locatie aangepast.')} style={{ ...inp, padding: 5 }} aria-label={`Locatie van ${c.naam}`}>
                      {LOCATIES.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
                    </select>
                  </td>
                  <td style={{ ...td, textAlign: 'right' }} title={c.verantwoordelijken ? `${c.verantwoordelijken} verantwoordelijke(n)` : undefined}>
                    {c.medewerkers}{c.verantwoordelijken ? <span style={{ color: '#6b7280' }}> (+{c.verantwoordelijken} verantw.)</span> : null}
                  </td>
                  <td style={{ ...td, whiteSpace: 'nowrap' }}>
                    <button onClick={() => void verschuif(i, -1)} disabled={bezig || i === 0} aria-label={`${c.naam} hoger`} style={btnMini}>↑</button>{' '}
                    <button onClick={() => void verschuif(i, 1)} disabled={bezig || i === lijst.length - 1} aria-label={`${c.naam} lager`} style={btnMini}>↓</button>
                  </td>
                  <td style={td}>
                    <input type="checkbox" checked={c.actief} aria-label={`${c.naam} actief`}
                      onChange={(e) => void doe(() => wijzigPersoneelCategorie(c.id, { actief: e.target.checked }), e.target.checked ? `"${c.naam}" staat weer aan.` : `"${c.naam}" staat uit.`)} />
                  </td>
                  <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {teVerwijderen === c.id ? (
                      <>
                        <span style={{ fontSize: 13 }}>Verwijderen? </span>
                        <button onClick={() => { setTeVerwijderen(null); void doe(() => verwijderPersoneelCategorie(c.id), `"${c.naam}" verwijderd.`); }} style={{ ...btnMini, color: '#b91c1c' }}>Ja</button>{' '}
                        <button onClick={() => setTeVerwijderen(null)} style={btnMini}>Nee</button>
                      </>
                    ) : (
                      <button onClick={() => setTeVerwijderen(c.id)} disabled={inGebruik > 0}
                        title={inGebruik > 0 ? 'Nog in gebruik: haal ze eerst uit de dossiers, of zet ze uit' : 'Verwijderen'}
                        style={{ ...btnMini, color: inGebruik > 0 ? '#9ca3af' : '#b91c1c' }}>Verwijderen</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const lab: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2, fontSize: 12, color: '#6b7280' };
const inp: CSSProperties = { padding: 7, fontSize: 14, border: '1px solid #cbd5e1', borderRadius: 6, boxSizing: 'border-box' };
const btnBlauw: CSSProperties = { padding: '8px 14px', border: 'none', borderRadius: 6, background: '#2563eb', color: '#fff', cursor: 'pointer', fontWeight: 600 };
const btnMini: CSSProperties = { padding: '3px 9px', border: '1px solid #cbd5e1', borderRadius: 5, background: '#fff', cursor: 'pointer', fontSize: 13 };
const th: CSSProperties = { padding: 6 };
const td: CSSProperties = { padding: 6, verticalAlign: 'middle' };
