import { useEffect, useState, type CSSProperties } from 'react';
import {
  getScradaStatus, getScradaVerbinding, zetScradaVanaf, scradaResetStatus,
  getScradaDagboekInstellingen, zetScradaDagboekInstellingen, getScradaDagboeken, getScradaCategorieen, getScradaBetaalmethoden,
  getScradaDagen, getScradaDagPreview, scradaVerstuurDag, scradaVerstuurDagen,
  type ScradaConfig, type ScradaVerbinding, type ScradaSyncVerslag,
  type ScradaDagboekInstellingen, type ScradaDagboek, type ScradaCategorie, type ScradaBetaalmethode, type ScradaDag, type ScradaDagPreview,
  getVerkoopfacturen, getFactuurOverzicht, getFactuurInstellingen, zetFactuurInstellingen, verstuurFactuurNaarScrada, verstuurFacturenNaarScrada,
  type Verkoopfactuur, type FactuurOverzicht, type FactuurInstellingen,
} from '../api/client';

const euro = (n: number | string) => '€ ' + Number(n).toFixed(2);
const datumNl = (s: string) => new Date(s.length === 10 ? s + 'T00:00:00' : s).toLocaleDateString('nl-BE');

// Onze BTW-tarieven en betaalwijzen die aan Scrada gekoppeld moeten worden.
const TARIEVEN = ['0', '6', '12', '21'];
const BETAALWIJZEN: [string, string][] = [
  ['CASH', 'Cash'], ['BANCONTACT', 'Bancontact'], ['KAART', 'Kaart'], ['OVERSCHRIJVING', 'Overschrijving'],
  ['QR', 'QR-code'], ['CADEAUBON', 'Cadeaubon'], ['ONLINE', 'Online (webshop)'],
  ['OP_REKENING', 'Op rekening (maandfactuur)'], ['ONBEKEND', 'Op rekening (oudere afsluitingen)'],
];

