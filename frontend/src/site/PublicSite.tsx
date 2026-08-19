import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getSiteInhoud, type SiteInhoud, type Openingsuur } from '../api/client';
import './site.css';

const DAGEN = ['', 'Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag', 'Zondag'];
// Vandaag als dag 1..7 (1 = maandag).
function vandaagDag(): number { return ((new Date().getDay() + 6) % 7) + 1; }

// De "Ons aanbod"-tegels. Elke tegel kan een eigen foto krijgen (SiteTekst
// aanbodfoto_<slug>); zonder foto tonen we het lijn-icoon.
const AANBOD: { slug: string; naam: string; sub: string; icon: JSX.Element }[] = [
  { slug: 'fruit', naam: 'Fruit', sub: 'seizoensvers', icon: <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 8c-1.5-3.5-5-3.5-6.5-1C4 9.5 5 14 12 20c7-6 8-10.5 6.5-13-1.5-2.5-5-2.5-6.5 1z" /><path d="M12 8V4c0-1.2 1-2 2.2-2" /></svg> },
  { slug: 'groenten', naam: 'Groenten', sub: 'vers van het veld', icon: <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M5 19c6 2 12-3 13-11-8 1-13 5-13 11z" /><path d="M6 18C10 14 13 11 18 8" /></svg> },
  { slug: 'vlees', naam: 'Vlees', sub: 'van de beenhouwer', icon: <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="12" cy="13" r="7" /><path d="M12 13l3-3M9 6c0-2 2-3 3-1" /></svg> },
  { slug: 'vis', naam: 'Vis', sub: 'dagverse aanvoer', icon: <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 12c4-6 12-6 16 0-4 6-12 6-16 0z" /><path d="M19 12c1.5-1 3-1 3 0s-1.5 1-3 0z" /><circle cx="8" cy="12" r="1" /></svg> },
  { slug: 'kaas', naam: 'Kaas & Zuivel', sub: 'fijne selectie', icon: <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M3 15l9-6 9 6v3H3z" /><circle cx="9" cy="14" r="1" /><circle cx="14" cy="15.5" r="1" /></svg> },
  { slug: 'traiteur', naam: 'Traiteur', sub: 'dagvers bereid', icon: <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M4 16h16M5 16c0-4 3-6 7-6s7 2 7 6" /><path d="M12 10V7" /><path d="M8 20h8" /></svg> },
  { slug: 'droge', naam: 'Droge voeding', sub: 'de basis in huis', icon: <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M5 8l7-4 7 4v9l-7 4-7-4z" /><path d="M5 8l7 4 7-4M12 12v9" /></svg> },
  { slug: 'wijnkelder', naam: 'Wijnkelder', sub: 'voor elke gelegenheid', icon: <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M9 2h6M10 2v4L7 9v11a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V9l-3-3V2" /><path d="M7 13h10" /></svg> },
];

// De sfeergalerij zit als JSON-lijst van URL's in SiteTekst 'galerij'.
function parseGalerij(waarde: string | undefined): string[] {
  if (!waarde) return [];
  try { const v = JSON.parse(waarde); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []; }
  catch { return []; }
}

// Publieke landingspagina van Marché. Inhoud (teksten, uren, contact, partners)
// komt uit het "Website"-beheer via /site/inhoud, met nette terugvalwaarden.
export function PublicSite() {
  const [inhoud, setInhoud] = useState<SiteInhoud | null>(null);

  useEffect(() => {
    document.title = 'Marché — versmarkt, traiteur & wijnkelder';
    getSiteInhoud().then(setInhoud).catch(() => {});
  }, []);

  // Reveal-elementen tonen zodra ze in beeld scrollen (opnieuw na het laden
  // van de inhoud, want dan renderen extra secties).
  useEffect(() => {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { threshold: 0.12 });
    document.querySelectorAll('.marche-site .reveal:not(.in)').forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [inhoud]);

  const T = inhoud?.teksten ?? {};
  const uren: Openingsuur[] = inhoud?.openingsuren ?? [];
  const partners = inhoud?.partners ?? [];
  const galerij = parseGalerij(T.galerij);
  const vd = vandaagDag();

  return (
    <div className="marche-site">
      <header className="top">
        <div className="wrap topbar">
          <a className="brand" href="#top" aria-label="Marché — met smaak gekozen">
            <svg className="mark" width="38" height="38" viewBox="0 0 40 40" fill="none" aria-hidden="true">
              <circle cx="20" cy="20" r="18.6" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="20" cy="20" r="14.4" stroke="currentColor" strokeWidth="1" opacity="0.45" />
              <text x="20" y="26.5" textAnchor="middle" fontSize="19" fontWeight="600" fill="currentColor">M</text>
            </svg>
            <span className="word-wrap">
              <span className="word">Marché</span>
              <span className="ph">met smaak gekozen</span>
            </span>
          </a>
          <nav className="main" aria-label="Hoofdmenu">
            <a href="#uren">Openingsuren</a>
            <a href="#partners">Onze partners</a>
            <a href="#contact">Contact</a>
          </nav>
          <Link className="btn btn-primary" to="/webshop">Webshop</Link>
        </div>
      </header>

      <a id="top" />
      <main>
        <section className="hero">
          <div className="wrap hero-grid">
            <div className="reveal in">
              <span className="eyebrow">{T.hero_eyebrow || 'Versmarkt · Traiteur · Wijnkelder'}</span>
              <h1>{T.hero_titel || 'De markt in je buurt,'} <em>{T.hero_titel_accent || 'elke dag vers.'}</em></h1>
              <p className="lead">
                {T.hero_intro || 'Fruit en groenten, vlees en vis, kazen, dagverse traiteurgerechten en een goed gevulde wijnkelder — zorgvuldig gekozen en klaar om mee te nemen of te laten leveren.'}
              </p>
              <div className="actions">
                <Link className="btn btn-primary" to="/webshop">Naar de webshop</Link>
                <a className="btn btn-ghost" href="#uren">Openingsuren &amp; ligging</a>
              </div>
              <div className="trust">
                <div className="t"><b>{T.trust1_titel || 'Vers'}</b><span>{T.trust1_sub || 'dagelijks aangevoerd'}</span></div>
                <div className="t"><b>{T.trust2_titel || 'Traiteur'}</b><span>{T.trust2_sub || 'elke dag iets nieuws'}</span></div>
                <div className="t"><b>{T.trust3_titel || 'Wijnkelder'}</b><span>{T.trust3_sub || 'ruime selectie'}</span></div>
              </div>
            </div>

            {T.hero_afbeelding ? (
              <div className="reveal in"><img className="hero-foto" src={T.hero_afbeelding} alt="Marché" /></div>
            ) : (
            <div className="showcase reveal in" aria-hidden="true">
              <span className="ribbon">{T.ribbon || 'Vers vandaag'}</span>
              <div className="card c1">
                <div className="row">
                  <span className="thumb"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M12 7c-1-3-4-3-5-1-1 2 0 5 5 9 5-4 6-7 5-9-1-2-4-2-5 1z" /><path d="M12 7V4M12 4c0-1 1-1.6 2-1.6" /></svg></span>
                  <div><div className="nm">{T.card1_naam || 'Belgische aardbeien'}</div><div className="sub">{T.card1_sub || 'per bakje · 400 g'}</div></div>
                  <span className="pr">{T.card1_prijs || '€ 4,50'}</span>
                </div>
              </div>
              <div className="card c2">
                <div className="row">
                  <span className="thumb"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M9 2h6M10 2v4.5L7 10v11a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V10l-3-3.5V2" /><path d="M7.2 14h9.6" /></svg></span>
                  <div><div className="nm">{T.card2_naam || "Bourgogne rouge '21"}</div><div className="sub">{T.card2_sub || 'wijnkelder · 75 cl'}</div></div>
                  <span className="pr">{T.card2_prijs || '€ 18,90'}</span>
                </div>
              </div>
              <div className="card c3">
                <div className="row">
                  <span className="thumb"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="M3 17h18M4 17c0-5 4-8 8-8s8 3 8 8" /><circle cx="9" cy="14" r="1" /><circle cx="14" cy="15" r="1" /><path d="M12 9V6" /></svg></span>
                  <div><div className="nm">{T.card3_naam || 'Traiteur: lasagne'}</div><div className="sub">{T.card3_sub || 'vers bereid · per portie'}</div></div>
                  <span className="pr">{T.card3_prijs || '€ 12,90'}</span>
                </div>
              </div>
            </div>
            )}
          </div>
        </section>

        <section id="aanbod">
          <div className="wrap">
            <div className="sec-head reveal">
              <span className="eyebrow">Ons aanbod</span>
              <h2>{T.aanbod_titel || 'Alles voor een goede tafel, onder één dak'}</h2>
              <p>{T.aanbod_intro || 'Van het ontbijt tot het aperitief. Dit vind je bij Marché — de volledige versafdeling, de traiteur en de wijnkelder.'}</p>
            </div>
            <div className="cats reveal">
              {AANBOD.map((a) => {
                const foto = T[`aanbodfoto_${a.slug}`];
                return (
                  <div className="cat" key={a.slug}>
                    {foto ? <img className="cat-foto" src={foto} alt={a.naam} /> : a.icon}
                    <b>{a.naam}</b><span>{a.sub}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {galerij.length > 0 && (
          <section id="galerij">
            <div className="wrap">
              <div className="sec-head reveal">
                <span className="eyebrow">In de kijker</span>
                <h2>{T.galerij_titel || 'Een blik in de winkel'}</h2>
              </div>
              <div className="galerij reveal">
                {galerij.map((url, k) => <img key={k} className="galerij-foto" src={url} alt="" />)}
              </div>
            </div>
          </section>
        )}

        <section id="webshop">
          <div className="wrap reveal">
            <div className="band">
              <div>
                <span className="eyebrow">Online bestellen</span>
                <h2>{T.webshop_titel || 'Vandaag online,'} <em>{T.webshop_titel_accent || 'straks afgehaald.'}</em></h2>
                <p>{T.webshop_intro || 'Een selectie van ons versaanbod en traiteur staat online — elke dag bijgewerkt. Bestel gemakkelijk vooraf en haal af in de winkel, of laat leveren.'}</p>
              </div>
              <div className="actions">
                <Link className="btn btn-primary" to="/webshop">Bekijk de webshop</Link>
              </div>
            </div>
          </div>
        </section>

        <section id="uren">
          <div className="wrap">
            <div className="two">
              <div className="panel reveal">
                <span className="eyebrow">Wanneer</span>
                <h3>Openingsuren</h3>
                <table className="hours">
                  <tbody>
                    {uren.map((u) => (
                      <tr key={u.dag} className={u.dag === vd ? 'today' : ''}>
                        <td className="day">{DAGEN[u.dag]}</td>
                        {u.gesloten
                          ? <td className="val closed">Gesloten</td>
                          : <td className="val">{u.van} – {u.tot}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="panel reveal" id="contact">
                <span className="eyebrow">Contact</span>
                <h3>Kom langs of bel ons</h3>
                <div className="contact-list">
                  <div className="cl"><svg className="ci" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 22s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12z" /><circle cx="12" cy="10" r="2.5" /></svg><div><b>Adres</b><span>{T.contact_adres || 'Marktstraat 1, 0000 Gemeente'}</span></div></div>
                  <div className="cl"><svg className="ci" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 5c0 9 6 15 15 15l0-3.5-4-1.5-2 2c-3-1.5-5-3.5-6.5-6.5l2-2L7 4.5 4 5z" /></svg><div><b>Telefoon</b><span>{T.contact_telefoon || '+32 (0)00 00 00 00'}</span></div></div>
                  <div className="cl"><svg className="ci" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3.5 6.5 12 13l8.5-6.5" /></svg><div><b>E-mail</b><span>{T.contact_email || 'info@marché.eu'}</span></div></div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="partners">
          <div className="wrap">
            <div className="sec-head reveal">
              <span className="eyebrow">Samen met</span>
              <h2>Onze partners</h2>
              <p>Lokale telers, ambachtelijke producenten en onze eigen wijnimport. Hun logo's komen hier.</p>
            </div>
            <div className="partners reveal">
              {partners.length > 0
                ? partners.map((p) => {
                    const inhoud = p.logoUrl ? <img className="plogo-img" src={p.logoUrl} alt={p.naam} /> : <span>{p.naam}</span>;
                    return p.website
                      ? <a key={p.id} className="plogo" href={p.website} target="_blank" rel="noreferrer">{inhoud}</a>
                      : <div key={p.id} className="plogo">{inhoud}</div>;
                  })
                : <><div className="plogo">Partner 1</div><div className="plogo">Partner 2</div><div className="plogo">Partner 3</div><div className="plogo">Partner 4</div><div className="plogo">Partner 5</div></>}
            </div>
          </div>
        </section>
      </main>

      <footer className="foot">
        <div className="wrap">
          <div className="foot-grid">
            <a className="brand" href="#top"><span className="word" style={{ fontSize: '1.4rem' }}>Marché</span></a>
            <nav className="foot-nav" aria-label="Voettekst">
              <a href="#uren">Openingsuren</a>
              <a href="#partners">Onze partners</a>
              <a href="#contact">Contact</a>
              <Link to="/webshop">Webshop</Link>
            </nav>
          </div>
          <div className="foot-legal">
            <span>© Marché · met smaak gekozen · by Bleuet · marché.eu</span>
            <a href="#">Herroepingsrecht</a>
            <a href="#">Privacy (GDPR)</a>
            <a href="#">Algemene voorwaarden</a>
            <Link to="/kassa" style={{ marginLeft: 'auto' }}>Personeel</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
