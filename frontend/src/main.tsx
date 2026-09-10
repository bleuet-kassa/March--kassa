import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import './touchscroll';
import { Kassa } from './pages/Kassa';
import { Verkopen } from './pages/Verkopen';
import { Dagafsluiting } from './pages/Dagafsluiting';
import { Beheer } from './pages/Beheer';
import { Facturen } from './pages/Facturen';
import { Boekhouding } from './pages/Boekhouding';
import { Rapporten } from './pages/Rapporten';
import { Cadeaubonnen } from './pages/Cadeaubonnen';
import { Instellingen } from './pages/Instellingen';
import { Kortingen } from './pages/Kortingen';
import { WebshopAssortiment } from './pages/WebshopAssortiment';
import { Bestellingen } from './pages/Bestellingen';
import { Rekeningen } from './pages/Rekeningen';
import { Personeel } from './pages/Personeel';
import { Website } from './pages/Website';
import { PublicSite } from './site/PublicSite';
import { WebshopPubliek } from './site/WebshopPubliek';
import { BevestigAfsluiting } from './pages/BevestigAfsluiting';
import { Login } from './pages/Login';
import { getVerkoper, logout } from './auth';
import { syncQueue, queueCount } from './offline';

// Toont online/offline-status en het aantal nog te synchroniseren verkopen,
// synchroniseert automatisch bij het terugkeren van de verbinding.
function VerbindingStatus() {
  const [online, setOnline] = useState(navigator.onLine);
  const [wachtend, setWachtend] = useState(queueCount());

  useEffect(() => {
    const ververWachtend = () => setWachtend(queueCount());
    const bij = async () => { setOnline(true); await syncQueue(); ververWachtend(); };
    const af = () => setOnline(false);
    window.addEventListener('online', bij);
    window.addEventListener('offline', af);
    window.addEventListener('offline-queue-changed', ververWachtend);
    // periodiek proberen te synchroniseren + bij het opstarten
    syncQueue().then(ververWachtend);
    const t = setInterval(() => { if (navigator.onLine) syncQueue().then(ververWachtend); }, 20000);
    return () => {
      window.removeEventListener('online', bij);
      window.removeEventListener('offline', af);
      window.removeEventListener('offline-queue-changed', ververWachtend);
      clearInterval(t);
    };
  }, []);

  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
      <span style={{ color: online ? '#16a34a' : '#dc2626' }}>
        ● {online ? 'Online' : 'Offline'}
      </span>
      {wachtend > 0 && (
        <>
          <span style={{ color: '#92400e' }}>{wachtend} te synchroniseren</span>
          <button
            onClick={() => syncQueue().then((n) => setWachtend(n))}
            disabled={!online}
            style={{ cursor: online ? 'pointer' : 'default' }}
          >
            Synchroniseer
          </button>
        </>
      )}
    </span>
  );
}

const isTest = (import.meta as any).env?.VITE_OMGEVING === 'test';
function TestBanner() {
  if (!isTest) return null;
  return (
    <div style={{ background: '#b91c1c', color: '#fff', textAlign: 'center', padding: '6px 10px', fontWeight: 700, fontSize: 14 }}>
      🧪 TESTOMGEVING — vrij te testen, losstaande data (kassa_test). Niet de echte kassa.
    </div>
  );
}

