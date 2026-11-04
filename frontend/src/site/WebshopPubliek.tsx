import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  getWebshopProducten, getWebshopAfdelingen, plaatsBestelling, getSiteInhoud,
  type WebshopProduct, type WebshopAfdeling, type BestellingBevestiging, type SiteInhoud,
} from '../api/client';
import { SiteVoet } from './SiteVoet';
import './site.css';

const euro = (n: number) => '€ ' + n.toFixed(2);
const MAX_AANTAL = 999; // zelfde grens als de server

// Afdelingen zonder voeding: daar hoeft geen allergeneninformatie bij.
const GEEN_VOEDING = ['Onderhoudsproducten', 'Private hygiëne', 'Lifestyle'];
// Leeg betekent "nog niet ingevuld", niet "bevat geen allergenen".
function allergeenTekst(p: WebshopProduct) {
  if (p.afdeling && GEEN_VOEDING.includes(p.afdeling.naam)) return null;
  return `Allergenen: ${p.allergenen?.trim() || 'vraag het ons'}`;
}

// Publieke webshop: catalogus (selectie uit het assortiment) → winkelmandje →
// afrekenen (afhalen/leveren, betalen bij afhaling). Verlaagt dezelfde stock.
export function WebshopPubliek() {
  const [producten, setProducten] = useState<WebshopProduct[]>([]);
  const [afdelingen, setAfdelingen] = useState<WebshopAfdeling[]>([]);
  const [afd, setAfd] = useState('');
  const [mandje, setMandje] = useState<Record<string, number>>({});
  const [scherm, setScherm] = useState<'catalogus' | 'afrekenen' | 'klaar'>('catalogus');
  const [inhoud, setInhoud] = useState<SiteInhoud | null>(null);
  const [klant, setKlant] = useState({ naam: '', email: '', telefoon: '', adres: '' });
  const [leverwijze, setLeverwijze] = useState<'AFHALEN' | 'LEVEREN'>('AFHALEN');
  // Gewenste afhaal-/leverdatum (verplicht) en uur (optioneel); komt in de agenda van de winkel.
  const vandaagIso = new Date().toLocaleDateString('sv-SE');
  const [gewensteDag, setGewensteDag] = useState('');
  const [gewensteTijd, setGewensteTijd] = useState('');
  const [leeftijdOk, setLeeftijdOk] = useState(false);
  const [akkoord, setAkkoord] = useState(false);
  const [bevestiging, setBevestiging] = useState<BestellingBevestiging | null>(null);
  const [fout, setFout] = useState('');
  const [bezig, setBezig] = useState(false);

  useEffect(() => {
    document.title = 'Webshop — Marché';
    getWebshopProducten().then(setProducten).catch(() => {});
    getWebshopAfdelingen().then(setAfdelingen).catch(() => {});
    getSiteInhoud().then(setInhoud).catch(() => {});
  }, []);

  const prodById = useMemo(() => Object.fromEntries(producten.map((p) => [p.id, p])), [producten]);
  const zichtbaar = useMemo(() => producten.filter((p) => !afd || p.afdelingId === afd), [producten, afd]);
  const lijnen = useMemo(
    () => Object.entries(mandje).map(([id, aantal]) => ({ p: prodById[id], aantal })).filter((x) => x.p),
    [mandje, prodById],
  );
  const totaal = lijnen.reduce((s, l) => s + Number(l.p.verkoopprijs) * l.aantal, 0);
  const aantalItems = lijnen.reduce((s, l) => s + l.aantal, 0);
  const heeftAlcohol = lijnen.some((l) => l.p.isAlcohol);

  function stap(id: string, delta: number) {
    setMandje((m) => {
      const p = prodById[id];
      const step = p?.eenheid === 'KG' ? 0.5 : 1;
      const n = Math.round(((m[id] ?? 0) + delta * step) * 1000) / 1000;
      const kopie = { ...m };
      if (n <= 0) delete kopie[id]; else kopie[id] = Math.min(n, MAX_AANTAL);
      return kopie;
    });
  }
  function zet(id: string, waarde: string) {
    const getal = Number(waarde.replace(',', '.'));
    // Stukken bestel je per stuk; kilo's mogen een komma hebben.
    const n = prodById[id]?.eenheid === 'KG' ? getal : Math.floor(getal);
    setMandje((m) => {
      const kopie = { ...m };
      if (!(n > 0)) delete kopie[id]; else kopie[id] = Math.min(n, MAX_AANTAL);
      return kopie;
    });
  }

  async function bestel() {
    setFout('');
    if (!lijnen.length) { setFout('Je winkelmandje is leeg.'); return; }
    if (!klant.naam.trim() || !klant.email.trim()) { setFout('Vul je naam en e-mail in.'); return; }
    if (leverwijze === 'LEVEREN' && !klant.adres.trim()) { setFout('Vul een leveradres in.'); return; }
    if (!gewensteDag) { setFout(`Kies een ${leverwijze === 'LEVEREN' ? 'lever' : 'afhaal'}datum.`); return; }
    if (gewensteDag < vandaagIso) { setFout('De gekozen datum ligt in het verleden.'); return; }
    if (heeftAlcohol && !leeftijdOk) { setFout('Bevestig dat je oud genoeg bent voor alcohol.'); return; }
    if (!akkoord) { setFout('Bevestig dat je akkoord gaat met de voorwaarden.'); return; }
    setBezig(true);
    try {
      const b = await plaatsBestelling({
        lijnen: lijnen.map((l) => ({ productId: l.p.id, aantal: l.aantal })),
        klant: { naam: klant.naam.trim(), email: klant.email.trim(), telefoon: klant.telefoon.trim() || undefined, adres: klant.adres.trim() || undefined },
        leverwijze, gewensteDag, gewensteTijd: gewensteTijd || undefined,
      });
      setBevestiging(b);
      setMandje({});
      setScherm('klaar');
    } catch (e) {
      setFout(e instanceof Error ? e.message : 'Bestellen mislukt');
      window.scrollTo({ top: 0, behavior: 'smooth' }); // de melding staat bovenaan
    } finally { setBezig(false); }
  }

  return (
    <div className="marche-site">
      <header className="top">
        <div className="wrap topbar">
          <Link className="brand" to="/" aria-label="Marché — home">
            <svg className="mark" width="38" height="38" viewBox="0 0 40 40" fill="none" aria-hidden="true">
              <circle cx="20" cy="20" r="18.6" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="20" cy="20" r="14.4" stroke="currentColor" strokeWidth="1" opacity="0.45" />
              <text x="20" y="26.5" textAnchor="middle" fontSize="19" fontWeight="600" fill="currentColor">M</text>
            </svg>
            <span className="word-wrap"><span className="word">Marché</span><span className="ph">webshop</span></span>
          </Link>
          <span style={{ marginLeft: 'auto' }} />
          {scherm === 'catalogus' && lijnen.length > 0 && (
            <button className="btn btn-primary" onClick={() => setScherm('afrekenen')}>
              Mandje ({aantalItems % 1 === 0 ? aantalItems : aantalItems.toFixed(1)}) · {euro(totaal)}
            </button>
          )}
          <Link className="btn btn-ghost" to="/">← Winkel</Link>
        </div>
      </header>

      <main>
        <div className="wrap" style={{ paddingTop: 32, paddingBottom: 60 }}>
          {fout && <div style={{ background: '#fee2e2', color: '#991b1b', padding: '10px 14px', borderRadius: 10, marginBottom: 16 }}>{fout}</div>}

          {scherm === 'klaar' && bevestiging && (
            <div style={{ maxWidth: 560 }}>
              <span className="eyebrow">Bedankt!</span>
              <h1 style={{ fontSize: 'clamp(2rem,4vw,2.8rem)', margin: '10px 0' }}>Je bestelling is geplaatst.</h1>
              <p className="lead">
                We hebben je bestelling goed ontvangen{bevestiging.klant ? `, ${bevestiging.klant.naam}` : ''}.
                {` Je betaalt bij ${bevestiging.leverwijze === 'LEVEREN' ? 'de levering' : 'het afhalen'}.`} We contacteren je zodra ze klaar is.
                {bevestiging.bevestigingPerMail && bevestiging.klant ? ` We sturen ook een bevestiging naar ${bevestiging.klant.email}.` : ''}
              </p>
              <div className="panel" style={{ marginTop: 16 }}>
                <div style={{ color: 'var(--muted)', marginBottom: 6 }}>Bestelnummer <b>{bevestiging.bestelnummer}</b></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 18 }}>
                  <span>Totaal</span><span>{euro(bevestiging.totaal)}</span>
                </div>
                <div style={{ color: 'var(--muted)', marginTop: 6 }}>
                  {bevestiging.leverwijze === 'LEVEREN' ? 'Levering' : 'Afhalen in de winkel'}
                  {bevestiging.gewensteDag ? ` op ${new Date(bevestiging.gewensteDag + 'T12:00:00').toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long' })}${bevestiging.gewensteTijd ? ` om ${bevestiging.gewensteTijd}` : ''}` : ''} · {bevestiging.lijnen.length} artikel(s)
                </div>
              </div>
              <div className="actions" style={{ marginTop: 24 }}>
                <button className="btn btn-primary" onClick={() => { setScherm('catalogus'); setBevestiging(null); }}>Verder winkelen</button>
                <Link className="btn btn-ghost" to="/">Naar de startpagina</Link>
              </div>
            </div>
          )}

          {scherm === 'afrekenen' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1.1fr .9fr', gap: 28, alignItems: 'start' }} className="checkout-grid">
              <div>
                <button className="btn btn-ghost" onClick={() => setScherm('catalogus')} style={{ marginBottom: 16 }}>← Verder winkelen</button>
                <h2 style={{ marginBottom: 12 }}>Jouw gegevens</h2>
                <div className="form-veld"><label>Naam</label><input value={klant.naam} onChange={(e) => setKlant({ ...klant, naam: e.target.value })} /></div>
                <div className="form-veld"><label>E-mail</label><input value={klant.email} onChange={(e) => setKlant({ ...klant, email: e.target.value })} placeholder="we contacteren je via dit adres" /></div>
                <div className="form-veld"><label>Telefoon (optioneel)</label><input value={klant.telefoon} onChange={(e) => setKlant({ ...klant, telefoon: e.target.value })} /></div>

                <h2 style={{ margin: '20px 0 12px' }}>Afhalen of leveren?</h2>
                <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
                  {(['AFHALEN', 'LEVEREN'] as const).map((lw) => (
                    <button key={lw} onClick={() => setLeverwijze(lw)}
                      style={{ flex: 1, padding: 12, borderRadius: 10, cursor: 'pointer', border: leverwijze === lw ? '2px solid var(--brand)' : '1px solid var(--line)', background: leverwijze === lw ? 'var(--surface-2)' : 'var(--surface)', fontWeight: 600 }}>
                      {lw === 'AFHALEN' ? 'Afhalen in de winkel' : 'Laten leveren'}
                    </button>
                  ))}
                </div>
                {leverwijze === 'LEVEREN' && (
                  <div className="form-veld"><label>Leveradres</label><input value={klant.adres} onChange={(e) => setKlant({ ...klant, adres: e.target.value })} placeholder="straat, nr, postcode, gemeente" /></div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div className="form-veld"><label>{leverwijze === 'LEVEREN' ? 'Gewenste leverdatum' : 'Wanneer kom je afhalen?'}</label><input type="date" min={vandaagIso} value={gewensteDag} onChange={(e) => setGewensteDag(e.target.value)} /></div>
                  <div className="form-veld"><label>Uur (optioneel)</label><input type="time" step={900} value={gewensteTijd} onChange={(e) => setGewensteTijd(e.target.value)} /></div>
                </div>

                <h2 style={{ margin: '20px 0 8px' }}>Betaling</h2>
                <p style={{ margin: 0 }}>Je betaalt bij {leverwijze === 'LEVEREN' ? 'de levering' : 'het afhalen in de winkel'}.</p>

                <p style={{ fontSize: 14, color: 'var(--muted)', margin: '14px 0 0' }}>
                  Verse voeding en bereide gerechten vallen niet onder het herroepingsrecht. <Link to="/herroeping" target="_blank" rel="noopener" style={{ textDecoration: 'underline' }}>Lees wat wel en niet kan</Link>.
                </p>

                {heeftAlcohol && (
                  <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 12 }}>
                    <input type="checkbox" checked={leeftijdOk} onChange={(e) => setLeeftijdOk(e.target.checked)} />
                    <span>Mijn mandje bevat alcohol. Ik bevestig dat ik oud genoeg ben (wijn/bier 16+, sterke drank 18+).</span>
                  </label>
                )}
                <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 10 }}>
                  <input type="checkbox" checked={akkoord} onChange={(e) => setAkkoord(e.target.checked)} />
                  <span>Ik ga akkoord met de <Link to="/voorwaarden" target="_blank" rel="noopener" style={{ textDecoration: 'underline' }}>algemene voorwaarden</Link> en heb de <Link to="/privacy" target="_blank" rel="noopener" style={{ textDecoration: 'underline' }}>privacyverklaring</Link> gelezen.</span>
                </label>

                <button className="btn btn-primary" onClick={bestel} disabled={bezig} style={{ marginTop: 18, width: '100%', justifyContent: 'center', fontSize: 17 }}>
                  {bezig ? 'Bezig…' : `Bestellen met betalingsverplichting · ${euro(totaal)}`}
                </button>
              </div>

              <div className="panel">
                <h3 style={{ marginTop: 0 }}>Je mandje</h3>
                {lijnen.map((l) => (
                  <div key={l.p.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600 }}>{l.p.naam}{l.p.isAlcohol && ' 🍷'}</div>
                      <div style={{ fontSize: 13, color: 'var(--muted)' }}>{euro(Number(l.p.verkoopprijs))}{l.p.eenheid === 'KG' ? ' /kg' : ''}</div>
                      {allergeenTekst(l.p) && <div style={{ fontSize: 12, color: 'var(--muted)' }}>{allergeenTekst(l.p)}</div>}
                    </div>
                    <div style={{ whiteSpace: 'nowrap' }}>
                      <button onClick={() => stap(l.p.id, -1)} style={qtyBtn}>−</button>
                      <span style={{ display: 'inline-block', minWidth: 34, textAlign: 'center' }}>{l.aantal}{l.p.eenheid === 'KG' ? ' kg' : ''}</span>
                      <button onClick={() => stap(l.p.id, +1)} style={qtyBtn}>+</button>
                    </div>
                    <div style={{ width: 70, textAlign: 'right', fontWeight: 600 }}>{euro(Number(l.p.verkoopprijs) * l.aantal)}</div>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: 18, marginTop: 12 }}>
                  <span>Totaal</span><span>{euro(totaal)}</span>
                </div>
              </div>
            </div>
          )}

          {scherm === 'catalogus' && (
            <>
              <span className="eyebrow">Webshop</span>
              <h1 style={{ fontSize: 'clamp(2rem,4vw,2.8rem)', margin: '8px 0 6px' }}>Bestel online, haal af of laat leveren.</h1>
              <p className="lead" style={{ marginBottom: 20 }}>Een dagverse selectie uit onze winkel. Betalen doe je bij afhaling of levering.</p>
              <div className="shop-melding">
                Allergie of intolerantie? Neem vóór je bestelt contact met ons op{inhoud?.teksten.contact_telefoon ? `: ${inhoud.teksten.contact_telefoon}` : ''}. Sporen van allergenen zijn nooit helemaal uit te sluiten.
              </div>

              {producten.length === 0 && <p style={{ color: 'var(--muted)' }}>Er staan momenteel geen producten online.</p>}

              {afdelingen.length > 0 && (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
                  <button onClick={() => setAfd('')} className="chip" style={chip(afd === '')}>Alles</button>
                  {afdelingen.map((a) => <button key={a.id} onClick={() => setAfd(a.id)} style={chip(afd === a.id)}>{a.naam}</button>)}
                </div>
              )}

              <div className="shop-grid">
                {zichtbaar.map((p) => {
                  const aantal = mandje[p.id] ?? 0;
                  return (
                    <div className="shop-card" key={p.id}>
                      <div className="shop-foto">
                        {p.fotoUrl ? <img src={p.fotoUrl} alt={p.naam} /> : <span className="shop-foto-leeg">🛒</span>}
                      </div>
                      <div className="shop-body">
                        <div className="shop-naam">{p.naam}{p.isAlcohol && ' 🍷'}</div>
                        {p.omschrijving && <div className="shop-omschrijving">{p.omschrijving}</div>}
                        {allergeenTekst(p) && <div className="shop-allergenen">{allergeenTekst(p)}</div>}
                        <div className="shop-prijs">{euro(Number(p.verkoopprijs))}{p.eenheid === 'KG' ? ' /kg' : ''}</div>
                        {aantal > 0
                          ? <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
                              <button onClick={() => stap(p.id, -1)} style={qtyBtn}>−</button>
                              <input value={aantal} onChange={(e) => zet(p.id, e.target.value)} inputMode="decimal" style={{ width: 50, textAlign: 'center', padding: 4, border: '1px solid var(--line)', borderRadius: 6 }} />
                              <button onClick={() => stap(p.id, +1)} style={qtyBtn}>+</button>
                              {p.eenheid === 'KG' && <span style={{ fontSize: 12, color: 'var(--muted)' }}>kg</span>}
                            </div>
                          : <button className="btn btn-primary" onClick={() => stap(p.id, +1)} style={{ marginTop: 8, width: '100%', justifyContent: 'center' }}>Toevoegen</button>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </main>
      <SiteVoet inhoud={inhoud} />
    </div>
  );
}

const qtyBtn: React.CSSProperties = { border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 6, width: 28, height: 28, cursor: 'pointer', fontSize: 16 };
function chip(actief: boolean): React.CSSProperties {
  return { padding: '7px 14px', borderRadius: 20, cursor: 'pointer', fontSize: 14, border: actief ? '2px solid var(--brand)' : '1px solid var(--line)', background: actief ? 'var(--surface-2)' : 'var(--surface)', fontWeight: actief ? 600 : 400 };
}
