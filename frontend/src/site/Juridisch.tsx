import { Fragment, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { getSiteInhoud, plaatsHerroeping, type HerroepingBevestiging, type SiteInhoud } from '../api/client';
import { JURIDISCH, juridischeTekst, vulGegevensIn, type JuridischSoort } from './juridischeTeksten';
import { SiteVoet } from './SiteVoet';
import './site.css';

// Toont "[nog in te vullen]" gemarkeerd, zodat het niet over het hoofd gezien wordt.
function metMarkering(regel: string) {
  return regel.split(/(\[[^\]]+\])/).map((stuk, k) => (/^\[[^\]]+\]$/.test(stuk) ? <mark key={k}>{stuk}</mark> : <Fragment key={k}>{stuk}</Fragment>));
}

// Eenvoudige opmaak van de juridische teksten: koppen, opsommingen en alinea's.
function TekstBlokken({ tekst }: { tekst: string }) {
  const blokken: JSX.Element[] = [];
  let lijst: string[] = [];
  const sluitLijst = () => {
    if (lijst.length) blokken.push(<ul key={blokken.length}>{lijst.map((r, k) => <li key={k}>{metMarkering(r)}</li>)}</ul>);
    lijst = [];
  };
  for (const ruw of tekst.split('\n')) {
    const regel = ruw.trim();
    if (regel.startsWith('- ')) { lijst.push(regel.slice(2)); continue; }
    sluitLijst();
    if (regel.startsWith('## ')) blokken.push(<h2 key={blokken.length}>{regel.slice(3)}</h2>);
    else if (regel) blokken.push(<p key={blokken.length}>{metMarkering(regel)}</p>);
  }
  sluitLijst();
  return <>{blokken}</>;
}

// Herroepingsfunctie: gegevens invullen, dan apart bevestigen, dan de ontvangstbevestiging.
function HerroepKnop() {
  const [stap, setStap] = useState<'dicht' | 'invullen' | 'bevestigen' | 'klaar'>('dicht');
  const [form, setForm] = useState({ naam: '', email: '', bestelling: '', toelichting: '' });
  const [klaar, setKlaar] = useState<HerroepingBevestiging | null>(null);
  const [fout, setFout] = useState('');
  const [bezig, setBezig] = useState(false);

  function naarBevestigen(e: FormEvent) {
    e.preventDefault();
    setFout('');
    if (!form.naam.trim() || !form.bestelling.trim()) { setFout('Vul je naam en je bestelling in.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) { setFout('Geef een geldig e-mailadres.'); return; }
    setStap('bevestigen');
  }
  async function bevestig() {
    setFout(''); setBezig(true);
    try {
      setKlaar(await plaatsHerroeping({ naam: form.naam.trim(), email: form.email.trim(), bestelling: form.bestelling.trim(), toelichting: form.toelichting.trim() || undefined }));
      setStap('klaar');
    } catch (err) {
      setFout(err instanceof Error ? err.message : 'Versturen mislukt. Probeer opnieuw of mail ons.');
    } finally { setBezig(false); }
  }

  return (
    <div className="panel herroep-kader">
      {fout && <div className="herroep-fout">{fout}</div>}
      {stap === 'dicht' && (
        <>
          <p style={{ marginTop: 0 }}>Wil je een bestelling herroepen? Dat kan hier online.</p>
          <button className="btn btn-primary" onClick={() => setStap('invullen')}>Herroep hier je bestelling</button>
        </>
      )}
      {stap === 'invullen' && (
        <form onSubmit={naarBevestigen}>
          <div className="form-veld"><label htmlFor="h-naam">Naam</label><input id="h-naam" value={form.naam} maxLength={120} onChange={(e) => setForm({ ...form, naam: e.target.value })} /></div>
          <div className="form-veld"><label htmlFor="h-email">E-mail (hier krijg je de bevestiging)</label><input id="h-email" value={form.email} maxLength={200} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div className="form-veld"><label htmlFor="h-best">Welke bestelling? (bestelnummer of wat en wanneer je bestelde)</label><input id="h-best" value={form.bestelling} maxLength={200} onChange={(e) => setForm({ ...form, bestelling: e.target.value })} /></div>
          <div className="form-veld"><label htmlFor="h-toel">Toelichting (optioneel)</label><input id="h-toel" value={form.toelichting} maxLength={500} onChange={(e) => setForm({ ...form, toelichting: e.target.value })} /></div>
          <button className="btn btn-primary" type="submit">Verder</button>
        </form>
      )}
      {stap === 'bevestigen' && (
        <>
          <p style={{ marginTop: 0 }}><b>Controleer je gegevens.</b> Pas na de knop hieronder is je herroeping verstuurd.</p>
          <p>{form.naam}<br />{form.email}<br />Bestelling: {form.bestelling}{form.toelichting && <><br />Toelichting: {form.toelichting}</>}</p>
          <div className="actions">
            <button className="btn btn-primary" disabled={bezig} onClick={bevestig}>{bezig ? 'Bezig…' : 'Bevestig de herroeping'}</button>
            <button className="btn btn-ghost" disabled={bezig} onClick={() => setStap('invullen')}>Terug</button>
          </div>
        </>
      )}
      {stap === 'klaar' && klaar && (
        <>
          <p style={{ marginTop: 0 }}><b>We ontvingen je herroeping</b> op {new Date(klaar.ontvangenOp).toLocaleString('nl-BE', { timeZone: 'Europe/Brussels', dateStyle: 'long', timeStyle: 'short' })}.</p>
          <p>{form.naam}, {form.email}<br />Bestelling: {form.bestelling}{form.toelichting && <><br />Toelichting: {form.toelichting}</>}</p>
          <p style={{ marginBottom: 0 }}>{klaar.bevestigingPerMail ? `Je krijgt deze bevestiging ook per e-mail op ${form.email}.` : 'Bewaar deze bevestiging, bijvoorbeeld door de pagina af te drukken.'} We nemen zo snel mogelijk contact met je op.</p>
        </>
      )}
    </div>
  );
}

// Publieke juridische pagina's: privacy, algemene voorwaarden en herroepingsrecht.
export function Juridisch({ soort }: { soort: JuridischSoort }) {
  const [inhoud, setInhoud] = useState<SiteInhoud | null>(null);
  const pagina = JURIDISCH[soort];

  useEffect(() => {
    document.title = `${pagina.titel} — Marché`;
    window.scrollTo(0, 0);
    getSiteInhoud().then(setInhoud).catch(() => {});
  }, [pagina.titel]);

  return (
    <div className="marche-site">
      <header className="top">
        <div className="wrap topbar">
          <Link className="brand" to="/" aria-label="Marché — home">
            <span className="word-wrap"><span className="word">Marché</span><span className="ph">met smaak gekozen</span></span>
          </Link>
          <span style={{ marginLeft: 'auto' }} />
          <Link className="btn btn-ghost" to="/webshop">Webshop</Link>
        </div>
      </header>
      <main>
        <div className="wrap juridisch">
          <h1>{pagina.titel}</h1>
          {soort === 'herroeping' && <HerroepKnop />}
          {inhoud ? <TekstBlokken tekst={vulGegevensIn(juridischeTekst(soort, inhoud), inhoud)} /> : <p>Even geduld…</p>}
        </div>
      </main>
      <SiteVoet inhoud={inhoud} />
    </div>
  );
}
