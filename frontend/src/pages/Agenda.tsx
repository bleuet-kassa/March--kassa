import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { getAgenda, maakAgendaItem, wijzigAgendaItem, verwijderAgendaItem, downloadAgendaExcel, markeerAgendaGelezen, getAgendaHerhalingen, maakAgendaHerhaling, wijzigAgendaHerhaling, verwijderAgendaHerhaling, type AgendaItem, type AgendaInput, type AgendaHerhaling, type HerhalingInput } from '../api/client';

// Agenda van de zaak: weekoverzicht met manuele bestellingen en agendapunten,
// plus de webshopbestellingen (komen er automatisch in). Iedereen kan er aan;
// export naar Excel voor een gekozen periode.
const SOORTEN: [string, string, string][] = [['BESTELLING', 'Bestelling', '#b45309'], ['LEVERING', 'Levering', '#1d4ed8'], ['AFSPRAAK', 'Afspraak', '#6d28d9'], ['NOTITIE', 'Notitie', '#374151']];
const LOCATIES: [string, string][] = [['', '—'], ['WINKEL', 'Winkel'], ['RESTAURANT', 'Restaurant'], ['CATERING', 'Catering']];
// Categorieën voor de gesplitste Excel-export (en als filter in het overzicht).
const CATEGORIEEN: [string, string][] = [['BROOD', 'Brood'], ['CATERING', 'Catering'], ['BOODSCHAPPEN', 'Boodschappen']];
const catNaam = (c: string | null) => CATEGORIEEN.find(([k]) => k === c)?.[1] ?? '';
const DAGEN = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const vanIso = (s: string) => new Date(s + 'T12:00:00');
const plusDagen = (s: string, n: number) => { const d = vanIso(s); d.setDate(d.getDate() + n); return iso(d); };
const maandag = (s: string) => { const d = vanIso(s); const w = (d.getDay() + 6) % 7; d.setDate(d.getDate() - w); return iso(d); };
const euro = (n: number) => '€ ' + n.toFixed(2);
const datumNl = (s: string, opt: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) => vanIso(s).toLocaleDateString('nl-BE', opt);

type Formulier = AgendaInput & { id?: string };
const WEEKDAGEN: [number, string][] = [[1, 'ma'], [2, 'di'], [3, 'wo'], [4, 'do'], [5, 'vr'], [6, 'za'], [7, 'zo']];
const FREQUENTIES: [HerhalingInput['frequentie'], string][] = [['WEKELIJKS', 'Elke week'], ['TWEEWEKELIJKS', 'Om de twee weken'], ['MAANDELIJKS', 'Elke maand']];
const legeHerhaling = (start: string): HerhalingInput => ({ titel: '', soort: 'BESTELLING', categorie: '', locatie: 'WINKEL', tijd: '', omschrijving: '', klantNaam: '', frequentie: 'WEKELIJKS', weekdagen: [], dagVanMaand: null, start, einde: '', actief: true });
// Leesbare samenvatting van een herhaling, bv. "elke week op ma, do · 08:00".
function herhalingTekst(h: AgendaHerhaling) {
  const f = h.frequentie === 'MAANDELIJKS' ? `elke maand op dag ${h.dagVanMaand ?? '?'}` : `${h.frequentie === 'WEKELIJKS' ? 'elke week' : 'om de 2 weken'} op ${h.weekdagen.map((d) => WEEKDAGEN.find(([n]) => n === d)?.[1] ?? d).join(', ')}`;
  return `${f}${h.tijd ? ' · ' + h.tijd : ''} · vanaf ${datumNl(h.start)}${h.einde ? ' tot ' + datumNl(h.einde) : ''}`;
}
const leeg = (dag: string): Formulier => ({ dag, tijd: '', soort: 'BESTELLING', titel: '', omschrijving: '', klantNaam: '', klantTelefoon: '', klantEmail: '', bedrag: null, locatie: 'WINKEL', categorie: 'BOODSCHAPPEN', status: 'OPEN' });

