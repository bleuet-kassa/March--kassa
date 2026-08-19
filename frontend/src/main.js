import { jsxs as _jsxs, jsx as _jsx, Fragment as _Fragment } from "react/jsx-runtime";
import React, { useEffect, useState } from 'react';
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
        const t = setInterval(() => { if (navigator.onLine)
            syncQueue().then(ververWachtend); }, 20000);
        return () => {
            window.removeEventListener('online', bij);
            window.removeEventListener('offline', af);
            window.removeEventListener('offline-queue-changed', ververWachtend);
            clearInterval(t);
        };
    }, []);
    return (_jsxs("span", { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }, children: [_jsxs("span", { style: { color: online ? '#16a34a' : '#dc2626' }, children: ["\u25CF ", online ? 'Online' : 'Offline'] }), wachtend > 0 && (_jsxs(_Fragment, { children: [_jsxs("span", { style: { color: '#92400e' }, children: [wachtend, " te synchroniseren"] }), _jsx("button", { onClick: () => syncQueue().then((n) => setWachtend(n)), disabled: !online, style: { cursor: online ? 'pointer' : 'default' }, children: "Synchroniseer" })] }))] }));
}
const isTest = import.meta.env?.VITE_OMGEVING === 'test';
function TestBanner() {
    if (!isTest)
        return null;
    return (_jsx("div", { style: { background: '#b91c1c', color: '#fff', textAlign: 'center', padding: '6px 10px', fontWeight: 700, fontSize: 14 }, children: "\uD83E\uDDEA TESTOMGEVING \u2014 vrij te testen, losstaande data (kassa_test). Niet de echte kassa." }));
}
// Interne personeelsapp (kassa, beheer, rapporten…) achter login, onder /kassa.
function StaffApp() {
    const [verkoper, setVerkoperState] = useState(getVerkoper());
    if (!verkoper) {
        return _jsx(Login, { onIngelogd: () => setVerkoperState(getVerkoper()) });
    }
    const isAdmin = verkoper.rol === 'BEHEERDER' || verkoper.rol === 'BEHEER';
    return (_jsxs(_Fragment, { children: [_jsxs("nav", { style: { padding: 12, borderBottom: '1px solid #ddd', display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }, children: [_jsx("strong", { children: "Kassa & Stock" }), _jsx(Link, { to: "/kassa", children: "Kassa" }), _jsx(Link, { to: "/kassa/verkopen", children: "Verkopen" }), _jsx(Link, { to: "/kassa/dagafsluiting", children: "Dagafsluiting" }), _jsx(Link, { to: "/kassa/beheer", children: "Beheer" }), _jsx(Link, { to: "/kassa/cadeaubonnen", children: "Cadeaubons" }), _jsx(Link, { to: "/kassa/facturen", children: "Facturen" }), _jsx(Link, { to: "/kassa/boekhouding", children: "Boekhouding" }), isAdmin && _jsx(Link, { to: "/kassa/rapporten", children: "Rapporten" }), isAdmin && _jsx(Link, { to: "/kassa/webshop-assortiment", children: "Webshop" }), isAdmin && _jsx(Link, { to: "/kassa/bestellingen", children: "Bestellingen" }), isAdmin && _jsx(Link, { to: "/kassa/rekeningen", children: "Rekeningen" }), isAdmin && _jsx(Link, { to: "/kassa/kortingen", children: "Kortingen" }), isAdmin && _jsx(Link, { to: "/kassa/personeel", children: "Personeel" }), isAdmin && _jsx(Link, { to: "/kassa/website", children: "Website" }), isAdmin && _jsx(Link, { to: "/kassa/instellingen", children: "Instellingen" }), _jsx("span", { style: { marginLeft: 'auto' }, children: _jsx(VerbindingStatus, {}) }), _jsxs("span", { style: { color: '#666' }, children: [verkoper.naam, " (", verkoper.rol, ")"] }), _jsx("button", { onClick: () => { logout(); setVerkoperState(null); }, style: { cursor: 'pointer' }, children: "Afmelden" })] }), _jsx("main", { style: { padding: 16 }, children: _jsxs(Routes, { children: [_jsx(Route, { index: true, element: _jsx(Kassa, {}) }), _jsx(Route, { path: "verkopen", element: _jsx(Verkopen, {}) }), _jsx(Route, { path: "dagafsluiting", element: _jsx(Dagafsluiting, {}) }), _jsx(Route, { path: "beheer", element: _jsx(Beheer, {}) }), _jsx(Route, { path: "cadeaubonnen", element: _jsx(Cadeaubonnen, {}) }), _jsx(Route, { path: "facturen", element: _jsx(Facturen, {}) }), _jsx(Route, { path: "boekhouding", element: _jsx(Boekhouding, {}) }), _jsx(Route, { path: "rapporten", element: isAdmin ? _jsx(Rapporten, {}) : _jsx("div", { children: "Enkel voor beheerders." }) }), _jsx(Route, { path: "kortingen", element: isAdmin ? _jsx(Kortingen, {}) : _jsx("div", { children: "Enkel voor beheerders." }) }), _jsx(Route, { path: "webshop-assortiment", element: isAdmin ? _jsx(WebshopAssortiment, {}) : _jsx("div", { children: "Enkel voor beheerders." }) }), _jsx(Route, { path: "bestellingen", element: isAdmin ? _jsx(Bestellingen, {}) : _jsx("div", { children: "Enkel voor beheerders." }) }), _jsx(Route, { path: "rekeningen", element: isAdmin ? _jsx(Rekeningen, {}) : _jsx("div", { children: "Enkel voor beheerders." }) }), _jsx(Route, { path: "personeel", element: isAdmin ? _jsx(Personeel, {}) : _jsx("div", { children: "Enkel voor beheerders." }) }), _jsx(Route, { path: "website", element: isAdmin ? _jsx(Website, {}) : _jsx("div", { children: "Enkel voor beheerders." }) }), _jsx(Route, { path: "instellingen", element: isAdmin ? _jsx(Instellingen, {}) : _jsx("div", { children: "Enkel voor beheerders." }) })] }) })] }));
}
function App() {
    return (_jsxs(BrowserRouter, { children: [_jsx(TestBanner, {}), _jsxs(Routes, { children: [_jsx(Route, { path: "/", element: _jsx(PublicSite, {}) }), _jsx(Route, { path: "/webshop", element: _jsx(WebshopPubliek, {}) }), _jsx(Route, { path: "/kassa/*", element: _jsx(StaffApp, {}) })] })] }));
}
ReactDOM.createRoot(document.getElementById('root')).render(_jsx(React.StrictMode, { children: _jsx(App, {}) }));
