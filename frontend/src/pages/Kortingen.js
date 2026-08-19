import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { getKortingsregelingen, nieuweKortingsregeling, getBegunstigden, nieuweBegunstigde, verwijderBegunstigde, } from '../api/client';
// Beheer van kortingsregelingen (personeel / friends & family) en het
// e-mailregister van begunstigden. Dat register bereidt ook de webshop voor:
// een ingelogd e-mailadres krijgt daar later automatisch zijn korting.
export function Kortingen() {
    const [regelingen, setRegelingen] = useState([]);
    const [begunstigden, setBegunstigden] = useState([]);
    const [zoek, setZoek] = useState('');
    const [fout, setFout] = useState('');
    // Nieuwe regeling
    const [rNaam, setRNaam] = useState('');
    const [rPct, setRPct] = useState('');
    // Nieuwe begunstigde
    const [bEmail, setBEmail] = useState('');
    const [bNaam, setBNaam] = useState('');
    const [bRegeling, setBRegeling] = useState('');
    async function laadRegelingen() { setRegelingen(await getKortingsregelingen()); }
    async function laadBegunstigden() { setBegunstigden(await getBegunstigden(zoek)); }
    useEffect(() => { laadRegelingen(); }, []);
    useEffect(() => { const t = setTimeout(laadBegunstigden, 150); return () => clearTimeout(t); }, [zoek]);
    async function voegRegelingToe() {
        setFout('');
        const pct = Number(rPct.replace(',', '.'));
        if (!rNaam.trim() || !(pct > 0 && pct <= 100)) {
            setFout('Geef een naam en een percentage (1-100).');
            return;
        }
        try {
            await nieuweKortingsregeling({ naam: rNaam.trim(), pct });
            setRNaam('');
            setRPct('');
            await laadRegelingen();
        }
        catch (e) {
            setFout(e instanceof Error ? e.message : 'Mislukt');
        }
    }
    async function voegBegunstigdeToe() {
        setFout('');
        if (!bEmail.trim() || !bRegeling) {
            setFout('Geef een e-mailadres en kies een regeling.');
            return;
        }
        try {
            await nieuweBegunstigde({ email: bEmail.trim(), naam: bNaam.trim() || undefined, regelingId: bRegeling });
            setBEmail('');
            setBNaam('');
            await laadBegunstigden();
        }
        catch (e) {
            setFout(e instanceof Error ? e.message : 'Mislukt');
        }
    }
    async function schrap(id) {
        await verwijderBegunstigde(id);
        await laadBegunstigden();
    }
    return (_jsxs("div", { style: { maxWidth: 860 }, children: [_jsx("h2", { children: "Kortingen" }), fout && _jsx("p", { style: { color: 'crimson' }, children: fout }), _jsx("h3", { style: { marginBottom: 8 }, children: "Regelingen" }), _jsxs("div", { style: { display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }, children: [_jsxs("div", { children: [_jsx("div", { style: muted, children: "Naam" }), _jsx("input", { value: rNaam, onChange: (e) => setRNaam(e.target.value), placeholder: "bv. Personeel", style: { ...inp, width: 180 } })] }), _jsxs("div", { children: [_jsx("div", { style: muted, children: "Percentage" }), _jsx("input", { value: rPct, onChange: (e) => setRPct(e.target.value), inputMode: "decimal", placeholder: "20", style: { ...inp, width: 80 } })] }), _jsx("button", { onClick: voegRegelingToe, style: btnBlauw, children: "Toevoegen" })] }), _jsxs("div", { style: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 24 }, children: [regelingen.map((r) => (_jsxs("span", { style: { padding: '6px 12px', borderRadius: 20, background: '#eff6ff', border: '1px solid #c7d2fe', fontSize: 14 }, children: [r.naam, " \u2014 ", _jsxs("strong", { children: [Number(r.pct), "%"] })] }, r.id))), regelingen.length === 0 && _jsx("span", { style: { color: '#999' }, children: "Nog geen regelingen." })] }), _jsx("h3", { style: { marginBottom: 8 }, children: "E-mailregister (begunstigden)" }), _jsxs("div", { style: { display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }, children: [_jsxs("div", { children: [_jsx("div", { style: muted, children: "E-mailadres" }), _jsx("input", { value: bEmail, onChange: (e) => setBEmail(e.target.value), placeholder: "naam@voorbeeld.be", style: { ...inp, width: 220 } })] }), _jsxs("div", { children: [_jsx("div", { style: muted, children: "Naam (optioneel)" }), _jsx("input", { value: bNaam, onChange: (e) => setBNaam(e.target.value), style: { ...inp, width: 160 } })] }), _jsxs("div", { children: [_jsx("div", { style: muted, children: "Regeling" }), _jsxs("select", { value: bRegeling, onChange: (e) => setBRegeling(e.target.value), style: { ...inp, width: 180 }, children: [_jsx("option", { value: "", children: "Kies\u2026" }), regelingen.map((r) => _jsxs("option", { value: r.id, children: [r.naam, " (", Number(r.pct), "%)"] }, r.id))] })] }), _jsx("button", { onClick: voegBegunstigdeToe, style: btnBlauw, children: "Toevoegen" })] }), _jsx("input", { value: zoek, onChange: (e) => setZoek(e.target.value), placeholder: "Zoek op e-mail of naam\u2026", style: { ...inp, maxWidth: 260 } }), _jsxs("table", { style: { width: '100%', borderCollapse: 'collapse', fontSize: 14 }, children: [_jsx("thead", { children: _jsxs("tr", { style: { textAlign: 'left', borderBottom: '1px solid #ddd', fontSize: 12, color: '#666' }, children: [_jsx("th", { style: { padding: 6 }, children: "E-mail" }), _jsx("th", { style: { padding: 6 }, children: "Naam" }), _jsx("th", { style: { padding: 6 }, children: "Regeling" }), _jsx("th", {})] }) }), _jsxs("tbody", { children: [begunstigden.map((b) => (_jsxs("tr", { style: { borderBottom: '1px solid #f0f0f0' }, children: [_jsx("td", { style: { padding: 6, fontFamily: 'monospace' }, children: b.email }), _jsx("td", { style: { padding: 6 }, children: b.naam ?? '' }), _jsx("td", { style: { padding: 6 }, children: b.regeling ? `${b.regeling.naam} (${Number(b.regeling.pct)}%)` : '' }), _jsx("td", { style: { padding: 6, textAlign: 'right' }, children: _jsx("button", { onClick: () => schrap(b.id), style: { ...btnMini, color: 'crimson' }, children: "Verwijderen" }) })] }, b.id))), begunstigden.length === 0 && _jsx("tr", { children: _jsx("td", { colSpan: 4, style: { padding: 16, color: '#999' }, children: "Nog geen begunstigden." }) })] })] })] }));
}
const inp = { padding: 8, fontSize: 14, boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 6, marginBottom: 8 };
const muted = { fontSize: 12, color: '#6b7280', marginBottom: 2 };
const btnBlauw = { padding: '9px 16px', border: 'none', borderRadius: 6, background: '#2563eb', color: '#fff', cursor: 'pointer', fontWeight: 600 };
const btnMini = { padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 5, background: '#fff', cursor: 'pointer', fontSize: 13 };
