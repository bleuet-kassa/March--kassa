import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  getPersoneelsDossier, zetPersoneelsDossier, getPersoneelGevoelig, getOndernemingen,
  type PersoneelsDossier, type ProfielInput, type Onderneming,
} from '../api/client';

// Individuele pagina per medewerker (personeelsdossier). Voorlopig enkel voor de
// beheerder: persoonsgegevens, contract, uurregime en plafonds, verlof, notities en
// de omzet van deze medewerker. Toegangen en tankkaart blijven op de Personeel-lijst.
const STATUTEN: [string, string][] = [['', '—'], ['VAST', 'Vast'], ['FLEXI', 'Flexi'], ['STUDENT', 'Student'], ['ZELFSTANDIG', 'Zelfstandig']];
const AFDELINGEN: [string, string][] = [['WINKEL', 'Winkel'], ['RESTAURANT', 'Restaurant'], ['CATERING', 'Catering']];
const euro = (n: number) => '€ ' + n.toFixed(2);
const datumNl = (s: string | null) => (s ? new Date(s.length === 10 ? s + 'T12:00:00' : s).toLocaleDateString('nl-BE') : '—');

type Form = Record<string, string | string[]>;

function naarForm(d: PersoneelsDossier): Form {
  const p = d.profiel;
  const s = (v: unknown) => (v == null ? '' : String(v));
  return {
    voornaam: s(p.voornaam), achternaam: s(p.achternaam), telefoon: s(p.telefoon), privEmail: s(p.privEmail), adres: s(p.adres),
    geboortedatum: s(p.geboortedatum), noodcontactNaam: s(p.noodcontactNaam), noodcontactTelefoon: s(p.noodcontactTelefoon),
    statuut: s(p.statuut), ondernemingId: s(p.ondernemingId), functie: s(p.functie), afdelingen: p.afdelingen, verantwoordelijkVoor: p.verantwoordelijkVoor,
    inDienst: s(p.inDienst), uitDienst: s(p.uitDienst),
    urenPerWeek: s(p.urenPerWeek), urenPerDag: s(p.urenPerDag), maxUrenDag: s(p.maxUrenDag ?? 11), maxUrenWeek: s(p.maxUrenWeek ?? 50), maxUrenMaand: s(p.maxUrenMaand), jaarContingent: s(p.jaarContingent),
    verlofdagenJaar: s(p.verlofdagenJaar), verlofdagenSaldo: s(p.verlofdagenSaldo), recupUrenSaldo: s(p.recupUrenSaldo),
    maatBovenstuk: s(p.maatBovenstuk), maatBroek: s(p.maatBroek), maatJas: s(p.maatJas), maatSchort: s(p.maatSchort), maatSchoenen: s(p.maatSchoenen), kledijOpmerking: s(p.kledijOpmerking),
    notities: s(p.notities), rijksregister: '', iban: '',
  };
}
const MATEN = ['', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL'];

export function PersoneelDossier() {
  const { id = '' } = useParams();
  const [d, setD] = useState<PersoneelsDossier | null>(null);
  const [form, setForm] = useState<Form>({});
  const [ondernemingen, setOndernemingen] = useState<Onderneming[]>([]);
  const [gevoelig, setGevoelig] = useState<{ rijksregister: string | null; iban: string | null } | null>(null);
  const [fout, setFout] = useState('');
  const [melding, setMelding] = useState('');
  const [bezig, setBezig] = useState(false);
  const [gewijzigd, setGewijzigd] = useState(false);

  async function laad() {
    setFout('');
    try { const r = await getPersoneelsDossier(id); setD(r); setForm(naarForm(r)); setGewijzigd(false); setGevoelig(null); }
    catch (e) { setFout(e instanceof Error ? e.message : 'Laden mislukt'); }
  }
  useEffect(() => { laad(); getOndernemingen().then(setOndernemingen).catch(() => {}); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [id]);

  const zet = (k: string, v: string | string[]) => { setForm((f) => ({ ...f, [k]: v })); setGewijzigd(true); setMelding(''); };
  const wissel = (k: 'afdelingen' | 'verantwoordelijkVoor', a: string) => {
    const huidig = (form[k] as string[]) ?? [];
    zet(k, huidig.includes(a) ? huidig.filter((x) => x !== a) : [...huidig, a]);
  };

  async function bewaar() {
    if (!d) return;
    setBezig(true); setFout(''); setMelding('');
    try {
      const num = (k: string) => { const v = String(form[k] ?? '').trim(); return v === '' ? null : Number(v.replace(',', '.')); };
      const txt = (k: string) => String(form[k] ?? '').trim() || null;
      const input: ProfielInput = {
        voornaam: txt('voornaam'), achternaam: txt('achternaam'), telefoon: txt('telefoon'), privEmail: txt('privEmail'), adres: txt('adres'),
        geboortedatum: txt('geboortedatum'), noodcontactNaam: txt('noodcontactNaam'), noodcontactTelefoon: txt('noodcontactTelefoon'),
        statuut: txt('statuut'), ondernemingId: txt('ondernemingId'), functie: txt('functie'),
        afdelingen: form.afdelingen as string[], verantwoordelijkVoor: form.verantwoordelijkVoor as string[],
        inDienst: txt('inDienst'), uitDienst: txt('uitDienst'),
        urenPerWeek: num('urenPerWeek'), urenPerDag: num('urenPerDag'), maxUrenDag: num('maxUrenDag'), maxUrenWeek: num('maxUrenWeek'), maxUrenMaand: num('maxUrenMaand'), jaarContingent: num('jaarContingent'),
        verlofdagenJaar: num('verlofdagenJaar'), verlofdagenSaldo: num('verlofdagenSaldo'), recupUrenSaldo: num('recupUrenSaldo'),
        maatBovenstuk: txt('maatBovenstuk'), maatBroek: txt('maatBroek'), maatJas: txt('maatJas'), maatSchort: txt('maatSchort'), maatSchoenen: txt('maatSchoenen'), kledijOpmerking: txt('kledijOpmerking'),
        notities: txt('notities'),
        // Gevoelig: enkel meesturen als er iets nieuws ingevuld is.
        ...(String(form.rijksregister ?? '').trim() ? { rijksregister: String(form.rijksregister) } : {}),
        ...(String(form.iban ?? '').trim() ? { iban: String(form.iban) } : {}),
      };
      const r = await zetPersoneelsDossier(id, input);
      setD(r); setForm(naarForm(r)); setGewijzigd(false); setGevoelig(null);
      setMelding('Dossier bewaard.');
    } catch (e) { setFout(e instanceof Error ? e.message : 'Bewaren mislukt'); }
    finally { setBezig(false); }
  }
  async function wisGevoelig(veld: 'rijksregister' | 'iban') {
    if (!window.confirm(`${veld === 'iban' ? 'Het IBAN-nummer' : 'Het rijksregisternummer'} wissen?`)) return;
    setBezig(true); setFout('');
    try { const r = await zetPersoneelsDossier(id, { [veld]: null }); setD(r); setGevoelig(null); setMelding('Gewist.'); }
    catch (e) { setFout(e instanceof Error ? e.message : 'Wissen mislukt'); }
    finally { setBezig(false); }
  }
  async function toonGevoelig() {
    try { setGevoelig(await getPersoneelGevoelig(id)); } catch (e) { setFout(e instanceof Error ? e.message : 'Ophalen mislukt'); }
  }

  if (!d) return <div style={{ padding: 16 }}>{fout || 'Laden…'} <Link to="/kassa/personeel">← terug naar Personeel</Link></div>;
  const a = d.account;
  const p = d.profiel;
  const volledigeNaam = [form.voornaam, form.achternaam].filter(Boolean).join(' ') || a.naam;
  const veld = (k: string, label: string, props: Record<string, unknown> = {}) => (
    <label style={lab}>{label}<input value={String(form[k] ?? '')} onChange={(e) => zet(k, e.target.value)} style={inp} {...props} /></label>
  );
  const getal = (k: string, label: string, eenheid: string, hint?: string) => (
    <label style={lab} title={hint}>{label}
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input value={String(form[k] ?? '')} onChange={(e) => zet(k, e.target.value)} inputMode="decimal" style={{ ...inp, width: 110 }} />
        <span style={{ fontSize: 13, color: '#6b7280' }}>{eenheid}</span>
      </span>
    </label>
  );
  const vinkjes = (k: 'afdelingen' | 'verantwoordelijkVoor') => (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {AFDELINGEN.map(([key, naam]) => {
        const aan = ((form[k] as string[]) ?? []).includes(key);
        return <button key={key} type="button" onClick={() => wissel(k, key)} style={{ ...chip, background: aan ? '#0d4589' : '#fff', color: aan ? '#fff' : '#111827', borderColor: aan ? '#0d4589' : '#cbd5e1' }}>{aan ? '✓ ' : ''}{naam}</button>;
      })}
    </div>
  );

  return (
    <div style={{ maxWidth: 980 }}>
      <Link to="/kassa/personeel" style={{ fontSize: 14 }}>← Personeel</Link>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', margin: '8px 0 4px' }}>
        <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#0d4589', color: '#fff', display: 'grid', placeItems: 'center', fontSize: 22, fontWeight: 700 }}>
          {volledigeNaam.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
        </div>
        <div style={{ flex: 1, minWidth: 200 }}>
          <h2 style={{ margin: 0 }}>{volledigeNaam}</h2>
          <div style={{ color: '#6b7280', fontSize: 14 }}>
            {a.email} · {a.rol} · {a.actief ? <span style={{ color: '#166534' }}>actief</span> : <span>uit dienst</span>}
            {p.statuut ? ` · ${STATUTEN.find(([k]) => k === p.statuut)?.[1]}` : ''}{p.functie ? ` · ${p.functie}` : ''}
          </div>
        </div>
        <button onClick={bewaar} disabled={bezig || !gewijzigd} style={{ ...btnGroen, opacity: gewijzigd ? 1 : .5 }}>{bezig ? 'Bezig…' : gewijzigd ? 'Wijzigingen bewaren' : 'Bewaard'}</button>
      </div>
      <p style={{ color: '#6b7280', fontSize: 13, margin: '0 0 10px' }}>Dit dossier is voorlopig enkel zichtbaar voor de beheerders. Toegangen en tankkaart pas je aan op de lijst <Link to="/kassa/personeel">Personeel</Link>.</p>
      {fout && <p style={{ color: 'crimson', fontWeight: 600 }}>{fout}</p>}
      {melding && <p style={{ color: '#166534', fontWeight: 600 }}>{melding}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14 }}>
        <Kader titel="Persoonsgegevens">
          <div style={raster}>
            {veld('voornaam', 'Voornaam')}
            {veld('achternaam', 'Achternaam')}
            {veld('telefoon', 'Telefoon', { inputMode: 'tel' })}
            {veld('privEmail', 'Privé e-mail', { inputMode: 'email' })}
            <label style={{ ...lab, gridColumn: '1 / -1' }}>Adres<input value={String(form.adres ?? '')} onChange={(e) => zet('adres', e.target.value)} style={inp} /></label>
            {veld('geboortedatum', 'Geboortedatum', { type: 'date' })}
          </div>
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #e5e7eb' }}>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>🔒 Versleuteld bewaard</div>
            <div style={raster}>
              <label style={lab}>Rijksregisternummer
                <input value={String(form.rijksregister ?? '')} onChange={(e) => zet('rijksregister', e.target.value)} placeholder={p.rijksregisterMasker ? `${p.rijksregisterMasker} (nieuw invullen = vervangen)` : 'jj.mm.dd-xxx.cc'} style={inp} autoComplete="off" />
              </label>
              <label style={lab}>IBAN (loon)
                <input value={String(form.iban ?? '')} onChange={(e) => zet('iban', e.target.value)} placeholder={p.ibanMasker ? `${p.ibanMasker} (nieuw invullen = vervangen)` : 'BE.. .... .... ....'} style={inp} autoComplete="off" />
              </label>
            </div>
            {(p.rijksregisterMasker || p.ibanMasker) && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 6, fontSize: 13 }}>
                {gevoelig
                  ? <><span>RRN: <strong style={{ fontFamily: 'monospace' }}>{gevoelig.rijksregister ?? '—'}</strong></span><span>IBAN: <strong style={{ fontFamily: 'monospace' }}>{gevoelig.iban ?? '—'}</strong></span><button onClick={() => setGevoelig(null)} style={btnMini}>Verbergen</button></>
                  : <button onClick={toonGevoelig} style={btnMini}>Volledig tonen</button>}
                {p.rijksregisterMasker && <button onClick={() => wisGevoelig('rijksregister')} style={{ ...btnMini, color: 'crimson' }}>RRN wissen</button>}
                {p.ibanMasker && <button onClick={() => wisGevoelig('iban')} style={{ ...btnMini, color: 'crimson' }}>IBAN wissen</button>}
              </div>
            )}
          </div>
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #e5e7eb' }}>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>Noodcontact</div>
            <div style={raster}>
              {veld('noodcontactNaam', 'Naam')}
              {veld('noodcontactTelefoon', 'Telefoon', { inputMode: 'tel' })}
            </div>
          </div>
        </Kader>

        <Kader titel="Contract">
          <div style={raster}>
            <label style={lab}>Statuut<select value={String(form.statuut ?? '')} onChange={(e) => zet('statuut', e.target.value)} style={inp}>{STATUTEN.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></label>
            <label style={lab}>Onderneming<select value={String(form.ondernemingId ?? '')} onChange={(e) => zet('ondernemingId', e.target.value)} style={inp}><option value="">—</option>{ondernemingen.map((o) => <option key={o.id} value={o.id}>{o.naam}{o.isImporteur ? ' (import)' : ''}</option>)}</select></label>
            {veld('functie', 'Functie', { placeholder: 'bv. verkoper, kok, zaalverantwoordelijke' })}
            <span />
            {veld('inDienst', 'In dienst sinds', { type: 'date' })}
            {veld('uitDienst', 'Uit dienst op', { type: 'date' })}
          </div>
          <div style={{ marginTop: 10 }}>
            <div style={lab}>Werkt in</div>
            {vinkjes('afdelingen')}
          </div>
          <div style={{ marginTop: 10 }}>
            <div style={lab}>Verantwoordelijke van (keurt uren, overuren en verlof goed)</div>
            {vinkjes('verantwoordelijkVoor')}
          </div>
        </Kader>

        <Kader titel="Uurregime en plafonds">
          <div style={raster}>
            {getal('urenPerWeek', 'Normaal per week', 'uur', 'Daarboven tellen uren als overuren')}
            {getal('urenPerDag', 'Normaal per dag', 'uur', 'Daarboven tellen uren als overuren')}
            {getal('maxUrenDag', 'Plafond per dag', 'uur', 'Harde grens: de teller stopt hier (wettelijk 11 u)')}
            {getal('maxUrenWeek', 'Plafond per week', 'uur', 'Harde grens (wettelijk 50 u)')}
            {getal('maxUrenMaand', 'Plafond per maand', 'uur', 'Optioneel; nooit vier weken van 50 u')}
            {getal('jaarContingent', 'Jaarcontingent', 'uur', 'Bv. studentenuren per kalenderjaar')}
          </div>
          <p style={{ fontSize: 12, color: '#6b7280', margin: '8px 0 0' }}>Normaal regime: alles daarboven is een overuur dat goedgekeurd moet worden. Plafond: de harde grens waar de urenteller later stopt. Standaard 11 u per dag en 50 u per week.</p>
        </Kader>

        <Kader titel="Verlof en recup">
          <div style={raster}>
            {getal('verlofdagenJaar', 'Verlofdagen per jaar', 'dagen')}
            {getal('verlofdagenSaldo', 'Nog beschikbaar', 'dagen')}
            {getal('recupUrenSaldo', 'Recup-saldo', 'uur')}
          </div>
          <p style={{ fontSize: 12, color: '#6b7280', margin: '8px 0 0' }}>Wordt later bijgewerkt door verlofaanvragen en goedgekeurde overuren; voorlopig manueel in te vullen.</p>
        </Kader>

        <Kader titel="Kledij">
          <div style={raster}>
            {(['maatBovenstuk', 'maatJas', 'maatSchort'] as const).map((k) => (
              <label key={k} style={lab}>{k === 'maatBovenstuk' ? 'T-shirt / polo / hemd' : k === 'maatJas' ? 'Jas / fleece' : 'Schort'}
                <select value={String(form[k] ?? '')} onChange={(e) => zet(k, e.target.value)} style={inp}>
                  {[...new Set([...MATEN, String(form[k] ?? '')])].map((m) => <option key={m} value={m}>{m || '—'}</option>)}
                </select>
              </label>
            ))}
            {veld('maatBroek', 'Broek', { placeholder: 'bv. 40 of W32/L32' })}
            {veld('maatSchoenen', 'Schoenen', { inputMode: 'numeric', placeholder: 'bv. 42' })}
            <label style={{ ...lab, gridColumn: '1 / -1' }}>Uitgereikte kledij / opmerking
              <input value={String(form.kledijOpmerking ?? '')} onChange={(e) => zet('kledijOpmerking', e.target.value)} placeholder="bv. 2 polo's en 1 schort meegegeven op 05/10" style={inp} />
            </label>
          </div>
        </Kader>

        <Kader titel="Omzet (enkel eigenaars)">
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            <Cijfer label="Deze maand" waarde={euro(d.omzet.maand.totaal)} sub={`${d.omzet.maand.tickets} tickets`} />
            <Cijfer label="Dit jaar" waarde={euro(d.omzet.jaar.totaal)} sub={`${d.omzet.jaar.tickets} tickets`} />
            <Cijfer label="Laatste verkoop" waarde={datumNl(d.omzet.laatsteVerkoop)} />
          </div>
          <p style={{ fontSize: 12, color: '#6b7280', margin: '8px 0 0' }}>Tickets waarop deze persoon als verkoper gekozen werd (geannuleerde niet meegeteld).</p>
        </Kader>

        <Kader titel="Notities">
          <textarea value={String(form.notities ?? '')} onChange={(e) => zet('notities', e.target.value)} rows={6} placeholder="Afspraken, opmerkingen, opleidingen…" style={{ ...inp, resize: 'vertical' }} />
          <p style={{ fontSize: 12, color: '#6b7280', margin: '6px 0 0' }}>Account aangemaakt op {datumNl(a.createdAt)}{p.updatedAt ? ` · dossier laatst bijgewerkt ${new Date(p.updatedAt).toLocaleString('nl-BE')}` : ''}.</p>
        </Kader>
      </div>

      {gewijzigd && (
        <div style={{ position: 'sticky', bottom: 0, marginTop: 14, padding: '10px 0', background: 'var(--bg, #fff)', display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={bewaar} disabled={bezig} style={btnGroen}>{bezig ? 'Bezig…' : 'Wijzigingen bewaren'}</button>
          <button onClick={laad} disabled={bezig} style={btnGrijs}>Annuleren</button>
          <span style={{ color: '#b45309', fontSize: 13 }}>Er zijn niet-bewaarde wijzigingen.</span>
        </div>
      )}
    </div>
  );
}

function Kader({ titel, children }: { titel: string; children: ReactNode }) {
  return (
    <section style={{ border: '1px solid #e5e7eb', borderRadius: 12, padding: 14, background: '#fff', minWidth: 0 }}>
      <h3 style={{ margin: '0 0 10px', fontSize: 16 }}>{titel}</h3>
      {children}
    </section>
  );
}
function Cijfer({ label, waarde, sub }: { label: string; waarde: string; sub?: string }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: '#6b7280' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{waarde}</div>
      {sub && <div style={{ fontSize: 12, color: '#6b7280' }}>{sub}</div>}
    </div>
  );
}

const raster: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 };
const inp: CSSProperties = { width: '100%', padding: 8, fontSize: 14, boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 6 };
const lab: CSSProperties = { fontSize: 12, color: '#6b7280', display: 'flex', flexDirection: 'column', gap: 3 };
const chip: CSSProperties = { padding: '6px 12px', border: '1px solid #cbd5e1', borderRadius: 999, cursor: 'pointer', fontSize: 14 };
const btnGroen: CSSProperties = { padding: '10px 16px', border: 'none', borderRadius: 8, background: '#16a34a', color: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 15 };
const btnGrijs: CSSProperties = { padding: '10px 14px', border: '1px solid #cbd5e1', borderRadius: 8, background: '#fff', cursor: 'pointer', fontSize: 14 };
const btnMini: CSSProperties = { padding: '3px 8px', border: '1px solid #cbd5e1', borderRadius: 5, background: '#fff', cursor: 'pointer', fontSize: 12 };