export function Agenda() {
  const vandaag = iso(new Date());
  const [start, setStart] = useState(maandag(vandaag)); // maandag van de getoonde week
  const [items, setItems] = useState<AgendaItem[]>([]);
  const [fout, setFout] = useState('');
  const [melding, setMelding] = useState('');
  const [bezig, setBezig] = useState(false);
  const [form, setForm] = useState<Formulier | null>(null);
  const [toonKlaar, setToonKlaar] = useState(true);
  const [catFilter, setCatFilter] = useState(''); // '' = alle categorieën
  // Terugkerende activiteiten (wekelijks / om de 2 weken / maandelijks).
  const [herhalingen, setHerhalingen] = useState<AgendaHerhaling[]>([]);
  const [toonHerhalingen, setToonHerhalingen] = useState(false);
  const [hForm, setHForm] = useState<(HerhalingInput & { id?: string }) | null>(null);
  async function laadHerhalingen() { try { setHerhalingen(await getAgendaHerhalingen()); } catch { /* geen toegang */ } }
  useEffect(() => { laadHerhalingen(); }, []);
  async function bewaarHerhaling() {
    if (!hForm) return;
    setBezig(true); setFout(''); setMelding('');
    try {
      const data: HerhalingInput = { ...hForm, dagVanMaand: hForm.frequentie === 'MAANDELIJKS' ? Number(hForm.dagVanMaand) || null : null, weekdagen: hForm.frequentie === 'MAANDELIJKS' ? [] : hForm.weekdagen };
      if (hForm.id) await wijzigAgendaHerhaling(hForm.id, data); else await maakAgendaHerhaling(data);
      setMelding(hForm.id ? 'Terugkerende activiteit aangepast; de komende dagen zijn opnieuw ingepland.' : 'Terugkerende activiteit ingepland.');
      setHForm(null); await laadHerhalingen(); await laad();
    } catch (e) { setFout(e instanceof Error ? e.message : 'Bewaren mislukt'); }
    finally { setBezig(false); }
  }
  async function verwijderHerhaling(h: AgendaHerhaling) {
    if (!window.confirm(`"${h.titel}" niet meer herhalen?\n\nDe komende, nog open dagen verdwijnen uit de agenda; wat al voorbij is blijft staan.`)) return;
    setBezig(true); setFout('');
    try { await verwijderAgendaHerhaling(h.id); await laadHerhalingen(); await laad(); }
    catch (e) { setFout(e instanceof Error ? e.message : 'Verwijderen mislukt'); }
    finally { setBezig(false); }
  }
  async function zetHerhalingActief(h: AgendaHerhaling, actief: boolean) {
    setBezig(true); setFout('');
    try { await wijzigAgendaHerhaling(h.id, { actief }); await laadHerhalingen(); await laad(); }
    catch (e) { setFout(e instanceof Error ? e.message : 'Aanpassen mislukt'); }
    finally { setBezig(false); }
  }
  const [exportCat, setExportCat] = useState(''); // '' = alles, tabblad per categorie
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
    for (const it of items) {
      if (!toonKlaar && it.status !== 'OPEN') continue;
      if (catFilter && it.categorie !== catFilter) continue;
      m.get(it.dag)?.push(it);
    }
    return m;
  }, [items, start, toonKlaar, catFilter]);

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
  // Webshopbestelling gelezen: ze verhuist van de besteldag naar de afhaal-/leverdag.
  async function gelezen(it: AgendaItem) {
    setBezig(true); setFout(''); setMelding('');
    try {
      const r = await markeerAgendaGelezen(it.id);
      setMelding(r.afhaalDag ? `Bestelling van ${it.klantNaam ?? 'klant'} staat nu op ${datumNl(r.dag, { weekday: 'long', day: 'numeric', month: 'long' })}${r.tijd ? ' om ' + r.tijd : ''}.` : 'Gemarkeerd als gelezen.');
      await laad();
    } catch (e) { setFout(e instanceof Error ? e.message : 'Markeren mislukt'); }
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
    try { await downloadAgendaExcel(exportVan, exportTot, exportCat); setMelding(exportCat ? `Excel-bestand (${catNaam(exportCat)}) gedownload.` : 'Excel-bestand gedownload: een tabblad per categorie plus "Alles".'); }
    catch (e) { setFout(e instanceof Error ? e.message : 'Export mislukt'); }
    finally { setBezig(false); }
  }

  const soortInfo = (s: string) => SOORTEN.find(([k]) => k === s) ?? ['', s, '#374151'];
  const weekTotaal = items.filter((i) => i.status === 'OPEN').length;
  const ongelezen = items.filter((i) => i.bron === 'WEBSHOP' && !i.gelezen && i.status === 'OPEN').length;

  return (
    <div style={{ maxWidth: 1200 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0 }}>Agenda</h2>
        <button onClick={() => setStart(plusDagen(start, -7))} style={btnGrijs}>‹ vorige week</button>
        <button onClick={() => setStart(maandag(vandaag))} style={btnGrijs}>Vandaag</button>
        <button onClick={() => setStart(plusDagen(start, 7))} style={btnGrijs}>volgende week ›</button>
        <strong style={{ fontSize: 16 }}>{datumNl(start)} – {datumNl(eind, { day: 'numeric', month: 'short', year: 'numeric' })}</strong>
        <span style={{ color: '#6b7280', fontSize: 13 }}>{weekTotaal} open</span>
        {ongelezen > 0 && <span style={{ background: '#dc2626', color: '#fff', borderRadius: 999, padding: '2px 10px', fontSize: 13, fontWeight: 700 }}>{ongelezen} nieuwe webshopbestelling{ongelezen === 1 ? '' : 'en'}</span>}
        <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}><input type="checkbox" checked={toonKlaar} onChange={(e) => setToonKlaar(e.target.checked)} /> ook klaar/geannuleerd tonen</label>
        <div style={{ display: 'flex', gap: 4 }}>
          {[['', 'Alles'], ...CATEGORIEEN].map(([k, n]) => (
            <button key={k} onClick={() => setCatFilter(k)} style={{ ...btnMini, fontWeight: catFilter === k ? 700 : 400, background: catFilter === k ? '#111827' : '#fff', color: catFilter === k ? '#fff' : '#111827', borderColor: catFilter === k ? '#111827' : '#cbd5e1' }}>{n}</button>
          ))}
        </div>
        <button onClick={() => { setToonHerhalingen(!toonHerhalingen); setHForm(null); }} style={{ ...btnGrijs, marginLeft: 'auto', fontWeight: toonHerhalingen ? 700 : 400 }}>↻ Terugkerend{herhalingen.filter((h) => h.actief).length ? ` (${herhalingen.filter((h) => h.actief).length})` : ''}</button>
        <button onClick={() => setForm(leeg(vandaag))} style={btnGroen}>+ Toevoegen</button>
      </div>

      {toonHerhalingen && (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 14, margin: '12px 0', background: '#f8fafc' }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <strong>↻ Terugkerende activiteiten</strong>
            <span style={{ fontSize: 13, color: '#6b7280' }}>bv. bestelling bij de bakker elke ma en do, afvalophaling om de twee weken op vrijdag. Elke dag wordt een gewoon agendapunt dat je op Klaar zet.</span>
            {!hForm && <button onClick={() => setHForm(legeHerhaling(vandaag))} style={{ ...btnGroen, marginLeft: 'auto' }}>+ Nieuwe herhaling</button>}
          </div>
          {hForm && (
            <div style={{ marginTop: 10, padding: 12, border: '1px solid #e5e7eb', borderRadius: 10, background: '#fff' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8 }}>
                <label style={{ ...lab, gridColumn: '1 / -1' }}>Titel *<input value={hForm.titel} onChange={(e) => setHForm({ ...hForm, titel: e.target.value })} placeholder="bv. Bestelling bakker / Afvalophaling" style={inp} autoFocus /></label>
                <label style={lab}>Hoe vaak<select value={hForm.frequentie} onChange={(e) => setHForm({ ...hForm, frequentie: e.target.value as HerhalingInput['frequentie'] })} style={inp}>{FREQUENTIES.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>
                {hForm.frequentie === 'MAANDELIJKS'
                  ? <label style={lab}>Dag van de maand<input type="number" min={1} max={31} value={hForm.dagVanMaand ?? ''} onChange={(e) => setHForm({ ...hForm, dagVanMaand: Number(e.target.value) || null })} style={inp} /></label>
                  : (
                    <div style={lab}>Op welke dagen
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {WEEKDAGEN.map(([n, naam]) => {
                          const aan = hForm.weekdagen.includes(n);
                          return <button key={n} type="button" onClick={() => setHForm({ ...hForm, weekdagen: aan ? hForm.weekdagen.filter((x) => x !== n) : [...hForm.weekdagen, n].sort() })} style={{ ...btnMini, padding: '6px 10px', fontWeight: aan ? 700 : 400, background: aan ? '#111827' : '#fff', color: aan ? '#fff' : '#111827', borderColor: aan ? '#111827' : '#cbd5e1' }}>{naam}</button>;
                        })}
                      </div>
                    </div>
                  )}
                <label style={lab}>Uur<input type="time" value={hForm.tijd ?? ''} onChange={(e) => setHForm({ ...hForm, tijd: e.target.value })} style={inp} /></label>
                <label style={lab}>Vanaf<input type="date" value={hForm.start} onChange={(e) => setHForm({ ...hForm, start: e.target.value })} style={inp} /></label>
                <label style={lab}>Tot (leeg = blijft lopen)<input type="date" value={hForm.einde ?? ''} onChange={(e) => setHForm({ ...hForm, einde: e.target.value })} style={inp} /></label>
                <label style={lab}>Soort<select value={hForm.soort} onChange={(e) => setHForm({ ...hForm, soort: e.target.value })} style={inp}>{SOORTEN.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>
                <label style={lab}>Categorie<select value={hForm.categorie ?? ''} onChange={(e) => setHForm({ ...hForm, categorie: e.target.value })} style={inp}><option value="">—</option>{CATEGORIEEN.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>
                <label style={lab}>Locatie<select value={hForm.locatie ?? ''} onChange={(e) => setHForm({ ...hForm, locatie: e.target.value })} style={inp}>{LOCATIES.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>
                <label style={lab}>Leverancier / klant<input value={hForm.klantNaam ?? ''} onChange={(e) => setHForm({ ...hForm, klantNaam: e.target.value })} style={inp} /></label>
                <label style={{ ...lab, gridColumn: '1 / -1' }}>Omschrijving<textarea value={hForm.omschrijving ?? ''} onChange={(e) => setHForm({ ...hForm, omschrijving: e.target.value })} rows={2} style={{ ...inp, resize: 'vertical' }} /></label>
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <button onClick={bewaarHerhaling} disabled={bezig || !hForm.titel.trim()} style={btnGroen}>{bezig ? 'Bezig…' : hForm.id ? 'Opslaan' : 'Inplannen'}</button>
                <button onClick={() => setHForm(null)} disabled={bezig} style={btnGrijs}>Annuleren</button>
              </div>
            </div>
          )}
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {herhalingen.length === 0 && !hForm && <span style={{ color: '#6b7280', fontSize: 13 }}>Nog geen terugkerende activiteiten.</span>}
            {herhalingen.map((h) => (
              <div key={h.id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '6px 10px', opacity: h.actief ? 1 : .55 }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontWeight: 600 }}>{h.titel}{h.categorie ? <span style={{ color: '#6b7280', fontWeight: 400 }}> · {catNaam(h.categorie)}</span> : ''}{!h.actief && <span style={{ color: '#b45309', fontWeight: 400 }}> · gepauzeerd</span>}</div>
                  <div style={{ fontSize: 12, color: '#6b7280' }}>{herhalingTekst(h)}{h.klantNaam ? ` · ${h.klantNaam}` : ''}</div>
                </div>
                <button onClick={() => setHForm({ ...h, categorie: h.categorie ?? '', locatie: h.locatie ?? '', tijd: h.tijd ?? '', omschrijving: h.omschrijving ?? '', klantNaam: h.klantNaam ?? '', einde: h.einde ?? '' })} disabled={bezig} style={btnMini}>Aanpassen</button>
                <button onClick={() => zetHerhalingActief(h, !h.actief)} disabled={bezig} style={btnMini}>{h.actief ? 'Pauzeren' : 'Hervatten'}</button>
                <button onClick={() => verwijderHerhaling(h)} disabled={bezig} style={{ ...btnMini, color: 'crimson' }}>Verwijderen</button>
              </div>
            ))}
          </div>
        </div>
      )}
      <p style={{ color: '#6b7280', fontSize: 14, margin: '6px 0 12px' }}>Bestellingen en agendapunten van de zaak. Een webshopbestelling verschijnt eerst op de dag van de bestelling (rood, "nieuw"); klik op <strong>Gelezen</strong> en ze verhuist naar de afhaal- of leverdag die de klant koos. Klik op een item om het aan te passen.</p>
      {fout && <p style={{ color: 'crimson' }}>{fout}</p>}
      {melding && <p style={{ color: '#166534', fontWeight: 600 }}>{melding}</p>}

      {form && (
        <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 14, marginBottom: 14, background: '#fafafa' }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>{form.id ? 'Agendapunt aanpassen' : 'Nieuw agendapunt'}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 8 }}>
            <label style={lab}>Datum<input type="date" value={form.dag} onChange={(e) => setForm({ ...form, dag: e.target.value })} style={inp} /></label>
            <label style={lab}>Uur<input type="time" value={form.tijd ?? ''} onChange={(e) => setForm({ ...form, tijd: e.target.value })} style={inp} /></label>
            <label style={lab}>Soort<select value={form.soort} onChange={(e) => setForm({ ...form, soort: e.target.value })} style={inp} disabled={!!form.id && items.find((i) => i.id === form.id)?.bron === 'WEBSHOP'}>{SOORTEN.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>
            <label style={lab}>Categorie<select value={form.categorie ?? ''} onChange={(e) => setForm({ ...form, categorie: e.target.value })} style={inp}><option value="">—</option>{CATEGORIEEN.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>
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
                  const nieuw = it.bron === 'WEBSHOP' && !it.gelezen && it.status === 'OPEN';
                  return (
                    <div key={it.id} onClick={() => setForm({ id: it.id, dag: it.dag, tijd: it.tijd ?? '', soort: it.soort, titel: it.titel, omschrijving: it.omschrijving ?? '', klantNaam: it.klantNaam ?? '', klantTelefoon: it.klantTelefoon ?? '', klantEmail: it.klantEmail ?? '', bedrag: it.bedrag, locatie: it.locatie ?? '', categorie: it.categorie ?? '', status: it.status })}
                      style={{ background: nieuw ? '#fef2f2' : '#fff', border: nieuw ? '1px solid #fca5a5' : '1px solid #e5e7eb', borderLeftWidth: 4, borderLeftColor: nieuw ? '#dc2626' : kleur, borderRadius: 8, padding: '6px 8px', cursor: 'pointer', opacity: klaar ? .55 : 1, textDecoration: it.status === 'GEANNULEERD' ? 'line-through' : 'none' }}>
                      <div style={{ fontSize: 11, color: nieuw ? '#dc2626' : kleur, fontWeight: 700, display: 'flex', gap: 6, justifyContent: 'space-between' }}>
                        <span>{nieuw ? 'NIEUW · ' : ''}{it.herhalingId ? '↻ ' : ''}{it.tijd ? it.tijd + ' · ' : ''}{naam}{it.categorie ? ' · ' + catNaam(it.categorie) : ''}{it.bron === 'WEBSHOP' ? ' · webshop' : ''}</span>
                        {it.status === 'KLAAR' && <span style={{ color: '#166534' }}>✔</span>}
                      </div>
                      {nieuw && it.afhaalDag && <div style={{ fontSize: 12, color: '#991b1b' }}>{it.soort === 'LEVERING' ? 'Leveren' : 'Afhalen'} op {datumNl(it.afhaalDag, { weekday: 'short', day: 'numeric', month: 'short' })}{it.afhaalTijd ? ' ' + it.afhaalTijd : ''}</div>}
                      <div style={{ fontWeight: 600, fontSize: 14, lineHeight: 1.25 }}>{it.titel}</div>
                      {(it.klantNaam || it.bedrag != null) && <div style={{ fontSize: 12, color: '#6b7280' }}>{it.klantNaam}{it.klantNaam && it.bedrag != null ? ' · ' : ''}{it.bedrag != null ? euro(it.bedrag) : ''}</div>}
                      {it.klantTelefoon && <div style={{ fontSize: 12, color: '#6b7280' }}>☎ {it.klantTelefoon}</div>}
                      {it.omschrijving && <div style={{ fontSize: 12, color: '#374151', marginTop: 2, whiteSpace: 'pre-wrap' }}>{it.omschrijving}</div>}
                      {it.status === 'OPEN' && (
                        <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }} onClick={(e) => e.stopPropagation()}>
                          {nieuw && <button onClick={() => gelezen(it)} disabled={bezig} style={{ ...btnMini, background: '#dc2626', color: '#fff', borderColor: '#dc2626', fontWeight: 700 }}>Gelezen{it.afhaalDag ? ' → ' + datumNl(it.afhaalDag) : ''}</button>}
                          {!nieuw && <button onClick={() => zetStatus(it, 'KLAAR')} disabled={bezig} style={{ ...btnMini, color: '#166534' }}>Klaar</button>}
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
        <select value={exportCat} onChange={(e) => setExportCat(e.target.value)} style={{ ...inp, width: 'auto' }}>
          <option value="">Alle categorieën (tabblad per categorie)</option>
          {CATEGORIEEN.map(([k, n]) => <option key={k} value={k}>Enkel {n.toLowerCase()}</option>)}
        </select>
        <button onClick={exporteer} disabled={bezig || !exportVan || !exportTot} style={btnGrijs}>⬇ Excel downloaden</button>
        <span style={{ fontSize: 12, color: '#6b7280' }}>Eén rij per agendapunt, met totaal per tabblad: brood, catering, boodschappen.</span>
      </div>
    </div>
  );
}

const inp: CSSProperties = { width: '100%', padding: 8, fontSize: 14, boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 6 };
const lab: CSSProperties = { fontSize: 12, color: '#6b7280', display: 'flex', flexDirection: 'column', gap: 2 };
const btnGroen: CSSProperties = { padding: '9px 16px', border: 'none', borderRadius: 8, background: '#16a34a', color: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 14 };
const btnGrijs: CSSProperties = { padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: 8, background: '#fff', cursor: 'pointer', fontSize: 14 };
const btnMini: CSSProperties = { padding: '3px 8px', border: '1px solid #cbd5e1', borderRadius: 5, background: '#fff', cursor: 'pointer', fontSize: 12 };
