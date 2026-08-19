import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { getRekeningOverzicht, nieuwRekeningBedrijf, nieuwRekeningLid, getBedrijfVerkopen, factureerBedrijf, } from '../api/client';
const euro = (n) => '€ ' + Number(n ?? 0).toFixed(2);
// Lopende rekeningen: bedrijven met personeelsleden die "op rekening" kopen.
// Overzicht van het openstaande bedrag per bedrijf en per lid, met een
// factureer-knop om de openstaande verkopen af te sluiten (maandfactuur).
export function Rekeningen() {
    const [bedrijven, setBedrijven] = useState([]);
    const [fout, setFout] = useState('');
    const [nieuwNaam, setNieuwNaam] = useState('');
    const [nieuwBtw, setNieuwBtw] = useState('');
    const [nieuwAdres, setNieuwAdres] = useState('');
    const [nieuwEmail, setNieuwEmail] = useState('');
    const [verkopen, setVerkopen] = useState({});
    async function laad() { setBedrijven(await getRekeningOverzicht()); }
    useEffect(() => { laad().catch((e) => setFout(String(e))); }, []);
    async function voegBedrijfToe() {
        if (!nieuwNaam.trim())
            return;
        setFout('');
        try {
            await nieuwRekeningBedrijf({ naam: nieuwNaam.trim(), btwNummer: nieuwBtw.trim() || undefined, adres: nieuwAdres.trim() || undefined, email: nieuwEmail.trim() || undefined });
            setNieuwNaam('');
            setNieuwBtw('');
            setNieuwAdres('');
            setNieuwEmail('');
            await laad();
        }
        catch (e) {
            setFout(e instanceof Error ? e.message : 'Toevoegen mislukt');
        }
    }
    async function voegLidToe(bedrijfId) {
        const naam = window.prompt('Naam van het personeelslid?');
        if (!naam?.trim())
            return;
        const budgetTxt = window.prompt('Maandbudget (optioneel, bv. 150) — leeg = geen budget:', '');
        const budget = budgetTxt && budgetTxt.trim() ? Number(budgetTxt.replace(',', '.')) : undefined;
        try {
            await nieuwRekeningLid({ bedrijfId, naam: naam.trim(), budget: budget && budget > 0 ? budget : undefined });
            await laad();
        }
        catch (e) {
            setFout(e instanceof Error ? e.message : 'Toevoegen mislukt');
        }
    }
    async function toonVerkopen(bedrijfId) {
        if (verkopen[bedrijfId]) {
            setVerkopen((v) => { const k = { ...v }; delete k[bedrijfId]; return k; });
            return;
        }
        const rows = await getBedrijfVerkopen(bedrijfId);
        setVerkopen((v) => ({ ...v, [bedrijfId]: rows }));
    }
    async function factureer(b) {
        if (!window.confirm(`Alle openstaande verkopen van ${b.naam} (${euro(b.openstaand)}) als gefactureerd markeren?`))
            return;
        const r = await factureerBedrijf(b.id);
        window.alert(`${r.aantal} verkopen afgesloten voor een totaal van ${euro(r.totaal)}.`);
        await laad();
        setVerkopen((v) => { const k = { ...v }; delete k[b.id]; return k; });
    }
    const totaalOpenstaand = bedrijven.reduce((s, b) => s + (b.openstaand ?? 0), 0);
    return (_jsxs("div", { style: { maxWidth: 860 }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'baseline', gap: 12 }, children: [_jsx("h2", { style: { margin: 0 }, children: "Lopende rekeningen" }), _jsxs("span", { style: { color: '#6b7280' }, children: ["Totaal openstaand: ", _jsx("strong", { children: euro(totaalOpenstaand) })] })] }), _jsx("p", { style: { color: '#6b7280', marginTop: 4 }, children: "Bedrijven waarvan personeelsleden \"op rekening\" kopen. Op het einde van de maand factureer je het openstaande bedrag." }), fout && _jsx("p", { style: { color: 'crimson' }, children: fout }), _jsxs("div", { style: { border: '1px solid #e5e7eb', borderRadius: 10, padding: 14, margin: '12px 0 20px', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }, children: [_jsxs("div", { children: [_jsx("div", { style: muted, children: "Bedrijf" }), _jsx("input", { value: nieuwNaam, onChange: (e) => setNieuwNaam(e.target.value), style: { ...inp, width: 180 } })] }), _jsxs("div", { children: [_jsx("div", { style: muted, children: "BTW-nummer" }), _jsx("input", { value: nieuwBtw, onChange: (e) => setNieuwBtw(e.target.value), placeholder: "BE0...", style: { ...inp, width: 140 } })] }), _jsxs("div", { children: [_jsx("div", { style: muted, children: "Adres" }), _jsx("input", { value: nieuwAdres, onChange: (e) => setNieuwAdres(e.target.value), style: { ...inp, width: 180 } })] }), _jsxs("div", { children: [_jsx("div", { style: muted, children: "E-mail" }), _jsx("input", { value: nieuwEmail, onChange: (e) => setNieuwEmail(e.target.value), style: { ...inp, width: 160 } })] }), _jsx("button", { onClick: voegBedrijfToe, style: btnBlauw, children: "Bedrijf toevoegen" })] }), bedrijven.map((b) => (_jsxs("div", { style: { border: '1px solid #e5e7eb', borderRadius: 12, padding: 16, marginBottom: 12 }, children: [_jsxs("div", { style: { display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }, children: [_jsxs("div", { style: { flex: 1, minWidth: 200 }, children: [_jsx("div", { style: { fontWeight: 700, fontSize: 16 }, children: b.naam }), _jsxs("div", { style: { fontSize: 12, color: '#6b7280' }, children: [b.btwNummer ?? '', b.email ? ` · ${b.email}` : ''] })] }), _jsxs("div", { style: { textAlign: 'right' }, children: [_jsx("div", { style: { fontSize: 12, color: '#6b7280' }, children: "Openstaand" }), _jsx("div", { style: { fontWeight: 700, fontSize: 18, color: (b.openstaand ?? 0) > 0 ? '#b45309' : '#166534' }, children: euro(b.openstaand) })] }), _jsx("button", { onClick: () => toonVerkopen(b.id), style: btnMini, children: verkopen[b.id] ? 'Verberg' : 'Verkopen' }), _jsx("button", { onClick: () => factureer(b), disabled: (b.openstaand ?? 0) <= 0, style: { ...btnBlauw, opacity: (b.openstaand ?? 0) <= 0 ? 0.5 : 1 }, children: "Factureren" })] }), _jsxs("div", { style: { marginTop: 10, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }, children: [b.leden.map((l) => (_jsxs("div", { style: { border: '1px solid #f0f0f0', borderRadius: 8, padding: '8px 10px', opacity: l.actief === false ? 0.5 : 1 }, children: [_jsx("div", { style: { fontWeight: 600 }, children: l.naam }), _jsxs("div", { style: { fontSize: 13, color: '#374151' }, children: ["Verbruikt: ", _jsx("strong", { children: euro(l.verbruikt) }), l.budget != null && _jsxs(_Fragment, { children: [" / budget ", euro(l.budget), (l.verbruikt ?? 0) > l.budget && _jsx("span", { style: { color: 'crimson' }, children: " \u26A0" })] })] })] }, l.id))), _jsx("button", { onClick: () => voegLidToe(b.id), style: { ...btnMini, border: '1px dashed #94a3b8', color: '#2563eb' }, children: "+ Personeelslid" })] }), verkopen[b.id] && (_jsxs("table", { style: { width: '100%', borderCollapse: 'collapse', marginTop: 10, fontSize: 13 }, children: [_jsx("thead", { children: _jsxs("tr", { style: { textAlign: 'left', color: '#6b7280', borderBottom: '1px solid #eee' }, children: [_jsx("th", { style: { padding: 4 }, children: "Datum" }), _jsx("th", { style: { padding: 4 }, children: "Lid" }), _jsx("th", { style: { padding: 4 }, children: "Artikels" }), _jsx("th", { style: { padding: 4, textAlign: 'right' }, children: "Bedrag" })] }) }), _jsxs("tbody", { children: [verkopen[b.id].map((v) => (_jsxs("tr", { style: { borderBottom: '1px solid #f5f5f5' }, children: [_jsx("td", { style: { padding: 4 }, children: new Date(v.datum).toLocaleString('nl-BE') }), _jsx("td", { style: { padding: 4 }, children: v.lid ?? '-' }), _jsx("td", { style: { padding: 4, color: '#6b7280' }, children: v.artikels.join(' · ') }), _jsx("td", { style: { padding: 4, textAlign: 'right' }, children: euro(v.totaal) })] }, v.id))), verkopen[b.id].length === 0 && _jsx("tr", { children: _jsx("td", { colSpan: 4, style: { padding: 8, color: '#999' }, children: "Geen openstaande verkopen." }) })] })] }))] }, b.id))), bedrijven.length === 0 && _jsx("p", { style: { color: '#999' }, children: "Nog geen bedrijven. Voeg er hierboven een toe." })] }));
}
const inp = { padding: 8, fontSize: 14, boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 6 };
const muted = { fontSize: 12, color: '#6b7280', marginBottom: 2 };
const btnBlauw = { padding: '9px 16px', border: 'none', borderRadius: 6, background: '#0d4589', color: '#fff', cursor: 'pointer', fontWeight: 600 };
const btnMini = { padding: '6px 12px', border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 13 };