// Interne personeelsapp (kassa, beheer, rapporten…) achter login, onder /kassa.
function StaffApp() {
  const [verkoper, setVerkoperState] = useState(getVerkoper());

  // Een ingelogde beheerder wordt na 15 minuten zonder activiteit automatisch
  // uitgelogd. Elke muis-/toets-/touch-actie zet de teller opnieuw op 15 min.
  // Geldt bewust NIET voor het gewone kassa-account (dat moet de hele dag open blijven).
  useEffect(() => {
    const rol = verkoper?.rol;
    const beheerder = rol === 'BEHEERDER' || rol === 'BEHEER';
    if (!beheerder) return;
    const INACTIEF_MS = 15 * 60 * 1000;
    let timer: number | undefined;
    const herstart = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { logout(); setVerkoperState(null); }, INACTIEF_MS);
    };
    const events = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'];
    events.forEach((ev) => window.addEventListener(ev, herstart, { passive: true }));
    herstart(); // teller starten bij (her)inloggen
    return () => {
      window.clearTimeout(timer);
      events.forEach((ev) => window.removeEventListener(ev, herstart));
    };
  }, [verkoper]);

  // Beheerder-dropdown in de navigatie: sluit na een klik op een item of buiten het menu.
  const menuRef = useRef<HTMLDetailsElement>(null);
  const sluitMenu = () => { if (menuRef.current) menuRef.current.open = false; };
  useEffect(() => {
    function buiten(e: MouseEvent) {
      const m = menuRef.current;
      if (m && m.open && !m.contains(e.target as Node)) m.open = false;
    }
    document.addEventListener('click', buiten);
    return () => document.removeEventListener('click', buiten);
  }, []);

  if (!verkoper) {
    return <Login onIngelogd={() => setVerkoperState(getVerkoper())} />;
  }
  const isAdmin = verkoper.rol === 'BEHEERDER' || verkoper.rol === 'BEHEER';

  return (
    <>
      <nav style={{ padding: 12, borderBottom: '1px solid #ddd', display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <strong>Kassa & Stock</strong>
        <Link to="/kassa">Kassa</Link>
        <Link to="/kassa/verkopen">Verkopen</Link>
        <Link to="/kassa/beheer">Beheer</Link>
        <Link to="/kassa/cadeaubonnen">Cadeaubons</Link>
        {isAdmin && <Link to="/kassa/webshop-assortiment">Webshop</Link>}
        {isAdmin && <Link to="/kassa/bestellingen">Bestellingen</Link>}
        {isAdmin && <Link to="/kassa/kortingen">Kortingen</Link>}
        {isAdmin && <Link to="/kassa/website">Website</Link>}
        {isAdmin && (
          /* Beheerder-menu: alles wat andere medewerkers niet hoeven te zien, in één dropdown. */
          <details ref={menuRef} style={{ position: 'relative' }}>
            <summary style={{ cursor: 'pointer', listStyle: 'none', fontWeight: 700, color: '#0d4589', userSelect: 'none', padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6 }}>
              Beheerder ▾
            </summary>
            <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 50, marginTop: 6, background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8, boxShadow: '0 6px 20px rgba(0,0,0,.12)', padding: 6, display: 'flex', flexDirection: 'column', minWidth: 200 }}>
              {([
                ['/kassa/dagafsluiting', 'Dagafsluiting'],
                ['/kassa/facturen', 'Facturen inlezen'],
                ['/kassa/boekhouding', 'Boekhouding'],
                ['/kassa/rapporten', 'Rapporten'],
                ['/kassa/rekeningen', 'Klant factuur'],
                ['/kassa/personeel', 'Personeel'],
                ['/kassa/instellingen', 'Instellingen'],
              ] as [string, string][]).map(([pad, naam]) => (
                <Link key={pad} to={pad} onClick={sluitMenu} style={{ padding: '10px 12px', borderRadius: 6, textDecoration: 'none', color: '#111827', fontSize: 15 }}>{naam}</Link>
              ))}
            </div>
          </details>
        )}
        <span style={{ marginLeft: 'auto' }}><VerbindingStatus /></span>
        <span style={{ color: '#666' }}>
          {verkoper.naam} ({verkoper.rol})
        </span>
        <button
          onClick={() => { logout(); setVerkoperState(null); }}
          style={{ cursor: 'pointer' }}
        >
          Afmelden
        </button>
      </nav>
      <main style={{ padding: 16 }}>
        <Routes>
          <Route index element={<Kassa />} />
          <Route path="verkopen" element={<Verkopen />} />
          {/* Beheerder-menu: enkel voor beheerders (ook als iemand de URL rechtstreeks intikt) */}
          <Route path="dagafsluiting" element={isAdmin ? <Dagafsluiting /> : <div>Enkel voor beheerders.</div>} />
          <Route path="beheer" element={<Beheer />} />
          <Route path="cadeaubonnen" element={<Cadeaubonnen />} />
          <Route path="facturen" element={isAdmin ? <Facturen /> : <div>Enkel voor beheerders.</div>} />
          <Route path="boekhouding" element={isAdmin ? <Boekhouding /> : <div>Enkel voor beheerders.</div>} />
          <Route path="rapporten" element={isAdmin ? <Rapporten /> : <div>Enkel voor beheerders.</div>} />
          <Route path="kortingen" element={isAdmin ? <Kortingen /> : <div>Enkel voor beheerders.</div>} />
          <Route path="webshop-assortiment" element={isAdmin ? <WebshopAssortiment /> : <div>Enkel voor beheerders.</div>} />
          <Route path="bestellingen" element={isAdmin ? <Bestellingen /> : <div>Enkel voor beheerders.</div>} />
          <Route path="rekeningen" element={isAdmin ? <Rekeningen /> : <div>Enkel voor beheerders.</div>} />
          <Route path="personeel" element={isAdmin ? <Personeel /> : <div>Enkel voor beheerders.</div>} />
          <Route path="website" element={isAdmin ? <Website /> : <div>Enkel voor beheerders.</div>} />
          <Route path="instellingen" element={isAdmin ? <Instellingen /> : <div>Enkel voor beheerders.</div>} />
        </Routes>
      </main>
    </>
  );
}

function App() {
  return (
    <BrowserRouter>
      <TestBanner />
      <Routes>
        {/* Publieke website (marché.eu) — geen login */}
        <Route path="/" element={<PublicSite />} />
        <Route path="/webshop" element={<WebshopPubliek />} />
        {/* Bevestigpagina op de telefoon van de beheerder (geheime link uit de pushmelding) */}
        <Route path="/bevestig-afsluiting/:token" element={<BevestigAfsluiting />} />
        {/* Interne personeelsapp achter login */}
        <Route path="/kassa/*" element={<StaffApp />} />
      </Routes>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
