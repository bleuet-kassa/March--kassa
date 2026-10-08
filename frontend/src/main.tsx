import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import './touchscroll';
import './mobile.css'; // smartphone-weergave (compacte navigatie, scrollende tabellen, grotere tikdoelen)
import { Kassa } from './pages/Kassa';
import { Verkopen } from './pages/Verkopen';
import { Dagafsluiting } from './pages/Dagafsluiting';
import { Beheer } from './pages/Beheer';
import { Facturen } from './pages/Facturen';
import { Boekhouding } from './pages/Boekhouding';
import { Rapporten } from './pages/Rapporten';
import { Cadeaubonnen } from './pages/Cadeaubonnen';
import { OpenRekeningen } from './pages/OpenRekeningen';
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
import { getVerkoper, logout, zetVerkoper } from './auth';
import { heeftRecht, isAdminRol } from './rechten';
import { getIk } from './api/client';
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

  // Toegangen verversen bij het openen van de app, zodat een wijziging op het
  // Personeel-scherm meteen geldt zonder opnieuw in te loggen.
  useEffect(() => {
    if (!verkoper) return;
    getIk().then((ik) => { zetVerkoper(ik); setVerkoperState(getVerkoper()); }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verkoper?.id]);

  if (!verkoper) {
    return <Login onIngelogd={() => setVerkoperState(getVerkoper())} />;
  }
  const isAdmin = isAdminRol(verkoper.rol);
  // Wat deze persoon mag zien: per functionaliteit (beheerder = alles).
  const mag = (key: string) => heeftRecht(key);
  const geenToegang = <div style={{ padding: 24, color: '#6b7280' }}>Je hebt geen toegang tot dit onderdeel. Vraag de beheerder om je toegangen aan te passen (Beheerder → Personeel).</div>;
  const menuItems = ([
    ['/kassa/dagafsluiting', 'Dagafsluiting', 'dagafsluiting'],
    ['/kassa/facturen', 'Facturen inlezen', 'facturen'],
    ['/kassa/boekhouding', 'Boekhouding', 'boekhouding'],
    ['/kassa/rapporten', 'Rapporten', 'rapporten'],
    ['/kassa/rekeningen', 'Klant factuur', 'rekeningen'],
    ['/kassa/personeel', 'Personeel', 'personeel'],
    ['/kassa/instellingen', 'Instellingen', 'instellingen'],
  ] as [string, string, string][]).filter(([, , key]) => mag(key));

  return (
    <>
      <nav style={{ padding: 12, borderBottom: '1px solid #ddd', display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <strong>Kassa & Stock</strong>
        {mag('kassa') && <Link to="/kassa">Kassa</Link>}
        {mag('verkopen') && <Link to="/kassa/verkopen">Verkopen</Link>}
        {mag('beheer') && <Link to="/kassa/beheer">Beheer</Link>}
        {mag('cadeaubonnen') && <Link to="/kassa/cadeaubonnen">Cadeaubons</Link>}
        {mag('open_rekeningen') && <Link to="/kassa/open-rekeningen">Open rekeningen</Link>}
        {mag('webshop') && <Link to="/kassa/webshop-assortiment">Webshop</Link>}
        {mag('webshop') && <Link to="/kassa/bestellingen">Bestellingen</Link>}
        {mag('kortingen') && <Link to="/kassa/kortingen">Kortingen</Link>}
        {mag('website') && <Link to="/kassa/website">Website</Link>}
        {menuItems.length > 0 && (
          /* Beheer-menu: enkel de onderdelen waartoe deze persoon toegang heeft. */
          <details ref={menuRef} style={{ position: 'relative' }}>
            <summary style={{ cursor: 'pointer', listStyle: 'none', fontWeight: 700, color: '#0d4589', userSelect: 'none', padding: '4px 8px', border: '1px solid #cbd5e1', borderRadius: 6 }}>
              {isAdmin ? 'Beheerder' : 'Meer'} ▾
            </summary>
            <div style={{ position: 'absolute', top: '100%', left: 0, zIndex: 50, marginTop: 6, background: '#fff', border: '1px solid #cbd5e1', borderRadius: 8, boxShadow: '0 6px 20px rgba(0,0,0,.12)', padding: 6, display: 'flex', flexDirection: 'column', minWidth: 200 }}>
              {menuItems.map(([pad, naam]) => (
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
          {/* Elke route is afgeschermd per toegang (ook als iemand de URL rechtstreeks intikt); de server dwingt het ook af. */}
          <Route index element={mag('kassa') ? <Kassa /> : (mag('open_rekeningen') ? <OpenRekeningen /> : geenToegang)} />
          <Route path="verkopen" element={mag('verkopen') ? <Verkopen /> : geenToegang} />
          <Route path="dagafsluiting" element={mag('dagafsluiting') ? <Dagafsluiting /> : geenToegang} />
          <Route path="beheer" element={mag('beheer') ? <Beheer /> : geenToegang} />
          <Route path="cadeaubonnen" element={mag('cadeaubonnen') ? <Cadeaubonnen /> : geenToegang} />
          <Route path="open-rekeningen" element={mag('open_rekeningen') ? <OpenRekeningen /> : geenToegang} />
          <Route path="facturen" element={mag('facturen') ? <Facturen /> : geenToegang} />
          <Route path="boekhouding" element={mag('boekhouding') ? <Boekhouding /> : geenToegang} />
          <Route path="rapporten" element={mag('rapporten') ? <Rapporten /> : geenToegang} />
          <Route path="kortingen" element={mag('kortingen') ? <Kortingen /> : geenToegang} />
          <Route path="webshop-assortiment" element={mag('webshop') ? <WebshopAssortiment /> : geenToegang} />
          <Route path="bestellingen" element={mag('webshop') ? <Bestellingen /> : geenToegang} />
          <Route path="rekeningen" element={mag('rekeningen') ? <Rekeningen /> : geenToegang} />
          <Route path="personeel" element={mag('personeel') ? <Personeel /> : geenToegang} />
          <Route path="website" element={mag('website') ? <Website /> : geenToegang} />
          <Route path="instellingen" element={mag('instellingen') ? <Instellingen /> : geenToegang} />
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
