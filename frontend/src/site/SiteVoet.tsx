import { Link } from 'react-router-dom';
import type { SiteInhoud } from '../api/client';

// Voettekst van de publieke site, met de wettelijk verplichte gegevens van de onderneming
// en de herroepingsfunctie, die vanop elke pagina vindbaar moet zijn.
export function SiteVoet({ inhoud, nav }: { inhoud: SiteInhoud | null; nav?: JSX.Element }) {
  const o = inhoud?.onderneming;
  return (
    <footer className="foot">
      <div className="wrap">
        <div className="foot-grid">
          <Link className="brand" to="/"><span className="word" style={{ fontSize: '1.4rem' }}>Marché</span></Link>
          {nav}
        </div>
        <div className="foot-legal">
          <span>© Marché · met smaak gekozen · by Bleuet · marché.eu</span>
          <Link to="/herroeping">Herroep hier je bestelling</Link>
          <Link to="/privacy">Privacy (GDPR)</Link>
          <Link to="/voorwaarden">Algemene voorwaarden</Link>
          <Link to="/kassa" style={{ marginLeft: 'auto' }}>Personeel</Link>
        </div>
        {o && (
          <div className="foot-legal foot-bedrijf">
            {[o.naam, o.adres, `Ondernemingsnummer ${o.ondernemingsnummer}`, o.btwNummer ? `Btw ${o.btwNummer}` : null].filter(Boolean).join(' · ')}
          </div>
        )}
      </div>
    </footer>
  );
}
