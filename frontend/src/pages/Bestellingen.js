import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { getBestellingen, updateBestellingStatus } from '../api/client';
const STATUSSEN = ['NIEUW', 'IN_BEHANDELING', 'KLAAR', 'AFGEHAALD', 'GELEVERD', 'GEANNULEERD'];
const euro = (n) => '€ ' + Number(n).toFixed(2);
const kleur = {
    NIEUW: '#b45309', IN_BEHANDELING: '#2563eb', KLAAR: '#16a34a', AFGEHAALD: '#6b7280', GELEVERD: '#6b7280', GEANNULEERD: '#b91c1c',
};
// Beheer van webshop-bestellingen: bekijken en de status opvolgen.
export function Bestellingen() {
    const [lijst, setLijst] = useState([]);
    const [filter, setFilter] = useState('');
    async function laad() { setLijst(await getBestellingen()); }
    useEffect(() => { laad(); }, []);
    async function zetStatus(id, status) {
        await updateBestellingStatus(id, status);
        setLijst((l) => l.map((o) => (o.id === id ? { ...o, status } : o)));
    }
    const zichtbaar = filter ? lijst.filter((o) => (o.status ?? 'NIEUW') === filter) : lijst;
    const nieuw = lijst.filter((o) => (o.status ?? 'NIEUW') === 'NIEUW').length;
    return (_jsxs("div", { style: { maxWidth: 900 }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'baseline', gap: 12 }, children: [_jsx("h2", { style: { margin: 0 }, children: "Bestellingen" }), nieuw > 0 && _jsxs("span", { style: { background: '#fef3c7', color: '#b45309', padding: '2px 10px', borderRadius: 999, fontWeight: 600, fontSize: 13 }, children: [nieuw, " nieuw"] })] }), _jsxs("div", { style: { display: 'flex', gap: 6, flexWrap: 'wrap', margin: '12px 0' }, children: [_jsx("button", { onClick: () => setFilter(''), style: chip(filter === ''), children: "Alle" }), STATUSSEN.map((s) => _jsx("button", { onClick: () => setFilter(s), style: chip(filter === s), children: s.replace('_', ' ').toLowerCase() }, s))] }), zichtbaar.length === 0 && _jsx("p", { style: { color: '#999' }, children: "Geen bestellingen." }), zichtbaar.map((o) => (_jsxs("div", { style: { border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, marginBottom: 12 }, children: [_jsxs("div", { style: { display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }, children: [_jsxs("div", { style: { flex: 1, minWidth: 200 }, children: [_jsx("div", { style: { fontWeight: 700 }, children: o.klant?.naam ?? 'Onbekende klant' }), _jsxs("div", { style: { fontSize: 13, color: '#6b7280' }, children: [o.klant?.email ?? '', " \u00B7 ", new Date(o.datum).toLocaleString('nl-BE')] })] }), _jsx("span", { style: { padding: '4px 10px', borderRadius: 8, background: '#f3f4f6', fontSize: 13 }, children: o.leverwijze === 'LEVEREN' ? '🚚 Leveren' : '🏬 Afhalen' }), _jsx("span", { style: { padding: '4px 10px', borderRadius: 8, fontSize: 13, fontWeight: 600, background: o.betaald ? '#dcfce7' : '#fef3c7', color: o.betaald ? '#166534' : '#b45309' }, children: o.betaald ? '✓ Betaald' : 'Nog te betalen' }), _jsx("strong", { children: euro(o.totaal) }), _jsx("select", { value: o.status ?? 'NIEUW', onChange: (e) => zetStatus(o.id, e.target.value), style: { ...inp, marginBottom: 0, fontWeight: 600, color: kleur[o.status ?? 'NIEUW'] ?? '#111' }, children: STATUSSEN.map((s) => _jsx("option", { value: s, children: s.replace('_', ' ') }, s)) })] }), o.leverwijze === 'LEVEREN' && o.klant?.adres && (_jsxs("div", { style: { fontSize: 13, color: '#374151', marginTop: 8 }, children: ["\uD83D\uDCCD ", o.klant.adres] })), _jsx("div", { style: { marginTop: 10, fontSize: 14, color: '#374151' }, children: o.lijnen.map((l, i) => (_jsxs("span", { children: [Number(l.aantal), "\u00D7 ", l.product.naam, i < o.lijnen.length - 1 ? ' · ' : ''] }, i))) }), o.kortingReden && _jsxs("div", { style: { fontSize: 13, color: '#0d4589', marginTop: 6 }, children: ["Korting: ", o.kortingReden] })] }, o.id)))] }));
}
const inp = { padding: 8, fontSize: 14, boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 6, marginBottom: 8 };
function chip(actief) {
    return { padding: '6px 12px', borderRadius: 20, cursor: 'pointer', fontSize: 13, border: actief ? '2px solid #0d4589' : '1px solid #cbd5e1', background: actief ? '#eff6ff' : '#fff', fontWeight: actief ? 600 : 400 };
}
