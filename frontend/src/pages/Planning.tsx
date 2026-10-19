import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { getPlanning, maakDienst, wijzigDienst, verwijderDienst, kopieerPlanningWeek, type Dienst, type PlanningMedewerker } from '../api/client';

// Planning: uurroosters maken per week. Rijen = medewerkers, kolommen = dagen.
// Klik op een vakje om een dienst toe te voegen, op een dienst om ze aan te passen.
// Per medewerker het weektotaal tegenover het normale regime en het plafond.
const LOCATIES: [string, string, string][] = [['', '—', '#374151'], ['WINKEL', 'Winkel', '#2563eb'], ['RESTAURANT', 'Restaurant', '#b45309'], ['CATERING', 'Catering', '#7c3aed']];
const DAGEN = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const vanIso = (s: string) => new Date(s + 'T12:00:00');
const plusDagen = (s: string, n: number) => { const d = vanIso(s); d.setDate(d.getDate() + n); return iso(d); };
const maandag = (s: string) => { const d = vanIso(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return iso(d); };
const uren = (n: number) => `${Math.floor(n)}u${String(Math.round((n % 1) * 60)).padStart(2, '0')}`;

type Form = { id?: string; gebruikerId: string; dag: string; start: string; eind: string; pauzeMin: string; locatie: string; opmerking: string };

export function Planning() {
  const vandaag = iso(new Date());
  const [start, setStart] = useState(maandag(vandaag));
  const [diensten, setDiensten] = useState<Dienst[]>([]);
  const [mensen, setMensen] = useState<PlanningMedewerker[]>([]);
  const [filter, setFilter] = useState('');
  const [form, setForm] = useState<Form | null>(null);
  const [fout, setFout] = useState('');
  const [melding, setMelding] = useState('');
  const [bezig, setBezig] = useState(false);
  const dagen = Array.from({ length: 7 }, (_, i) => plusDagen(start, i));

  async function laad() {
    setFout('');
    try { const r = await getPlanning(start, plusDagen(start, 6)); setDiensten(r.diensten); setMensen(r.medewerkers); }
    catch (e) { setFout(e instanceof Error ? e.message : 'Laden mislukt'); }
  }
  useEffect(() => { laad(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [start]);

  const zichtbaar = useMemo(() => mensen.filter((m) => !filter || m.afdelingen.includes(filter)), [mensen, filter]);
  const van = (gid: string, dag: string) => diensten.filter((d) => d.gebruikerId === gid && d.dag === dag);
  const weekTotaal = (gid: string) => diensten.filter((d) => d.gebruikerId === gid).reduce((s, d) => s + d.uren, 0);

  function nieuw(gid: string, dag: string) {
    const vorige = diensten.filter((d) => d.gebruikerId === gid).slice(-1)[0];
    const m = mensen.find((x) => x.id === gid);
    setForm({ gebruikerId: gid, dag, start: vorige?.start ?? '09:00', eind: vorige?.eind ?? '17:00', pauzeMin: String(vorige?.pauzeMin ?? 30), locatie: vorige?.locatie ?? (m?.afdelingen[0] ?? ''), opmerking: '' });
    setMelding('');
  }
  function bewerk(d: Dienst) {
    setForm({ id: d.id, gebruikerId: d.gebruikerId, dag: d.dag, start: d.start, eind: d.eind, pauzeMin: String(d.pauzeMin), locatie: d.locatie ?? '', opmerking: d.opmerking ?? '' });
    setMelding('');
  }
  async function bewaar() {
    if (!form) return;
    setBezig(true); setFout('');
    try {
      const input = { gebruikerId: form.gebruikerId, dag: form.dag, start: form.start, eind: form.eind, pauzeMin: Number(form.pauzeMin) || 0, locatie: form.locatie || null, opmerking: form.opmerking.trim() || null };
      if (form.id) await wijzigDienst(form.id, input); else await maakDienst(input);
      setForm(null); await laad();
    } catch (e) { setFout(e instanceof Error ? e.message : 'Bewaren mislukt'); }
    finally { setBezig(false); }
  }
  async function verwijder() {
    if (!form?.id) return;
    setBezig(true); setFout('');
    try { await verwijderDienst(form.id); setForm(null); await laad(); }
    catch (e) { setFout(e instanceof Error ? e.message : 'Verwijderen mislukt'); }
    finally { setBezig(false); }
  }
  async function kopieerVorige() {
    const vorige = plusDagen(start, -7);
    if (!window.confirm(`Het rooster van de week van ${vanIso(vorige).toLocaleDateString('nl-BE')} kopiëren naar deze week?\n\nDiensten die hier al staan (zelfde persoon, dag en beginuur) worden overgeslagen.`)) return;
    setBezig(true); setFout(''); setMelding('');
    try { const r = await kopieerPlanningWeek(vorige, start); setMelding(`${r.gekopieerd} dienst(en) gekopieerd${r.overgeslagen ? `, ${r.overgeslagen} overgeslagen` : ''}.`); await laad(); }
    catch (e) { setFout(e instanceof Error ? e.message : 'Kopiëren mislukt'); }
    finally { setBezig(false); }
  }

  const naamVan = (gid: string) => mensen.find((m) => m.id === gid)?.naam ?? '';

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>Planning</h2>
        <button onClick={() => setStart(plusDagen(start, -7))} style={btnGrijs}>‹ vorige</button>
        <button onClick={() => setStart(maandag(vandaag))} style={btnGrijs}>Deze week</button>
        <button onClick={() => setStart(plusDagen(start, 7))} style={btnGrijs}>volgende ›</button>
        <strong>{vanIso(start).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' })} – {vanIso(plusDagen(start, 6)).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', year: 'numeric' })}</strong>
        <div style={{ display: 'flex', gap: 4 }}>
          {[['', 'Iedereen'], ['WINKEL', 'Winkel'], ['RESTAURANT', 'Restaurant'], ['CATERING', 'Catering']].map(([k, n]) => (
            <button key={k} onClick={() => setFilter(k)} style={{ ...btnMini, fontWeight: filter === k ? 700 : 400, background: filter === k ? '#111827' : '#fff', color: filter === k ? '#fff' : '#111827' }}>{n}</button>
          ))}
        </div>
        <button onClick={kopieerVorige} disabled={bezig} style={{ ...btnGrijs, marginLeft: 'auto' }}>⧉ Vorige week kopiëren</button>
      </div>
      <p style={{ color: '#6b7280', fontSize: 13, margin: '6px 0 10px' }}>Klik in een vakje om een dienst toe te voegen, op een dienst om ze aan te passen. Elke medewerker ziet zijn eigen diensten bij "Mijn rooster". Een dienst boven het dagplafond van de medewerker wordt geweigerd.</p>
      {fout && <p style={{ color: 'crimson', fontWeight: 600 }}>{fout}</p>}
      {melding && <p style={{ color: '#166534', fontWeight: 600 }}>{melding}</p>}

      {form && (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 12, marginBottom: 12, background: '#fafafa' }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>{form.id ? 'Dienst aanpassen' : 'Nieuwe dienst'} · {naamVan(form.gebruikerId)}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={lab}>Medewerker<select value={form.gebruikerId} onChange={(e) => setForm({ ...form, gebruikerId: e.target.value })} style={inp}>{mensen.map((m) => <option key={m.id} value={m.id}>{m.naam}</option>)}</select></label>
            <label style={lab}>Dag<input type="date" value={form.dag} onChange={(e) => setForm({ ...form, dag: e.target.value })} style={inp} /></label>
            <label style={lab}>Van<input type="time" step={900} value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} style={inp} /></label>
            <label style={lab}>Tot<input type="time" step={900} value={form.eind} onChange={(e) => setForm({ ...form, eind: e.target.value })} style={inp} /></label>
            <label style={lab}>Pauze (min)<input value={form.pauzeMin} onChange={(e) => setForm({ ...form, pauzeMin: e.target.value })} inputMode="numeric" style={{ ...inp, width: 80 }} /></label>
            <label style={lab}>Locatie<select value={form.locatie} onChange={(e) => setForm({ ...form, locatie: e.target.value })} style={inp}>{LOCATIES.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>
            <label style={{ ...lab, flex: '1 1 200px' }}>Opmerking<input value={form.opmerking} onChange={(e) => setForm({ ...form, opmerking: e.target.value })} placeholder="bv. inventaris, opening" style={inp} /></label>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <button onClick={bewaar} disabled={bezig} style={btnGroen}>{bezig ? 'Bezig…' : form.id ? 'Opslaan' : 'Inplannen'}</button>
            <button onClick={() => setForm(null)} disabled={bezig} style={btnGrijs}>Annuleren</button>
            {form.id && <button onClick={verwijder} disabled={bezig} style={{ ...btnGrijs, color: 'crimson', borderColor: '#fca5a5', marginLeft: 'auto' }}>Verwijderen</button>}
          </div>
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 900, fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: 'left', width: 170 }}>Medewerker</th>
              {dagen.map((d, i) => (
                <th key={d} style={{ ...th, background: d === vandaag ? '#eff6ff' : undefined }}>{DAGEN[i]} {vanIso(d).getDate()}/{vanIso(d).getMonth() + 1}</th>
              ))}
              <th style={{ ...th, width: 110 }}>Week</th>
            </tr>
          </thead>
          <tbody>
            {zichtbaar.map((m) => {
              const tot = weekTotaal(m.id);
              const boven = tot > m.maxUrenWeek + 0.001;
              const over = m.urenPerWeek != null && tot > m.urenPerWeek + 0.001;
              return (
                <tr key={m.id}>
                  <td style={{ ...td, fontWeight: 600 }}>{m.naam}<div style={{ fontSize: 11, color: '#6b7280', fontWeight: 400 }}>{[m.statuut?.toLowerCase(), ...m.afdelingen.map((a) => a.toLowerCase())].filter(Boolean).join(' · ')}</div></td>
                  {dagen.map((dag) => (
                    <td key={dag} onClick={() => nieuw(m.id, dag)} style={{ ...td, cursor: 'pointer', verticalAlign: 'top', background: dag === vandaag ? '#f8fbff' : undefined }} title="Klik om een dienst toe te voegen">
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        {van(m.id, dag).map((d) => {
                          const kleur = LOCATIES.find(([k]) => k === (d.locatie ?? ''))?.[2] ?? '#374151';
                          return (
                            <button key={d.id} onClick={(e) => { e.stopPropagation(); bewerk(d); }} title={d.opmerking ?? ''} style={{ textAlign: 'left', border: `1px solid ${kleur}`, borderLeftWidth: 4, borderRadius: 6, background: '#fff', padding: '2px 5px', cursor: 'pointer', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
                              <strong>{d.start}–{d.eind}</strong>
                              <div style={{ color: '#6b7280', fontSize: 11 }}>{uren(d.uren)}{d.locatie ? ' · ' + LOCATIES.find(([k]) => k === d.locatie)?.[1] : ''}</div>
                            </button>
                          );
                        })}
                        <span style={{ color: '#cbd5e1', fontSize: 16, lineHeight: 1 }}>+</span>
                      </div>
                    </td>
                  ))}
                  <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: boven ? '#b91c1c' : over ? '#b45309' : '#111827', fontWeight: 700 }}>
                    {uren(tot)}
                    <div style={{ fontSize: 11, fontWeight: 400, color: '#6b7280' }}>{m.urenPerWeek != null ? `normaal ${uren(m.urenPerWeek)}` : 'geen regime'}</div>
                    {boven && <div style={{ fontSize: 11 }}>boven plafond {m.maxUrenWeek}u</div>}
                  </td>
                </tr>
              );
            })}
            {zichtbaar.length === 0 && <tr><td colSpan={9} style={{ ...td, color: '#6b7280' }}>Geen medewerkers{filter ? ' in deze afdeling (stel de afdelingen in via het personeelsdossier)' : ''}.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const th: CSSProperties = { padding: '6px 4px', borderBottom: '2px solid #e5e7eb', fontSize: 12, color: '#374151', textAlign: 'center' };
const td: CSSProperties = { padding: 4, borderBottom: '1px solid #f0f0f0', borderRight: '1px solid #f5f5f5' };
const inp: CSSProperties = { padding: 7, fontSize: 14, boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 6, width: '100%' };
const lab: CSSProperties = { fontSize: 12, color: '#6b7280', display: 'flex', flexDirection: 'column', gap: 2 };
const btnGroen: CSSProperties = { padding: '9px 16px', border: 'none', borderRadius: 8, background: '#16a34a', color: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 14 };
const btnGrijs: CSSProperties = { padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: 8, background: '#fff', cursor: 'pointer', fontSize: 14 };
const btnMini: CSSProperties = { padding: '4px 9px', border: '1px solid #cbd5e1', borderRadius: 6, cursor: 'pointer', fontSize: 12 };
