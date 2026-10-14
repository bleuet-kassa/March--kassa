import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { getAgenda, maakAgendaItem, wijzigAgendaItem, verwijderAgendaItem, downloadAgendaExcel, type AgendaItem, type AgendaInput } from '../api/client';

// Agenda van de zaak: weekoverzicht met manuele bestellingen en agendapunten,
// plus de webshopbestellingen (komen er automatisch in). Iedereen kan er aan;
// export naar Excel voor een gekozen periode.
const SOORTEN: [string, string, string][] = [['BESTELLING', 'Bestelling', '#b45309'], ['LEVERING', 'Levering', '#1d4ed8'], ['AFSPRAAK', 'Afspraak', '#6d28d9'], ['NOTITIE', 'Notitie', '#374151']];
const LOCATIES: [string, string][] = [['', '—'], ['WINKEL', 'Winkel'], ['RESTAURANT', 'Restaurant'], ['CATERING', 'Catering']];
const DAGEN = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const vanIso = (s: string) => new Date(s + 'T12:00:00');
const plusDagen = (s: string, n: number) => { const d = vanIso(s); d.setDate(d.getDate() + n); return iso(d); };
const maandag = (s: string) => { const d = vanIso(s); const w = (d.getDay() + 6) % 7; d.setDate(d.getDate() - w); return iso(d); };
const euro = (n: number) => '€ ' + n.toFixed(2);
const datumNl = (s: string, opt: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) => vanIso(s).toLocaleDateString('nl-BE', opt);

type Formulier = AgendaInput & { id?: string };
const leeg = (dag: string): Formulier => ({ dag, tijd: '', soort: 'BESTELLING', titel: '', omschrijving: '', klantNaam: '', klantTelefoon: '', klantEmail: '', bedrag: null, locatie: 'WINKEL', status: 'OPEN' });

