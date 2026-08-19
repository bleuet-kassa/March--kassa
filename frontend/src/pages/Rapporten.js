import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from 'react';
import { getMaandoverzicht, getCategorieRapport, getKassaVsFacturen, } from '../api/client';
const euro = (n) => '€ ' + Number(n).toFixed(2);
const MAAND = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
// Managementrapporten (enkel admins): maandoverzicht om jaren te vergelijken,
// en per productcategorie omzet, aandeel en marge.
export function Rapporten() {
    const [maanden, setMaanden] = useState([]);
    const jaarNu = new Date().getFullYear();
    const [van, setVan] = useState(`${jaarNu}-01-01`);
    const [tot, setTot] = useState(new Date().toISOString().slice(0, 10));
    const [cat, setCat] = useState(null);
    const [kf, setKf] = useState(null);
    useEffect(() => { getMaandoverzicht().then(setMaanden); }, []);
    useEffect(() => {
        getCategorieRapport(van, tot + 'T23:59:59').then(setCat);
        getKassaVsFacturen(van, tot + 'T23:59:59').then(setKf);
    }, [van, tot]);
    // Pivot: rijen = maanden, kolommen = jaren.
    const { jaren, cel, jaarTotaal } = useMemo(() => {
        const jaren = [...new Set(maanden.map((m) => m.jaar))].sort();
        const cel = {};
        const jaarTotaal = {};
        for (const m of maanden) {
            cel[`${m.jaar}-${m.maand}`] = m.omzetIncl;
            jaarTotaal[m.jaar] = (jaarTotaal[m.jaar] ?? 0) + m.omzetIncl;
        }
        return { jaren, cel, jaarTotaal };
    }, [maanden]);
    return (_jsxs("div", { style: { maxWidth: 900 }, children: [_jsx("h2", { children: "Rapporten" }), _jsx("h3", { children: "Maandoverzicht (omzet incl. BTW) \u2014 jaren vergelijken" }), jaren.length === 0 ? _jsx("p", { style: { color: '#999' }, children: "Nog geen omzetgegevens." }) : (_jsx("div", { style: { overflowX: 'auto' }, children: _jsxs("table", { style: { borderCollapse: 'collapse', fontSize: 14, minWidth: 360 }, children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { style: th, children: "Maand" }), jaren.map((j) => _jsx("th", { style: { ...th, textAlign: 'right' }, children: j }, j))] }) }), _jsxs("tbody", { children: [MAAND.map((naam, i) => (_jsxs("tr", { style: { borderBottom: '1px solid #f0f0f0' }, children: [_jsx("td", { style: { padding: '4px 8px' }, children: naam }), jaren.map((j) => {
                                            const v = cel[`${j}-${i + 1}`];
                                            return _jsx("td", { style: { padding: '4px 8px', textAlign: 'right', color: v ? '#111' : '#ccc' }, children: v ? euro(v) : '—' }, j);
                                        })] }, naam))), _jsxs("tr", { style: { borderTop: '2px solid #ddd', fontWeight: 700 }, children: [_jsx("td", { style: { padding: '4px 8px' }, children: "Totaal" }), jaren.map((j) => _jsx("td", { style: { padding: '4px 8px', textAlign: 'right' }, children: euro(jaarTotaal[j] ?? 0) }, j))] })] })] }) })), _jsx("h3", { style: { marginTop: 28 }, children: "Per categorie \u2014 omzet, aandeel & marge" }), _jsxs("div", { style: { display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 10, flexWrap: 'wrap' }, children: [_jsxs("label", { style: { fontSize: 13, color: '#666' }, children: ["Van ", _jsx("input", { type: "date", value: van, onChange: (e) => setVan(e.target.value), style: inp })] }), _jsxs("label", { style: { fontSize: 13, color: '#666' }, children: ["Tot ", _jsx("input", { type: "date", value: tot, onChange: (e) => setTot(e.target.value), style: inp })] }), _jsx("button", { onClick: () => { setVan(`${jaarNu}-01-01`); setTot(new Date().toISOString().slice(0, 10)); }, style: btn, children: "Dit jaar" }), _jsx("button", { onClick: () => { const d = new Date(); setVan(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`); setTot(new Date().toISOString().slice(0, 10)); }, style: btn, children: "Deze maand" })] }), kf && (_jsxs("div", { style: { display: 'flex', gap: 16, marginBottom: 14, flexWrap: 'wrap' }, children: [_jsxs("div", { style: kaart, children: [_jsx("div", { style: { fontSize: 12, color: '#6b7280' }, children: "Kassaverkopen (particulier)" }), _jsx("div", { style: { fontSize: 22, fontWeight: 700 }, children: euro(kf.kasticket.omzetIncl) }), _jsxs("div", { style: { fontSize: 12, color: '#6b7280' }, children: [kf.kasticket.aantal, " tickets \u00B7 incl. BTW"] })] }), _jsxs("div", { style: kaart, children: [_jsx("div", { style: { fontSize: 12, color: '#6b7280' }, children: "Facturen (B2B)" }), _jsx("div", { style: { fontSize: 22, fontWeight: 700 }, children: euro(kf.facturen.omzetIncl) }), _jsxs("div", { style: { fontSize: 12, color: '#6b7280' }, children: [kf.facturen.aantal, " facturen \u00B7 incl. BTW"] })] })] })), cat && (_jsx("div", { style: { overflowX: 'auto' }, children: _jsxs("table", { style: { borderCollapse: 'collapse', fontSize: 14, width: '100%', minWidth: 560 }, children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { style: th, children: "Categorie" }), _jsx("th", { style: { ...th, textAlign: 'right' }, children: "Omzet (excl.)" }), _jsx("th", { style: { ...th, textAlign: 'right' }, children: "Aandeel" }), _jsx("th", { style: { ...th, textAlign: 'right' }, children: "Inkoop" }), _jsx("th", { style: { ...th, textAlign: 'right' }, children: "Marge \u20AC" }), _jsx("th", { style: { ...th, textAlign: 'right' }, children: "Marge %" })] }) }), _jsxs("tbody", { children: [cat.categorieen.map((c) => (_jsxs("tr", { style: { borderBottom: '1px solid #f0f0f0' }, children: [_jsx("td", { style: { padding: '5px 8px' }, children: c.categorie }), _jsx("td", { style: { padding: '5px 8px', textAlign: 'right' }, children: euro(c.omzetExcl) }), _jsxs("td", { style: { padding: '5px 8px', textAlign: 'right' }, children: [c.aandeelPct.toFixed(1), "%"] }), _jsx("td", { style: { padding: '5px 8px', textAlign: 'right', color: '#666' }, children: euro(c.inkoop) }), _jsx("td", { style: { padding: '5px 8px', textAlign: 'right' }, children: euro(c.marge) }), _jsxs("td", { style: { padding: '5px 8px', textAlign: 'right', color: c.margePct < 0 ? 'crimson' : '#166534' }, children: [c.margePct.toFixed(1), "%"] })] }, c.categorie))), cat.categorieen.length === 0 && _jsx("tr", { children: _jsx("td", { colSpan: 6, style: { padding: 12, color: '#999' }, children: "Geen verkopen in deze periode." }) }), cat.categorieen.length > 0 && (_jsxs("tr", { style: { borderTop: '2px solid #ddd', fontWeight: 700 }, children: [_jsx("td", { style: { padding: '5px 8px' }, children: "Totaal" }), _jsx("td", { style: { padding: '5px 8px', textAlign: 'right' }, children: euro(cat.totaal.omzetExcl) }), _jsx("td", { style: { padding: '5px 8px', textAlign: 'right' }, children: "100%" }), _jsx("td", { style: { padding: '5px 8px', textAlign: 'right' }, children: euro(cat.totaal.inkoop) }), _jsx("td", { style: { padding: '5px 8px', textAlign: 'right' }, children: euro(cat.totaal.marge) }), _jsxs("td", { style: { padding: '5px 8px', textAlign: 'right' }, children: [cat.totaal.margePct.toFixed(1), "%"] })] }))] })] }) }))] }));
}
const th = { padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid #ddd', fontSize: 12, color: '#666' };
const inp = { padding: 6, border: '1px solid #cbd5e1', borderRadius: 6, marginLeft: 4 };
const btn = { padding: '7px 12px', border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 13 };
const kaart = { border: '1px solid #e5e7eb', borderRadius: 10, padding: '12px 16px', minWidth: 200 };
