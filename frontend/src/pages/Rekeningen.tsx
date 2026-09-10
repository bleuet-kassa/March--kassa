import { useEffect, useState, type CSSProperties } from 'react';
import {
  getRekeningOverzicht, nieuwRekeningBedrijf, nieuwRekeningLid,
  updateRekeningBedrijf, updateRekeningLid, verplaatsRekeningVerkoop,
  getBedrijfVerkopen, factureerBedrijf, getTicket,
  type RekeningBedrijf, type RekeningLid, type RekeningVerkoop, type Ticket,
} from '../api/client';
import { TicketWeergave } from './Kassa';

const euro = (n: number | null | undefined) => '€ ' + Number(n ?? 0).toFixed(2);

// Filter op de verkopenlijst van een bedrijf: enkel openstaand (standaard) of
// ook het verleden (gefactureerd), binnen een periode en optioneel per lid.
type Filter = { alle: boolean; van: string; tot: string; lidId: string };
const standaardFilter = (): Filter => {
  const nu = new Date();
  const van = new Date(nu.getFullYear(), nu.getMonth() - 3, 1); // laatste 3 maanden
  const dag = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { alle: false, van: dag(van), tot: dag(nu), lidId: '' };
};

// Lopende rekeningen: bedrijven met personeelsleden die "op rekening" kopen.
// Overzicht van het openstaande bedrag per bedrijf en per lid, met een
// factureer-knop om de openstaande verkopen af te sluiten (maandfactuur).
export function Rekeningen() {
  const [bedrijven, setBedrijven] = useState<RekeningBedrijf[]>([]);
  const [fout, setFout] = useState('');
  const [nieuwNaam, setNieuwNaam] = useState('');
  const [nieuwBtw, setNieuwBtw] = useState('');
  const [nieuwAdres, setNieuwAdres] = useState('');
  const [nieuwEmail, setNieuwEmail] = useState('');
  const [verkopen, setVerkopen] = useState<Record<string, RekeningVerkoop[]>>({});
  const [verplaatsId, setVerplaatsId] = useState<string | null>(null); // verkoop die verschoven wordt
  const [filters, setFilters] = useState<Record<string, Filter>>({}); // filter per bedrijf
  const [detail, setDetail] = useState<Ticket | null>(null); // volledig ticket van één verkoop
  const [laadBezig, setLaadBezig] = useState<string | null>(null); // bedrijf waarvan de lijst laadt

  async function laad() { setBedrijven(await getRekeningOverzicht()); }
  useEffect(() => { laad().catch((e) => setFout(String(e))); }, []);

  async function voegBedrijfToe() {
    if (!nieuwNaam.trim()) return;
    setFout('');
    try {
      await nieuwRekeningBedrijf({ naam: nieuwNaam.trim(), btwNummer: nieuwBtw.trim() || undefined, adres: nieuwAdres.trim() || undefined, email: nieuwEmail.trim() || undefined });
      setNieuwNaam(''); setNieuwBtw(''); setNieuwAdres(''); setNieuwEmail('');
      await laad();
    } catch (e) { setFout(e instanceof Error ? e.message : 'Toevoegen mislukt'); }
  }

  async function voegLidToe(bedrijfId: string) {
    const naam = window.prompt('Naam van het personeelslid?');
    if (!naam?.trim()) return;
    const budgetTxt = window.prompt('Maandbudget (optioneel, bv. 150) — leeg = geen budget:', '');
    const budget = budgetTxt && budgetTxt.trim() ? Number(budgetTxt.replace(',', '.')) : undefined;
    try {
      await nieuwRekeningLid({ bedrijfId, naam: naam.trim(), budget: budget && budget > 0 ? budget : undefined });
      await laad();
    } catch (e) { setFout(e instanceof Error ? e.message : 'Toevoegen mislukt'); }
  }

  // Verkopen van een bedrijf laden volgens het (huidige) filter.
  async function laadVerkopen(bedrijfId: string, f?: Filter) {
    const filter = f ?? filters[bedrijfId] ?? standaardFilter();
    setLaadBezig(bedrijfId); setFout('');
    try {
      const rows = await getBedrijfVerkopen(bedrijfId, filter.alle
        ? { alle: true, van: filter.van || undefined, tot: filter.tot || undefined, lidId: filter.lidId || undefined }
        : { lidId: filter.lidId || undefined });
      setVerkopen((v) => ({ ...v, [bedrijfId]: rows }));
    } catch (e) { setFout(e instanceof Error ? e.message : 'Laden mislukt'); }
    finally { setLaadBezig(null); }
  }
  function zetFilter(bedrijfId: string, wijziging: Partial<Filter>) {
    const nieuw = { ...(filters[bedrijfId] ?? standaardFilter()), ...wijziging };
    setFilters((f) => ({ ...f, [bedrijfId]: nieuw }));
    laadVerkopen(bedrijfId, nieuw);
  }
  async function toonVerkopen(bedrijfId: string) {
    if (verkopen[bedrijfId]) { setVerkopen((v) => { const k = { ...v }; delete k[bedrijfId]; return k; }); return; }
    if (!filters[bedrijfId]) setFilters((f) => ({ ...f, [bedrijfId]: standaardFilter() }));
    await laadVerkopen(bedrijfId);
  }
  // Volledig ticket (alle lijnen, prijzen, BTW) van één verkoop bekijken.
  async function toonDetail(id: string) {
    setFout('');
    try { setDetail(await getTicket(id)); }
    catch (e) { setFout(e instanceof Error ? e.message : 'Ticket ophalen mislukt'); }
  }

  // Bedrijf aanpassen (naam / BTW / adres / e-mail).
  async function bewerkBedrijf(b: RekeningBedrijf) {
    const naam = window.prompt('Naam van het bedrijf:', b.naam);
    if (naam === null || !naam.trim()) return;
    const btw = window.prompt('BTW-nummer (leeg = geen):', b.btwNummer ?? '');
    if (btw === null) return;
    const adres = window.prompt('Adres (leeg = geen):', b.adres ?? '');
    if (adres === null) return;
    const email = window.prompt('E-mail (leeg = geen):', b.email ?? '');
    if (email === null) return;
    try {
      await updateRekeningBedrijf(b.id, { naam: naam.trim(), btwNummer: btw.trim() || null, adres: adres.trim() || null, email: email.trim() || null });
      await laad();
    } catch (e) { setFout(e instanceof Error ? e.message : 'Aanpassen mislukt'); }
  }

  // Personeelslid aanpassen (naam / maandbudget).
  async function bewerkLid(l: RekeningLid) {
    const naam = window.prompt('Naam van het personeelslid:', l.naam);
    if (naam === null || !naam.trim()) return;
    const budgetTxt = window.prompt('Maandbudget (leeg = geen budget):', l.budget != null ? String(l.budget) : '');
    if (budgetTxt === null) return;
    const budget = budgetTxt.trim() ? Number(budgetTxt.replace(',', '.')) : null;
    try {
      await updateRekeningLid(l.id, { naam: naam.trim(), budget: budget && budget > 0 ? budget : null });
      await laad();
    } catch (e) { setFout(e instanceof Error ? e.message : 'Aanpassen mislukt'); }
  }

  // Een verkoop verschuiven naar een ander personeelslid (evt. ander bedrijf).
  async function verplaatsNaar(verkoopId: string, lidId: string) {
    const doelBedrijf = bedrijven.find((bb) => bb.leden.some((ll) => ll.id === lidId));
    if (!doelBedrijf) return;
    try {
      await verplaatsRekeningVerkoop(verkoopId, doelBedrijf.id, lidId);
      setVerplaatsId(null);
      await laad();
      // ververs alle open verkopen-lijsten
      for (const bid of Object.keys(verkopen)) {
        const rows = await getBedrijfVerkopen(bid);
        setVerkopen((v) => ({ ...v, [bid]: rows }));
      }
    } catch (e) { setFout(e instanceof Error ? e.message : 'Verplaatsen mislukt'); }
  }

  async function factureer(b: RekeningBedrijf) {
    if (!window.confirm(`Alle openstaande verkopen van ${b.naam} (${euro(b.openstaand)}) als gefactureerd markeren?`)) return;
    const r = await factureerBedrijf(b.id);
    window.alert(`${r.aantal} verkopen afgesloten voor een totaal van ${euro(r.totaal)}.`);
    await laad();
    setVerkopen((v) => { const k = { ...v }; delete k[b.id]; return k; });
  }

  const totaalOpenstaand = bedrijven.reduce((s, b) => s + (b.openstaand ?? 0), 0);

  // Detail van één verkoop: het volledige ticket (zonder automatisch afdrukken).
  if (detail) {
    return <TicketWeergave ticket={detail} autoPrint={false} onNieuw={() => setDetail(null)} nieuwLabel="← Terug naar de rekeningen" />;
  }

  return (
    <div style={{ maxWidth: 860 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <h2 style={{ margin: 0 }}>Lopende rekeningen</h2>
        <span style={{ color: '#6b7280' }}>Totaal openstaand: <strong>{euro(totaalOpenstaand)}</strong></span>
      </div>
      <p style={{ color: '#6b7280', marginTop: 4 }}>Bedrijven waarvan personeelsleden "op rekening" kopen. Op het einde van de maand factureer je het openstaande bedrag.</p>
      {fout && <p style={{ color: 'crimson' }}>{fout}</p>}

      <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, padding: 14, margin: '12px 0 20px', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div><div style={muted}>Bedrijf</div><input value={nieuwNaam} onChange={(e) => setNieuwNaam(e.target.value)} style={{ ...inp, width: 180 }} /></div>
        <div><div style={muted}>BTW-nummer</div><input value={nieuwBtw} onChange={(e) => setNieuwBtw(e.target.value)} placeholder="BE0..." style={{ ...inp, width: 140 }} /></div>
        <div><div style={muted}>Adres</div><input value={nieuwAdres} onChange={(e) => setNieuwAdres(e.target.value)} style={{ ...inp, width: 180 }} /></div>
        <div><div style={muted}>E-mail</div><input value={nieuwEmail} onChange={(e) => setNieuwEmail(e.target.value)} style={{ ...inp, width: 160 }} /></div>
        <button onClick={voegBedrijfToe} style={btnBlauw}>Bedrijf toevoegen</button>
      </div>

      {bedrijven.map((b) => (
        <div key={b.id} style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{b.naam}</div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>{b.btwNummer ?? ''}{b.email ? ` · ${b.email}` : ''}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 12, color: '#6b7280' }}>Openstaand</div>
              <div style={{ fontWeight: 700, fontSize: 18, color: (b.openstaand ?? 0) > 0 ? '#b45309' : '#166534' }}>{euro(b.openstaand)}</div>
            </div>
            <button onClick={() => bewerkBedrijf(b)} style={btnMini}>✎ Bewerken</button>
            <button onClick={() => toonVerkopen(b.id)} style={btnMini}>{verkopen[b.id] ? 'Verberg' : 'Verkopen'}</button>
            <button onClick={() => factureer(b)} disabled={(b.openstaand ?? 0) <= 0} style={{ ...btnBlauw, opacity: (b.openstaand ?? 0) <= 0 ? 0.5 : 1 }}>Factureren</button>
          </div>

          <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
            {b.leden.map((l) => (
              <div key={l.id} style={{ border: '1px solid #f0f0f0', borderRadius: 8, padding: '8px 10px', opacity: l.actief === false ? 0.5 : 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontWeight: 600 }}>{l.naam}</span>
                  <button onClick={() => bewerkLid(l)} title="Personeelslid aanpassen" style={{ ...btnMini, padding: '2px 7px', fontSize: 12 }}>✎</button>
                </div>
                <div style={{ fontSize: 13, color: '#374151' }}>
                  Openstaand: <strong>{euro(l.verbruikt)}</strong>
                </div>
                {/* Maandbudget: maximaal maandbedrag op rekening, afgedwongen aan de kassa. */}
                <div style={{ fontSize: 13, color: l.budget != null && (l.verbruiktMaand ?? 0) > l.budget ? 'crimson' : '#6b7280' }}>
                  Deze maand: {euro(l.verbruiktMaand)}
                  {l.budget != null
                    ? <> / max. {euro(l.budget)}{(l.verbruiktMaand ?? 0) > l.budget ? ' ⚠ overschreden' : ` (nog ${euro(Math.max(0, l.budget - (l.verbruiktMaand ?? 0)))})`}</>
                    : ' · geen maandmaximum'}
                </div>
              </div>
            ))}
            <button onClick={() => voegLidToe(b.id)} style={{ ...btnMini, border: '1px dashed #94a3b8', color: '#2563eb' }}>+ Personeelslid</button>
          </div>

          {verkopen[b.id] && (() => {
            const f = filters[b.id] ?? standaardFilter();
            const rows = verkopen[b.id];
            const som = (rs: RekeningVerkoop[]) => rs.reduce((s, v) => s + v.totaal, 0);
            const actief = rows.filter((v) => !v.geannuleerd);
            const open = actief.filter((v) => !v.gefactureerd);
            const gefact = actief.filter((v) => v.gefactureerd);
            return (
              <div style={{ marginTop: 10 }}>
                {/* Filter: enkel openstaand, of ook het verleden (gefactureerd) binnen een periode / per lid */}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 13, marginBottom: 6 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                    <input type="checkbox" checked={f.alle} onChange={(e) => zetFilter(b.id, { alle: e.target.checked })} />
                    Ook gefactureerde (verleden)
                  </label>
                  {f.alle && (
                    <>
                      <span style={{ color: '#6b7280' }}>van</span>
                      <input type="date" value={f.van} onChange={(e) => zetFilter(b.id, { van: e.target.value })} style={{ ...inp, padding: 4, fontSize: 13 }} />
                      <span style={{ color: '#6b7280' }}>tot</span>
                      <input type="date" value={f.tot} onChange={(e) => zetFilter(b.id, { tot: e.target.value })} style={{ ...inp, padding: 4, fontSize: 13 }} />
                    </>
                  )}
                  <select value={f.lidId} onChange={(e) => zetFilter(b.id, { lidId: e.target.value })} style={{ ...inp, padding: 4, fontSize: 13 }}>
                    <option value="">Alle personeelsleden</option>
                    {b.leden.map((l) => <option key={l.id} value={l.id}>{l.naam}</option>)}
                  </select>
                  {laadBezig === b.id && <span style={{ color: '#6b7280' }}>Laden…</span>}
                </div>
                {/* Op smartphone scrolt de tabel horizontaal binnen deze kader */}
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 560 }}>
                    <thead>
                      <tr style={{ textAlign: 'left', color: '#6b7280', borderBottom: '1px solid #eee' }}>
                        <th style={{ padding: 4 }}>Datum</th><th style={{ padding: 4 }}>Lid</th><th style={{ padding: 4 }}>Artikels</th><th style={{ padding: 4 }}>Status</th><th style={{ padding: 4, textAlign: 'right' }}>Bedrag</th><th style={{ padding: 4 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((v) => (
                        <tr key={v.id} style={{ borderBottom: '1px solid #f5f5f5', opacity: v.geannuleerd ? 0.55 : 1 }}>
                          <td style={{ padding: 4, whiteSpace: 'nowrap' }}>{new Date(v.datum).toLocaleString('nl-BE', { dateStyle: 'short', timeStyle: 'short' })}</td>
                          <td style={{ padding: 4 }}>{v.lid ?? '-'}</td>
                          <td style={{ padding: 4, color: '#6b7280' }}>{v.artikels.join(' · ')}</td>
                          <td style={{ padding: 4, whiteSpace: 'nowrap' }}>
                            {v.geannuleerd
                              ? <span style={{ color: '#b91c1c', fontWeight: 600 }}>Geannuleerd</span>
                              : v.gefactureerd
                                ? <span style={{ color: '#166534' }}>Gefactureerd</span>
                                : <span style={{ color: '#b45309', fontWeight: 600 }}>Open</span>}
                          </td>
                          <td style={{ padding: 4, textAlign: 'right', whiteSpace: 'nowrap', textDecoration: v.geannuleerd ? 'line-through' : 'none' }}>{euro(v.totaal)}</td>
                          <td style={{ padding: 4, textAlign: 'right', whiteSpace: 'nowrap' }}>
                            <button onClick={() => toonDetail(v.id)} title="Volledig ticket bekijken" style={{ ...btnMini, padding: '3px 9px', fontSize: 12 }}>Detail</button>
                            {verplaatsId === v.id ? (
                              <>
                                <select defaultValue="" onChange={(e) => { if (e.target.value) verplaatsNaar(v.id, e.target.value); }} style={{ fontSize: 12, padding: 2, marginLeft: 4 }}>
                                  <option value="">→ naar wie…</option>
                                  {bedrijven.map((bb) => (
                                    <optgroup key={bb.id} label={bb.naam}>
                                      {bb.leden.map((ll) => <option key={ll.id} value={ll.id}>{ll.naam}</option>)}
                                    </optgroup>
                                  ))}
                                </select>
                                <button onClick={() => setVerplaatsId(null)} title="Annuleren" style={{ ...btnMini, padding: '2px 7px', fontSize: 12, marginLeft: 4 }}>×</button>
                              </>
                            ) : (
                              !v.gefactureerd && !v.geannuleerd && (
                                <button onClick={() => setVerplaatsId(v.id)} style={{ ...btnMini, padding: '3px 9px', fontSize: 12, marginLeft: 4 }}>Verplaats</button>
                              )
                            )}
                          </td>
                        </tr>
                      ))}
                      {rows.length === 0 && (
                        <tr><td colSpan={6} style={{ padding: 8, color: '#999' }}>{f.alle ? 'Geen verkopen in deze periode.' : 'Geen openstaande verkopen.'}</td></tr>
                      )}
                    </tbody>
                    {rows.length > 0 && (
                      <tfoot>
                        <tr style={{ borderTop: '2px solid #e5e7eb', fontWeight: 600 }}>
                          <td colSpan={4} style={{ padding: 4 }}>
                            {actief.length} verkopen
                            {f.alle && <span style={{ fontWeight: 400, color: '#6b7280' }}> · open {euro(som(open))} · gefactureerd {euro(som(gefact))}</span>}
                          </td>
                          <td style={{ padding: 4, textAlign: 'right' }}>{euro(som(actief))}</td>
                          <td />
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>
            );
          })()}
        </div>
      ))}
      {bedrijven.length === 0 && <p style={{ color: '#999' }}>Nog geen bedrijven. Voeg er hierboven een toe.</p>}
    </div>
  );
}

const inp: CSSProperties = { padding: 8, fontSize: 14, boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 6 };
const muted: CSSProperties = { fontSize: 12, color: '#6b7280', marginBottom: 2 };
const btnBlauw: CSSProperties = { padding: '9px 16px', border: 'none', borderRadius: 6, background: '#0d4589', color: '#fff', cursor: 'pointer', fontWeight: 600 };
const btnMini: CSSProperties = { padding: '6px 12px', border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 13 };