export function Agenda() {
  const vandaag = iso(new Date());
  const [start, setStart] = useState(maandag(vandaag)); // maandag van de getoonde week
  const [items, setItems] = useState<AgendaItem[]>([]);
  const [fout, setFout] = useState('');
  const [melding, setMelding] = useState('');
  const [bezig, setBezig] = useState(false);
  const [form, setForm] = useState<Formulier | null>(null);
  const [toonKlaar, setToonKlaar] = useState(true);
  const [exportVan, setExportVan] = useState(vandaag.slice(0, 8) + '01');
  const [exportTot, setExportTot] = useState(iso(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0)));
  const eind = plusDagen(start, 6);

  async function laad() {
    setFout('');
    try { setItems(await getAgenda(start, eind)); }
    catch (e) { setFout(e instanceof Error ? e.message : 'Laden mislukt'); }
  }
  useEffect(() => { laad(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [start]);

  const perDag = useMemo(() => {
    const m = new Map<string, AgendaItem[]>();
    for (let i = 0; i < 7; i++) m.set(plusDagen(start, i), []);
    for (const it of items) { if (!toonKlaar && it.status !== 'OPEN') continue; m.get(it.dag)?.push(it); }
    return m;
  }, [items, start, toonKlaar]);

  async function bewaar() {
    if (!form) return;
    setBezig(true); setFout(''); setMelding('');
    try {
      const data: AgendaInput = { ...form, bedrag: form.bedrag === null || (form.bedrag as unknown) === '' ? null : Number(String(form.bedrag).replace(',', '.')) };
      if (form.id) await wijzigAgendaItem(form.id, data); else await maakAgendaItem(data);
      setMelding(form.id ? 'Aangepast.' : 'Toegevoegd aan de agenda.');
      setForm(null);
      if (data.dag < start || data.dag > eind) setStart(maandag(data.dag)); else await laad();
    } catch (e) { setFout(e instanceof Error ? e.message : 'Bewaren mislukt'); }
    finally { setBezig(false); }
  }
  async function zetStatus(it: AgendaItem, status: string) {
    setBezig(true); setFout('');
    try { await wijzigAgendaItem(it.id, { status }); await laad(); }
    catch (e) { setFout(e instanceof Error ? e.message : 'Aanpassen mislukt'); }
    finally { setBezig(false); }
  }
  async function verwijder(it: AgendaItem) {
    if (!window.confirm(`"${it.titel}" verwijderen uit de agenda?`)) return;
    setBezig(true); setFout('');
    try { await verwijderAgendaItem(it.id); await laad(); }
    catch (e) { setFout(e instanceof Error ? e.message : 'Verwijderen mislukt'); }
    finally { setBezig(false); }
  }
  async function exporteer() {
    setBezig(true); setFout(''); setMelding('');
    try { await downloadAgendaExcel(exportVan, exportTot); setMelding('Excel-bestand gedownload.'); }
    catch (e) { setFout(e instanceof Error ? e.message : 'Export mislukt'); }
    finally { setBezig(false); }
  }

  const soortInfo = (s: string) => SOORTEN.find(([k]) => k === s) ?? ['', s, '#374151'];
  const weekTotaal = items.filter((i) => i.status === 'OPEN').length;

  return (
    <div style={{ maxWidth: 1200 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>Agenda</h2>
        <button onClick={() => setStart(plusDagen(start, -7))} style={btnGrijs}>‹ vorige week</button>
        <button onClick={() => setStart(maandag(vandaag))} style={btnGrijs}>Vandaag</button>
        <button onClick={() => setStart(plusDagen(start, 7))} style={btnGrijs}>volgende week ›</button>
        <strong style={{ fontSize: 16 }}>{datumNl(start)} – {datumNl(eind, { day: 'numeric', month: 'short', year: 'numeric' })}</strong>
        <span style={{ color: '#6b7280', fontSize: 13 }}>{weekTotaal} open</span>
        <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}><input type="checkbox" checked={toonKlaar} onChange={(e) => setToonKlaar(e.target.checked)} /> ook klaar/geannuleerd tonen</label>
        <button onClick={() => setForm(leeg(vandaag))} style={{ ...btnGroen, marginLeft: 'auto' }}>+ Toevoegen</button>
      </div>
      <p style={{ color: '#6b7280', fontSize: 14, margin: '6px 0 12px' }}>Bestellingen en agendapunten van de zaak. Webshopbestellingen verschijnen hier automatisch op de dag van de bestelling. Klik op een item om het aan te passen.</p>
      {fout && <p style={{ color: 'crimson' }}>{fout}</p>}
      {melding && <p style={{ color: '#166534', fontWeight: 600 }}>{melding}</p>}

      {form && (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 14, marginBottom: 14, background: '#fafafa' }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>{form.id ? 'Agendapunt aanpassen' : 'Nieuw agendapunt'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8 }}>
            <label style={lab}>Datum<input type="date" value={form.dag} onChange={(e) => setForm({ ...form, dag: e.target.value })} style={inp} /></label>
            <label style={lab}>Uur<input type="time" value={form.tijd ?? ''} onChange={(e) => setForm({ ...form, tijd: e.target.value })} style={inp} /></label>
            <label style={lab}>Soort<select value={form.soort} onChange={(e) => setForm({ ...form, soort: e.target.value })} style={inp} disabled={!!form.id && items.find((i) => i.id === form.id)?.bron === 'WEBSHOP'}>{SOORTEN.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>
            <label style={lab}>Locatie<select value={form.locatie ?? ''} onChange={(e) => setForm({ ...form, locatie: e.target.value })} style={inp}>{LOCATIES.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>
            <label style={{ ...lab, gridColumn: '1 / -1' }}>Titel *<input value={form.titel} onChange={(e) => setForm({ ...form, titel: e.target.value })} placeholder="bv. Bestelling kaasschotel 12 pers." style={inp} autoFocus /></label>
            <label style={lab}>Klant<input value={form.klantNaam ?? ''} onChange={(e) => setForm({ ...form, klantNaam: e.target.value })} style={inp} /></label>
            <label style={lab}>Telefoon<input value={form.klantTelefoon ?? ''} onChange={(e) => setForm({ ...form, klantTelefoon: e.target.value })} inputMode="tel" style={inp} /></label>
            <label style={lab}>E-mail<input value={form.klantEmail ?? ''} onChange={(e) => setForm({ ...form, klantEmail: e.target.value })} inputMode="email" style={inp} /></label>
            <label style={lab}>Bedrag (€)<input value={form.bedrag ?? ''} onChange={(e) => setForm({ ...form, bedrag: e.target.value as unknown as number })} inputMode="decimal" placeholder="0,00" style={inp} /></label>
            <label style={{ ...lab, gridColumn: '1 / -1' }}>Omschrijving<textarea value={form.omschrijving ?? ''} onChange={(e) => setForm({ ...form, omschrijving: e.target.value })} rows={3} placeholder="Wat moet er klaarstaan, bijzonderheden, voorschot…" style={{ ...inp, resize: 'vertical' }} /></label>
            {form.id && <label style={lab}>Status<select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} style={inp}><option value="OPEN">Open</option><option value="KLAAR">Klaar</option><option value="GEANNULEERD">Geannuleerd</option></select></label>}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <button onClick={bewaar} disabled={bezig || !form.titel.trim()} style={btnGroen}>{bezig ? 'Bezig…' : form.id ? 'Opslaan' : 'Toevoegen'}</button>
            <button onClick={() => setForm(null)} disabled={bezig} style={btnGrijs}>Annuleren</button>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
        {[...perDag.entries()].map(([dag, lijst]) => {
          const isVandaag = dag === vandaag;
          return (
            <div key={dag} style={{ border: isVandaag ? '2px solid #2563eb' : '1px solid #e5e7eb', borderRadius: 10, background: isVandaag ? '#eff6ff' : '#fff', minHeight: 140, display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: '6px 8px', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ fontWeight: 700 }}>{DAGEN[(vanIso(dag).getDay() + 6) % 7]} {datumNl(dag)}</span>
                <button onClick={() => setForm(leeg(dag))} title="Toevoegen op deze dag" style={{ ...btnMini, padding: '0 7px', fontSize: 16, lineHeight: '22px' }}>+</button>
              </div>
              <div style={{ padding: 6, display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
                {lijst.length === 0 && <span style={{ color: '#b0b4b8', fontSize: 12, padding: 4 }}>—</span>}
                {lijst.map((it) => {
                  const [, naam, kleur] = soortInfo(it.soort);
                  const klaar = it.status !== 'OPEN';
                  return (
                    <div key={it.id} onClick={() => setForm({ id: it.id, dag: it.dag, tijd: it.tijd ?? '', soort: it.soort, titel: it.titel, omschrijving: it.omschrijving ?? '', klantNaam: it.klantNaam ?? '', klantTelefoon: it.klantTelefoon ?? '', klantEmail: it.klantEmail ?? '', bedrag: it.bedrag, locatie: it.locatie ?? '', status: it.status })}
                      style={{ borderLeft: `4px solid ${kleur}`, background: '#fff', border: '1px solid #e5e7eb', borderLeftWidth: 4, borderLeftColor: kleur, borderRadius: 8, padding: '6px 8px', cursor: 'pointer', opacity: klaar ? .55 : 1, textDecoration: it.status === 'GEANNULEERD' ? 'line-through' : 'none' }}>
                      <div style={{ fontSize: 11, color: kleur, fontWeight: 700, display: 'flex', gap: 6, justifyContent: 'space-between' }}>
                        <span>{it.tijd ? it.tijd + ' · ' : ''}{naam}{it.bron === 'WEBSHOP' ? ' · webshop' : ''}</span>
                        {it.status === 'KLAAR' && <span style={{ color: '#166534' }}>✔</span>}
                      </div>
                      <div style={{ fontWeight: 600, fontSize: 14, lineHeight: 1.25 }}>{it.titel}</div>
                      {(it.klantNaam || it.bedrag != null) && <div style={{ fontSize: 12, color: '#6b7280' }}>{it.klantNaam}{it.klantNaam && it.bedrag != null ? ' · ' : ''}{it.bedrag != null ? euro(it.bedrag) : ''}</div>}
                      {it.klantTelefoon && <div style={{ fontSize: 12, color: '#6b7280' }}>☎ {it.klantTelefoon}</div>}
                      {it.omschrijving && <div style={{ fontSize: 12, color: '#374151', marginTop: 2, whiteSpace: 'pre-wrap' }}>{it.omschrijving}</div>}
                      {it.status === 'OPEN' && (
                        <div style={{ display: 'flex', gap: 4, marginTop: 6 }} onClick={(e) => e.stopPropagation()}>
                          <button onClick={() => zetStatus(it, 'KLAAR')} disabled={bezig} style={{ ...btnMini, color: '#166534' }}>Klaar</button>
                          {it.bron !== 'WEBSHOP' && <button onClick={() => verwijder(it)} disabled={bezig} style={{ ...btnMini, color: 'crimson' }}>×</button>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 18, border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <strong>Exporteren naar Excel</strong>
        <label style={{ fontSize: 13 }}>van <input type="date" value={exportVan} onChange={(e) => setExportVan(e.target.value)} style={{ ...inp, width: 'auto' }} /></label>
        <label style={{ fontSize: 13 }}>tot <input type="date" value={exportTot} onChange={(e) => setExportTot(e.target.value)} style={{ ...inp, width: 'auto' }} /></label>
        <button onClick={exporteer} disabled={bezig || !exportVan || !exportTot} style={btnGrijs}>⬇ Excel downloaden</button>
        <span style={{ fontSize: 12, color: '#6b7280' }}>Eén rij per agendapunt: datum, uur, soort, titel, klant, bedrag, locatie, status, bron, omschrijving.</span>
      </div>
    </div>
  );
}

const inp: CSSProperties = { width: '100%', padding: 8, fontSize: 14, boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 6 };
const lab: CSSProperties = { fontSize: 12, color: '#6b7280', display: 'flex', flexDirection: 'column', gap: 2 };
const btnGroen: CSSProperties = { padding: '9px 16px', border: 'none', borderRadius: 8, background: '#16a34a', color: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 14 };
const btnGrijs: CSSProperties = { padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: 8, background: '#fff', cursor: 'pointer', fontSize: 14 };
const btnMini: CSSProperties = { padding: '3px 8px', border: '1px solid #cbd5e1', borderRadius: 5, background: '#fff', cursor: 'pointer', fontSize: 12 };