// Boekhouding — Scrada-dagontvangstenboek: elke afgesloten kassadag gaat als
// één dagboeking (per BTW-tarief + betaalmethoden) naar het dagontvangstenboek
// in Scrada. Automatisch elke dag om 23:59, vanaf de ingestelde startdatum.
export function Boekhouding() {
  const [modus, setModus] = useState<'live' | 'test'>('test');
  const [config, setConfig] = useState<ScradaConfig | null>(null);
  const [verbinding, setVerbinding] = useState<ScradaVerbinding | null>(null);
  const [sync, setSync] = useState<{ uur: string; laatste: ScradaSyncVerslag | null }>({ uur: '23:59', laatste: null });
  const [vanaf, setVanaf] = useState('');
  const [vanafOpgeslagen, setVanafOpgeslagen] = useState<string | null>(null);
  const [inst, setInst] = useState<ScradaDagboekInstellingen>({ journalID: null, journalNaam: null, vatMap: {}, pmMap: {}, betalingen: true });
  const [dagboeken, setDagboeken] = useState<ScradaDagboek[] | null>(null);
  const [cats, setCats] = useState<ScradaCategorie[]>([]);
  const [pms, setPms] = useState<ScradaBetaalmethode[]>([]);
  const [dagen, setDagen] = useState<ScradaDag[]>([]);
  const [preview, setPreview] = useState<ScradaDagPreview | null>(null);
  const [melding, setMelding] = useState('');
  const [bezig, setBezig] = useState(false);
  // Verkoopfacturen uit de kassa (per ticket / maandfactuur) -> Scrada concept.
  const [facturen, setFacturen] = useState<Verkoopfactuur[]>([]);
  const [facOverzicht, setFacOverzicht] = useState<FactuurOverzicht | null>(null);
  const [facInst, setFacInst] = useState<FactuurInstellingen>({ prefix: 'K', verkoopdagboek: 'KASSA', vervaldagen: 30 });
  const [toonAlleFacturen, setToonAlleFacturen] = useState(false);
  const [facVolgend, setFacVolgend] = useState(''); // eerstvolgend volgnummer (bv. 1 -> 20260001)

  async function laadFacturen() {
    const [f, o, i] = await Promise.all([getVerkoopfacturen(), getFactuurOverzicht(), getFactuurInstellingen()]);
    setFacturen(f); setFacOverzicht(o); setFacInst(i); setFacVolgend(i.volgend != null ? String(i.volgend) : '');
  }
  async function bewaarFacInst() {
    setBezig(true); setMelding('');
    try {
      const volgende = facVolgend.trim() ? Number(facVolgend) : undefined;
      const i = await zetFactuurInstellingen({ prefix: facInst.prefix, verkoopdagboek: facInst.verkoopdagboek, vervaldagen: facInst.vervaldagen, volgendeVolgnummer: volgende && volgende > 0 ? volgende : undefined });
      setFacInst(i); setFacVolgend(i.volgend != null ? String(i.volgend) : '');
      setMelding(`Factuurinstellingen opgeslagen. Volgende factuur: ${i.voorbeeld ?? ''}.`);
    }
    catch (e) { setMelding(e instanceof Error ? e.message : 'Opslaan mislukt'); }
    finally { setBezig(false); }
  }
  async function verstuurFactuur(f: Verkoopfactuur) {
    if (!window.confirm(`Factuur ${f.nummer} (${f.klantNaam}, ${euro(f.totaalIncl)}) als concept naar Scrada sturen?`)) return;
    setBezig(true); setMelding('');
    try {
      const r = await verstuurFactuurNaarScrada(f.id);
      setMelding(r.verstuurd
        ? `Factuur ${f.nummer} staat als concept in Scrada${r.ref ? ` (ref ${r.ref})` : ''}${r.correctie ? ` · dagboekcorrectie: ${r.correctie.status}${r.correctie.melding ? ` (${r.correctie.melding})` : ''}${r.correctie.fout ? ` (${r.correctie.fout})` : ''}` : ''}.`
        : r.modus === 'test' ? 'Niet gekoppeld (dry-run): niets verstuurd.' : `Niet verstuurd: ${r.fout ?? r.melding ?? 'fout'}`);
      await laadFacturen();
    } catch (e) { setMelding(e instanceof Error ? e.message : 'Versturen mislukt'); }
    finally { setBezig(false); }
  }
  async function verstuurAlleFacturen() {
    if (!window.confirm('Alle klaarstaande facturen (vanaf de startdatum) als concept naar Scrada sturen, plus de dagboekcorrecties?')) return;
    setBezig(true); setMelding('');
    try {
      const r = await verstuurFacturenNaarScrada();
      setMelding(r.geweigerd ? (r.melding ?? 'Geweigerd.') : `${r.aangemaakt} nieuwe ticketfactu(u)r(en) aangemaakt, ${r.verstuurd} verstuurd, ${r.correcties} correctie(s)${r.mislukt ? `, ${r.mislukt} mislukt: ${r.fout ?? 'fout'}` : ''}${r.modus === 'test' ? ' (dry-run)' : ''}.`);
      await laadFacturen();
    } catch (e) { setMelding(e instanceof Error ? e.message : 'Versturen mislukt'); }
    finally { setBezig(false); }
  }

  async function laad() {
    const s = await getScradaStatus();
    setModus(s.modus === 'live' ? 'live' : 'test');
    setConfig(s.geconfigureerd ?? null);
    setVanafOpgeslagen(s.vanaf ?? null);
    setVanaf(s.vanaf ?? '');
    setSync({ uur: s.autoSync ?? '23:59', laatste: s.laatsteSync ?? null });
    const i = await getScradaDagboekInstellingen();
    setInst(i);
    setDagen(await getScradaDagen());
    laadFacturen().catch(() => undefined);
    // Keuzelijsten van het gekozen dagboek meteen laden (enkel als Scrada gekoppeld is).
    if (i.journalID && s.modus === 'live') laadKoppelingslijsten(i.journalID).catch(() => undefined);
  }
  useEffect(() => { laad().catch((e) => setMelding(e instanceof Error ? e.message : 'Laden mislukt')); }, []);

  async function laadKoppelingslijsten(journalID: string) {
    const [c, p] = await Promise.all([getScradaCategorieen(journalID), getScradaBetaalmethoden(journalID)]);
    setCats(c); setPms(p);
  }
  async function laadDagboeken() {
    setBezig(true); setMelding('');
    try { setDagboeken(await getScradaDagboeken()); }
    catch (e) { setMelding(e instanceof Error ? e.message : 'Dagboeken ophalen mislukt'); }
    finally { setBezig(false); }
  }
  async function kiesDagboek(id: string) {
    const d = dagboeken?.find((x) => x.id === id);
    setInst({ ...inst, journalID: id || null, journalNaam: d?.naam ?? null });
    setCats([]); setPms([]);
    if (id) { try { await laadKoppelingslijsten(id); } catch (e) { setMelding(e instanceof Error ? e.message : 'Lijsten ophalen mislukt'); } }
  }
  async function bewaarKoppeling() {
    setBezig(true); setMelding('');
    try { setInst(await zetScradaDagboekInstellingen(inst)); setMelding('Koppeling opgeslagen.'); setDagen(await getScradaDagen()); }
    catch (e) { setMelding(e instanceof Error ? e.message : 'Opslaan mislukt'); }
    finally { setBezig(false); }
  }

  async function testVerbinding() {
    setBezig(true); setVerbinding(null);
    try { setVerbinding(await getScradaVerbinding()); }
    catch (e) { setMelding(e instanceof Error ? e.message : 'Test mislukt'); }
    finally { setBezig(false); }
  }
  async function bewaarVanaf() {
    if (!vanaf) { setMelding('Kies eerst een startdatum.'); return; }
    if (!window.confirm(`Enkel afgesloten dagen vanaf ${datumNl(vanaf)} naar Scrada sturen? Oudere dagen worden nooit verstuurd.`)) return;
    setBezig(true); setMelding('');
    try { await zetScradaVanaf(vanaf); setMelding('Startdatum opgeslagen.'); await laad(); }
    catch (e) { setMelding(e instanceof Error ? e.message : 'Opslaan mislukt'); }
    finally { setBezig(false); }
  }
  async function resetStatus() {
    if (!window.confirm('Verzendstatus van alle dagen vanaf de startdatum terug op "niet verstuurd" zetten?\n\nDoe dit enkel na het testen in de testomgeving, vóór je naar de echte Scrada overschakelt.')) return;
    setBezig(true); setMelding('');
    try { const r = await scradaResetStatus(); setMelding(`${r.dagen} dagen terug op "niet verstuurd".`); await laad(); }
    catch (e) { setMelding(e instanceof Error ? e.message : 'Reset mislukt'); }
    finally { setBezig(false); }
  }
  async function toon(id: string) {
    setMelding('');
    try { setPreview(await getScradaDagPreview(id)); }
    catch (e) { setMelding(e instanceof Error ? e.message : 'Voorbeeld mislukt'); }
  }
  async function verstuurDag(d: ScradaDag) {
    if (!window.confirm(`Dagafsluiting ${d.volgnummer ? '#' + d.volgnummer + ' ' : ''}van ${datumNl(d.datum)} (${euro(d.totaal)}) naar het dagontvangstenboek in Scrada sturen?`)) return;
    setBezig(true); setMelding('');
    try {
      const r = await scradaVerstuurDag(d.id);
      setMelding(r.verstuurd
        ? `Verstuurd naar Scrada${r.ref ? ` (ref ${r.ref})` : ''}${r.aangevuld ? ` · ${r.aangevuld} tussenliggende dag(en) zonder ontvangsten als nul-dag aangevuld` : ''}.`
        : r.modus === 'test' ? 'Niet gekoppeld (dry-run): niets verstuurd.' : `Niet verstuurd: ${r.fout ?? r.melding ?? 'fout'}`);
      setDagen(await getScradaDagen());
    } catch (e) { setMelding(e instanceof Error ? e.message : 'Versturen mislukt'); }
    finally { setBezig(false); }
  }
  async function verstuurAlles() {
    const open = dagen.filter((d) => d.inAanmerking && d.scradaStatus !== 'VERSTUURD');
    if (!window.confirm(`Alle ${open.length} openstaande dagen vanaf de startdatum naar Scrada sturen?`)) return;
    setBezig(true); setMelding('');
    try {
      const r = await scradaVerstuurDagen();
      setMelding(r.geweigerd ? (r.melding ?? 'Geweigerd.') : `${r.gevonden} gevonden, ${r.verstuurd} verstuurd${r.mislukt ? `, gestopt bij fout: ${r.fout ?? 'fout'}` : ''}${r.modus === 'test' ? ' (dry-run, niet gekoppeld)' : ''}.`);
      setDagen(await getScradaDagen());
    } catch (e) { setMelding(e instanceof Error ? e.message : 'Versturen mislukt'); }
    finally { setBezig(false); }
  }

  const openDagen = dagen.filter((d) => d.inAanmerking && d.scradaStatus !== 'VERSTUURD');
  const koppelingKlaar = !!inst.journalID;
  const catNaam = (id: string) => cats.find((c) => c.id === id)?.naam ?? id;
  const pmNaam = (id: string) => pms.find((p) => p.id === id)?.naam ?? id;

  return (
    <div style={{ maxWidth: 1000, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 460px' }}>
        <h2>Boekhouding — Scrada dagontvangsten</h2>

        {/* Status + verbinding */}
        <div style={{ marginBottom: 12 }}>
          <span style={{ padding: '3px 10px', borderRadius: 99, fontSize: 13, fontWeight: 600, background: modus === 'live' ? '#dcfce7' : '#fef3c7', color: modus === 'live' ? '#166534' : '#92400e' }}>
            {modus === 'live' ? `● Gekoppeld${config?.test ? ' met de Scrada-TESTomgeving' : ' (Scrada live)'}` : '● Nog niet gekoppeld (dry-run)'}
          </span>
          {config && modus !== 'live' && (
            <div style={{ marginTop: 8, fontSize: 13, color: '#92400e' }}>
              Ontbreekt op de server: {[!config.sleutel && 'SCRADA_API_KEY', !config.wachtwoord && 'SCRADA_API_PASSWORD', !config.bedrijf && 'SCRADA_COMPANY_ID'].filter(Boolean).join(', ') || '—'} · server: {config.basis}
            </div>
          )}
          <div style={{ marginTop: 8 }}>
            <button onClick={testVerbinding} disabled={bezig} style={btn}>Verbinding testen</button>
            {verbinding && (
              <span style={{ marginLeft: 10, fontSize: 13, fontWeight: 600, color: verbinding.ok ? '#166534' : 'crimson' }}>
                {verbinding.ok ? `✔ Verbinding OK${verbinding.bedrijf ? ` — ${verbinding.bedrijf}` : ''}` : `✖ ${verbinding.melding ?? 'Verbinding mislukt'}`}
              </span>
            )}
          </div>
        </div>

        {/* Automatische synchronisatie */}
        <div style={{ ...kader, background: '#f8fafc', fontSize: 13 }}>
          <div style={{ fontWeight: 700 }}>⏰ Herinnering: elke dag om {sync.uur} op je telefoon</div>
          <div style={{ color: '#6b7280', marginTop: 4 }}>
            Er vertrekt <strong>nooit</strong> iets automatisch: je bevestigt het versturen zelf (op de telefoon na de dagafsluiting, of hier).
            Staat er om {sync.uur} nog een afgesloten dag niet in Scrada, dan krijg je een melding met een link om ze te versturen.
            {sync.laatste
              ? <> Laatste controle: <strong>{new Date(sync.laatste.moment).toLocaleString('nl-BE', { dateStyle: 'short', timeStyle: 'short' })}</strong>
                  {sync.laatste.geweigerd
                    ? <span style={{ color: '#b45309' }}> — {sync.laatste.melding}</span>
                    : (sync.laatste.dagen ?? 0) > 0
                      ? <> — melding gestuurd voor {sync.laatste.dagen} dag(en){sync.laatste.push ? ` naar ${sync.laatste.push.verstuurd} toestel(len)` : ''}</>
                      : <> — {sync.laatste.melding ?? 'alles staat in Scrada'}</>}
                </>
              : ' Nog geen controle uitgevoerd.'}
          </div>
        </div>

        {/* Startdatum */}
        <div style={{ ...kader, background: vanafOpgeslagen ? '#fff' : '#fef3c7' }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Verstuur enkel dagen vanaf</div>
          <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 8 }}>
            Dagen van vóór deze datum zitten al in de boekhouding en worden <strong>nooit</strong> naar Scrada gestuurd.
            {vanafOpgeslagen ? <> Ingesteld: <strong>{datumNl(vanafOpgeslagen)}</strong>.</> : <> <strong>Nog niet ingesteld</strong> — versturen is uitgeschakeld.</>}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input type="date" value={vanaf} onChange={(e) => setVanaf(e.target.value)} style={inp} />
            <button onClick={bewaarVanaf} disabled={bezig || !vanaf || vanaf === vanafOpgeslagen} style={btn}>Startdatum opslaan</button>
            {vanafOpgeslagen && <button onClick={resetStatus} disabled={bezig} title="Na testen in de testomgeving, vóór live" style={btn}>Verzendstatus resetten (vanaf startdatum)</button>}
          </div>
        </div>

        {/* Koppeling: dagboek + BTW-categorieën + betaalmethoden */}
        <div style={{ ...kader, background: koppelingKlaar ? '#fff' : '#fef3c7' }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Koppeling met het dagontvangstenboek</div>
          <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 8 }}>
            Kies het dagboek in Scrada en koppel onze BTW-tarieven en betaalwijzen aan de categorieën/betaalmethoden van dat dagboek. Eenmalig instellen.
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
            <button onClick={laadDagboeken} disabled={bezig || modus !== 'live'} style={btn}>Dagboeken ophalen uit Scrada</button>
            {dagboeken ? (
              <select value={inst.journalID ?? ''} onChange={(e) => kiesDagboek(e.target.value)} style={inp}>
                <option value="">— kies het dagontvangstenboek —</option>
                {dagboeken.map((d) => <option key={d.id} value={d.id}>{d.naam}{d.actief ? '' : ' (niet actief)'}{d.laatsteDatum ? ` · laatste inschrijving ${datumNl(d.laatsteDatum)}` : ''}</option>)}
              </select>
            ) : (
              <span style={{ fontSize: 13 }}>{inst.journalNaam ? <>Gekozen dagboek: <strong>{inst.journalNaam}</strong></> : <span style={{ color: '#92400e' }}>Nog geen dagboek gekozen.</span>}</span>
            )}
          </div>

          {inst.journalID && (cats.length > 0 || pms.length > 0) && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>BTW-tarief → Scrada-categorie</div>
                {TARIEVEN.map((t) => (
                  <div key={t} style={rij}>
                    <span style={{ width: 52 }}>{t} %</span>
                    <select value={inst.vatMap[t] ?? ''} onChange={(e) => setInst({ ...inst, vatMap: { ...inst.vatMap, [t]: e.target.value } })} style={{ ...inp, flex: 1 }}>
                      <option value="">— niet gekoppeld —</option>
                      {cats.map((c) => <option key={c.id} value={c.id}>{c.naam || '(zonder naam)'}{c.pct != null ? ` · ${c.pct} %` : ''}</option>)}
                    </select>
                  </div>
                ))}
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>Koppel minstens 6 % en 21 %; 0 % is voor cadeaubonnen.</div>
              </div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Betaalwijze → Scrada-betaalmethode</div>
                <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, marginBottom: 6 }}>
                  <input type="checkbox" checked={inst.betalingen} onChange={(e) => setInst({ ...inst, betalingen: e.target.checked })} />
                  Betaalmethoden meesturen (uit als het dagboek geen kasboek heeft)
                </label>
                {inst.betalingen && BETAALWIJZEN.map(([k, naam]) => (
                  <div key={k} style={rij}>
                    <span style={{ width: 150, fontSize: 13 }}>{naam}</span>
                    <select value={inst.pmMap[k] ?? ''} onChange={(e) => setInst({ ...inst, pmMap: { ...inst.pmMap, [k]: e.target.value } })} style={{ ...inp, flex: 1 }}>
                      <option value="">— niet gekoppeld —</option>
                      {pms.map((p) => <option key={p.id} value={p.id}>{p.naam}{p.cash ? ' (cash)' : ''}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>
          )}
          {inst.journalID && !cats.length && !pms.length && modus === 'live' && (
            <div style={{ fontSize: 13, color: '#6b7280' }}>Categorieën/betaalmethoden van dit dagboek laden… (of klik "Dagboeken ophalen").</div>
          )}
          <div style={{ marginTop: 10 }}>
            <button onClick={bewaarKoppeling} disabled={bezig} style={btnBlauw}>Koppeling opslaan</button>
            {inst.journalID && Object.keys(inst.vatMap).length > 0 && !cats.length && (
              <span style={{ marginLeft: 10, fontSize: 12, color: '#6b7280' }}>
                Bewaard: {Object.entries(inst.vatMap).filter(([, v]) => v).map(([t, v]) => `${t}%→${catNaam(v)}`).join(', ')}
              </span>
            )}
          </div>
        </div>

        {/* Verkoopfacturen: per ticket of maandfactuur per bedrijf -> concept in Scrada (verzending via Peppol daar) */}
        <div style={kader}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
            <div style={{ fontWeight: 700 }}>🧾 Verkoopfacturen</div>
            {facOverzicht && (
              <span style={{ fontSize: 13, color: '#6b7280' }}>
                {facOverzicht.teVersturen} nog naar Scrada · {facOverzicht.ticketsZonderFactuur} ticket(s) wachten op een factuur
              </span>
            )}
          </div>
          <div style={{ fontSize: 13, color: '#6b7280', margin: '4px 0 8px' }}>
            Facturen worden in de kassa gemaakt (knop "Factuur" bij het afrekenen, of "Factureren" per bedrijf op Klant factuur) en gaan bij je bevestiging als <strong>concept</strong> naar het verkoopdagboek in Scrada, samen met de correctie in het dagontvangstenboek. Nazicht en verzending via Peppol doe je in Scrada.
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
            <label style={{ fontSize: 13 }}>Verkoopdagboek in Scrada <input value={facInst.verkoopdagboek} onChange={(e) => setFacInst({ ...facInst, verkoopdagboek: e.target.value })} style={{ ...inp, width: 110 }} /></label>
            <label style={{ fontSize: 13 }} title="Leeg = enkel jaar + volgnummer, bv. 20260001">Prefix <input value={facInst.prefix} onChange={(e) => setFacInst({ ...facInst, prefix: e.target.value })} placeholder="(leeg)" style={{ ...inp, width: 60 }} /></label>
            <label style={{ fontSize: 13 }} title="Het eerstvolgende volgnummer van dit jaar (1 = …0001)">Volgend nr. <input type="number" min={1} value={facVolgend} onChange={(e) => setFacVolgend(e.target.value)} style={{ ...inp, width: 70 }} /></label>
            <label style={{ fontSize: 13 }}>Vervaldagen <input type="number" value={facInst.vervaldagen} onChange={(e) => setFacInst({ ...facInst, vervaldagen: Number(e.target.value) })} style={{ ...inp, width: 70 }} /></label>
            <button onClick={bewaarFacInst} disabled={bezig} style={btn}>Opslaan</button>
            <button onClick={verstuurAlleFacturen} disabled={bezig || !facOverzicht || (facOverzicht.teVersturen + facOverzicht.ticketsZonderFactuur) === 0 || !vanafOpgeslagen} style={btn}>
              Klaarstaande facturen naar Scrada
            </button>
          </div>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>Zet in Scrada op dat verkoopdagboek <em>ApiInvoiceStatus = concept</em>, zodat de facturen ter nazicht klaarstaan. Nummering: jaar + volgnummer, doorlopend per jaar — volgende factuur: <strong>{facInst.voorbeeld ?? `${facInst.prefix}${new Date().getFullYear()}0001`}</strong>.</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 620 }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd', fontSize: 12, color: '#666' }}>
                  <th style={{ padding: 4 }}>Nummer</th><th style={{ padding: 4 }}>Datum</th><th style={{ padding: 4 }}>Klant</th><th style={{ padding: 4 }}>Soort</th><th style={{ padding: 4, textAlign: 'right' }}>Incl. BTW</th><th style={{ padding: 4 }}>Betaling</th><th style={{ padding: 4 }}>Scrada</th><th />
                </tr>
              </thead>
              <tbody>
                {(toonAlleFacturen ? facturen : facturen.slice(0, 12)).map((f) => (
                  <tr key={f.id} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ padding: 4, whiteSpace: 'nowrap', fontWeight: 600 }}>{f.nummer}</td>
                    <td style={{ padding: 4, whiteSpace: 'nowrap' }}>{datumNl(f.datum)}</td>
                    <td style={{ padding: 4 }}>{f.klantNaam}{f.klantBtw ? <span style={{ color: '#6b7280' }}> · {f.klantBtw}</span> : ''}</td>
                    <td style={{ padding: 4, whiteSpace: 'nowrap' }}>{f.bron === 'MAANDFACTUUR' ? `Maand ${f.periode ?? ''} (${f.aantalTickets} tickets)` : 'Ticket'}</td>
                    <td style={{ padding: 4, textAlign: 'right', whiteSpace: 'nowrap' }}>{euro(f.totaalIncl)}</td>
                    <td style={{ padding: 4, whiteSpace: 'nowrap', color: '#6b7280' }}>{f.betaalstatus === 'BETAALD' ? `aan de kassa (${f.betaalwijze ?? ''})` : 'nog te betalen'}</td>
                    <td style={{ padding: 4, whiteSpace: 'nowrap' }}>
                      {f.scradaStatus === 'VERSTUURD'
                        ? <span style={{ color: '#166534' }}>✔ concept in Scrada{f.correctieStatus === 'VERSTUURD' ? '' : f.correctieStatus === 'WACHT_OP_DAG' ? ' · correctie wacht op dag' : f.correctieStatus === 'FOUT' ? ' · correctie: fout' : ' · correctie volgt'}</span>
                        : f.scradaStatus === 'FOUT' ? <span style={{ color: 'crimson' }} title={f.scradaFout ?? ''}>✖ fout</span>
                        : <span style={{ color: '#b45309' }}>klaar om te versturen</span>}
                    </td>
                    <td style={{ padding: 4, whiteSpace: 'nowrap', textAlign: 'right' }}>
                      {f.scradaStatus !== 'VERSTUURD' && <button onClick={() => verstuurFactuur(f)} disabled={bezig || !vanafOpgeslagen} style={btn}>Verstuur</button>}
                      {f.scradaFout && <div style={{ fontSize: 11, color: 'crimson', maxWidth: 260, whiteSpace: 'normal' }}>{f.scradaFout}</div>}
                      {f.correctieFout && f.correctieStatus === 'FOUT' && <div style={{ fontSize: 11, color: 'crimson', maxWidth: 260, whiteSpace: 'normal' }}>{f.correctieFout}</div>}
                    </td>
                  </tr>
                ))}
                {facturen.length === 0 && <tr><td colSpan={8} style={{ padding: 12, color: '#999' }}>Nog geen verkoopfacturen.</td></tr>}
              </tbody>
            </table>
          </div>
          {facturen.length > 12 && (
            <button onClick={() => setToonAlleFacturen(!toonAlleFacturen)} style={{ ...btn, marginTop: 6 }}>{toonAlleFacturen ? 'Minder tonen' : `Alle ${facturen.length} tonen`}</button>
          )}
        </div>

        {/* Dagen */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
          <button onClick={verstuurAlles} disabled={bezig || !openDagen.length || !vanafOpgeslagen || !koppelingKlaar}
            title={!vanafOpgeslagen ? 'Stel eerst de startdatum in' : !koppelingKlaar ? 'Kies eerst het dagboek' : undefined}
            style={{ ...btnBlauw, background: openDagen.length && vanafOpgeslagen && koppelingKlaar ? '#2563eb' : '#9ca3af' }}>
            {bezig ? 'Bezig…' : `Alle openstaande dagen versturen (${openDagen.length})`}
          </button>
        </div>
        {melding && <p style={{ color: '#374151', background: '#f3f4f6', padding: '8px 12px', borderRadius: 8 }}>{melding}</p>}

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8, fontSize: 14, minWidth: 560 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid #ddd', fontSize: 12, color: '#666' }}>
                <th style={{ padding: 4 }}>Dag</th><th style={{ padding: 4 }}>#</th><th style={{ padding: 4, textAlign: 'right' }}>Ontvangsten</th><th style={{ padding: 4 }}>Scrada</th><th />
              </tr>
            </thead>
            <tbody>
              {dagen.map((d) => (
                <tr key={d.id} style={{ borderBottom: '1px solid #f0f0f0', opacity: d.inAanmerking ? 1 : 0.55 }}>
                  <td style={{ padding: 4, whiteSpace: 'nowrap' }}>{datumNl(d.datum)}</td>
                  <td style={{ padding: 4 }}>{d.volgnummer ?? '—'}</td>
                  <td style={{ padding: 4, textAlign: 'right' }}>{euro(d.totaal)}</td>
                  <td style={{ padding: 4, whiteSpace: 'nowrap' }}>
                    {!d.inAanmerking ? <span style={{ color: '#9ca3af' }}>vóór startdatum</span>
                      : d.scradaStatus === 'VERSTUURD' ? <span style={{ color: '#166534' }}>✔ verstuurd{d.scradaVerstuurdOp ? ` ${new Date(d.scradaVerstuurdOp).toLocaleDateString('nl-BE')}` : ''}</span>
                      : d.scradaStatus === 'FOUT' ? <span style={{ color: 'crimson' }} title={d.scradaFout ?? ''}>✖ fout</span>
                      : <span style={{ color: '#b45309' }}>open</span>}
                  </td>
                  <td style={{ padding: 4, whiteSpace: 'nowrap', textAlign: 'right' }}>
                    <button onClick={() => toon(d.id)} style={btn}>Bekijk</button>{' '}
                    {d.inAanmerking && d.scradaStatus !== 'VERSTUURD' && <button onClick={() => verstuurDag(d)} disabled={bezig || !koppelingKlaar} style={btn}>Verstuur</button>}
                  </td>
                </tr>
              ))}
              {dagen.length === 0 && <tr><td colSpan={5} style={{ padding: 16, color: '#999' }}>Nog geen dagafsluitingen.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {preview && (
        <div style={{ flex: '1 1 320px' }}>
          <div style={{ border: '1px solid #ddd', borderRadius: 10, padding: 16 }}>
            <h3 style={{ marginTop: 0 }}>Dagboeking {preview.volgnummer ? `#${preview.volgnummer}` : ''} — {datumNl(preview.datum)}</h3>
            {preview.ontbreekt.length > 0 && (
              <div style={{ background: '#fef3c7', color: '#92400e', padding: '6px 10px', borderRadius: 6, fontSize: 13, marginBottom: 8 }}>
                Koppeling onvolledig: {preview.ontbreekt.join(', ')}
              </div>
            )}
            <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
              <tbody>
                {preview.boeking.lines.map((l, i) => (
                  <tr key={i}><td>BTW {l.vatPerc} % · {catNaam(l.categoryID) || 'categorie?'}</td><td style={{ textAlign: 'right' }}>{euro(l.amount)}</td></tr>
                ))}
                <tr style={{ fontWeight: 700, borderTop: '1px solid #ddd' }}><td>Totaal incl. BTW</td><td style={{ textAlign: 'right' }}>{euro(preview.totaal)}</td></tr>
                {(preview.boeking.paymentMethods ?? []).map((p, i) => (
                  <tr key={'p' + i} style={{ color: '#555' }}><td>Betaald · {pmNaam(p.paymentMethodID)}</td><td style={{ textAlign: 'right' }}>{euro(p.amount)}</td></tr>
                ))}
              </tbody>
            </table>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 8 }}>
              Status: {preview.status}{preview.ref ? ` · ref ${preview.ref}` : ''}{preview.fout ? ` · fout: ${preview.fout}` : ''}
            </div>
            <details style={{ marginTop: 8 }}>
              <summary style={{ cursor: 'pointer', fontSize: 12 }}>Ruwe gegevens (JSON)</summary>
              <pre style={{ fontSize: 11, overflow: 'auto', maxHeight: 220 }}>{JSON.stringify(preview.boeking, null, 2)}</pre>
            </details>
            <button onClick={() => setPreview(null)} style={{ ...btn, marginTop: 8 }}>Sluiten</button>
          </div>
        </div>
      )}
    </div>
  );
}

const btn: CSSProperties = { padding: '6px 12px', border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 13 };
const btnBlauw: CSSProperties = { padding: '10px 16px', border: 'none', borderRadius: 8, background: '#2563eb', color: '#fff', fontWeight: 700, cursor: 'pointer' };
const inp: CSSProperties = { padding: 8, fontSize: 14, border: '1px solid #cbd5e1', borderRadius: 6 };
const kader: CSSProperties = { border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, marginBottom: 12 };
const rij: CSSProperties = { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 };
