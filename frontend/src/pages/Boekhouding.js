import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { getScradaStatus, getScradaOpenstaande, getScradaPreview, scradaVerstuurEen, scradaVerstuurAlles, } from '../api/client';
// Boekhouding (Fase 3): verkopen "Scrada-klaar" doorsturen (facturen/kasboek/
// Peppol). Zonder API-sleutel draait alles in TESTMODUS (dry-run).
export function Boekhouding() {
    const [status, setStatus] = useState(null);
    const [open, setOpen] = useState([]);
    const [preview, setPreview] = useState(null);
    const [melding, setMelding] = useState('');
    const [bezig, setBezig] = useState(false);
    async function laad() {
        setStatus(await getScradaStatus());
        setOpen(await getScradaOpenstaande());
    }
    useEffect(() => { laad(); }, []);
    async function toon(id) {
        setPreview(await getScradaPreview(id));
    }
    async function verstuurEen(id) {
        setBezig(true);
        setMelding('');
        const res = await scradaVerstuurEen(id);
        setMelding(res.modus === 'test'
            ? 'Testmodus: dit zou naar Scrada gaan (niets echt verstuurd).'
            : res.verstuurd ? `Verstuurd (ref ${res.scradaRef}).` : `Fout: ${res.fout}`);
        await laad();
        setBezig(false);
    }
    async function verstuurAlles() {
        setBezig(true);
        setMelding('');
        const res = await scradaVerstuurAlles();
        setMelding(`${res.modus === 'test' ? 'Testmodus — ' : ''}${res.gevonden} gevonden, ${res.verstuurd} verstuurd${res.mislukt ? `, ${res.mislukt} mislukt` : ''}.`);
        await laad();
        setBezig(false);
    }
    const euro = (n) => '€ ' + Number(n).toFixed(2);
    return (_jsxs("div", { style: { maxWidth: 1000, display: 'flex', gap: 24, flexWrap: 'wrap' }, children: [_jsxs("div", { style: { flex: '1 1 440px' }, children: [_jsx("h2", { children: "Boekhouding \u2014 Scrada" }), status && (_jsxs("div", { style: { marginBottom: 12 }, children: [_jsx("span", { style: {
                                    padding: '3px 10px', borderRadius: 99, fontSize: 13, fontWeight: 600,
                                    background: status.modus === 'live' ? '#dcfce7' : '#fef3c7',
                                    color: status.modus === 'live' ? '#166534' : '#92400e',
                                }, children: status.modus === 'live' ? '● Live (Scrada gekoppeld)' : '● Testmodus (geen API-sleutel)' }), _jsxs("div", { style: { marginTop: 10, display: 'flex', gap: 16, fontSize: 14 }, children: [_jsxs("span", { children: ["Nog te versturen: ", _jsx("strong", { children: status.NIET_VERSTUURD })] }), _jsxs("span", { style: { color: '#166534' }, children: ["Verstuurd: ", status.VERSTUURD] }), status.FOUT > 0 && _jsxs("span", { style: { color: 'crimson' }, children: ["Fout: ", status.FOUT] })] })] })), _jsx("button", { onClick: verstuurAlles, disabled: bezig || !open.length, style: { padding: '10px 16px', border: 'none', borderRadius: 8, background: open.length ? '#2563eb' : '#9ca3af', color: '#fff', fontWeight: 700, cursor: open.length ? 'pointer' : 'default' }, children: bezig ? 'Bezig…' : `Alle openstaande versturen (${open.length})` }), melding && _jsx("p", { style: { color: '#374151', background: '#f3f4f6', padding: '8px 12px', borderRadius: 8 }, children: melding }), _jsxs("table", { style: { width: '100%', borderCollapse: 'collapse', marginTop: 8, fontSize: 14 }, children: [_jsx("thead", { children: _jsxs("tr", { style: { textAlign: 'left', borderBottom: '1px solid #ddd', fontSize: 12, color: '#666' }, children: [_jsx("th", { style: { padding: 4 }, children: "Datum" }), _jsx("th", { style: { padding: 4 }, children: "Klant" }), _jsx("th", { style: { padding: 4, textAlign: 'right' }, children: "Totaal" }), _jsx("th", { style: { padding: 4 }, children: "Status" }), _jsx("th", {})] }) }), _jsxs("tbody", { children: [open.map((v) => (_jsxs("tr", { style: { borderBottom: '1px solid #f0f0f0' }, children: [_jsx("td", { style: { padding: 4 }, children: new Date(v.datum).toLocaleString('nl-BE') }), _jsx("td", { style: { padding: 4 }, children: v.klant?.naam ?? 'Particulier (kasticket)' }), _jsx("td", { style: { padding: 4, textAlign: 'right' }, children: euro(v.totaal) }), _jsx("td", { style: { padding: 4 }, children: v.scradaStatus === 'FOUT' ? _jsx("span", { style: { color: 'crimson' }, children: "fout" }) : 'open' }), _jsxs("td", { style: { padding: 4, whiteSpace: 'nowrap' }, children: [_jsx("button", { onClick: () => toon(v.id), style: btn, children: "Bekijk" }), ' ', _jsx("button", { onClick: () => verstuurEen(v.id), disabled: bezig, style: btn, children: "Verstuur" })] })] }, v.id))), open.length === 0 && _jsx("tr", { children: _jsx("td", { colSpan: 5, style: { padding: 16, color: '#999' }, children: "Niets openstaand \u2014 alles is verstuurd." }) })] })] })] }), preview && (_jsx("div", { style: { flex: '1 1 320px' }, children: _jsxs("div", { style: { border: '1px solid #ddd', borderRadius: 10, padding: 16 }, children: [_jsx("h3", { style: { marginTop: 0 }, children: "Scrada-payload" }), _jsxs("div", { style: { fontSize: 13, color: '#555', marginBottom: 8 }, children: ["Type: ", _jsx("strong", { children: preview.type === 'peppol_factuur' ? 'Peppol-factuur (B2B)' : 'Kasticket (kasboek)' }), _jsx("br", {}), "Onderneming: ", preview.onderneming.naam, _jsx("br", {}), "Klant: ", preview.klant?.naam ?? 'particulier', _jsx("br", {}), "Betaalwijze: ", preview.betaalwijze, " \u00B7 Kanaal: ", preview.kanaal] }), _jsx("table", { style: { width: '100%', fontSize: 13, borderCollapse: 'collapse' }, children: _jsx("tbody", { children: preview.lijnen.map((l, i) => (_jsxs("tr", { children: [_jsxs("td", { children: [l.aantal, "\u00D7 ", l.omschrijving] }), _jsx("td", { style: { textAlign: 'right' }, children: euro(l.totaalInclBtw) })] }, i))) }) }), _jsx("hr", {}), preview.btwPerTarief.map((b) => (_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#555' }, children: [_jsxs("span", { children: ["BTW ", b.percentage, "% (maatstaf ", euro(b.maatstaf), ")"] }), _jsx("span", { children: euro(b.btw) })] }, b.percentage))), _jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', fontWeight: 700, marginTop: 6 }, children: [_jsx("span", { children: "Totaal incl. BTW" }), _jsx("span", { children: euro(preview.totaalInclBtw) })] }), _jsxs("details", { style: { marginTop: 10 }, children: [_jsx("summary", { style: { cursor: 'pointer', fontSize: 12, color: '#6b7280' }, children: "Ruwe JSON" }), _jsx("pre", { style: { fontSize: 11, overflow: 'auto', maxHeight: 200 }, children: JSON.stringify(preview, null, 2) })] })] }) }))] }));
}
const btn = { padding: '5px 10px', border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 13 };
