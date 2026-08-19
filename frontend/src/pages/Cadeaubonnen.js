import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { getCadeaubonnen, getNieuwBonNummer, createCadeaubon, bonInwisselen, } from '../api/client';
import { getVerkoper } from '../auth';
const euro = (n) => '€ ' + Number(n).toFixed(2);
// Cadeaubon-register: bonnen registreren (nummer + uitgiftedatum + bedrag) en
// als ingewisseld markeren. Uitgifte is BTW-vrij (0%); BTW volgt bij inwisseling.
export function Cadeaubonnen() {
    const [lijst, setLijst] = useState([]);
    const [zoek, setZoek] = useState('');
    const [nummer, setNummer] = useState('');
    const [bedrag, setBedrag] = useState('');
    const [datum, setDatum] = useState(new Date().toISOString().slice(0, 10));
    const [fout, setFout] = useState('');
    const [bezig, setBezig] = useState(false);
    async function laad() { setLijst(await getCadeaubonnen(zoek)); }
    useEffect(() => { const t = setTimeout(laad, 150); return () => clearTimeout(t); }, [zoek]);
    useEffect(() => { getNieuwBonNummer().then(setNummer); }, []);
    async function registreer() {
        setFout('');
        const b = Number(bedrag.replace(',', '.'));
        if (!(b > 0)) {
            setFout('Geef een geldig bedrag.');
            return;
        }
        setBezig(true);
        try {
            await createCadeaubon({
                nummer: nummer.trim() || undefined,
                bedrag: b,
                datumUitgifte: datum ? new Date(datum).toISOString() : undefined,
                gebruikerId: getVerkoper()?.id,
            });
            setBedrag('');
            setNummer(await getNieuwBonNummer());
            await laad();
        }
        catch (e) {
            setFout(e instanceof Error ? e.message : 'Registreren mislukt');
        }
        finally {
            setBezig(false);
        }
    }
    async function inwisselen(id) {
        await bonInwisselen(id);
        await laad();
    }
    const openBedrag = lijst.filter((b) => !b.ingewisseld).reduce((s, b) => s + Number(b.bedrag), 0);
    return (_jsxs("div", { style: { maxWidth: 820 }, children: [_jsx("h2", { children: "Cadeaubonnen" }), _jsxs("div", { style: { border: '1px solid #e5e7eb', borderRadius: 10, padding: 14, marginBottom: 16, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }, children: [_jsxs("div", { children: [_jsx("div", { style: muted, children: "Nummer" }), _jsx("input", { value: nummer, onChange: (e) => setNummer(e.target.value), style: { ...inp, width: 140 } })] }), _jsxs("div", { children: [_jsx("div", { style: muted, children: "Bedrag" }), _jsx("input", { value: bedrag, onChange: (e) => setBedrag(e.target.value), inputMode: "decimal", placeholder: "0,00", style: { ...inp, width: 110 } })] }), _jsxs("div", { children: [_jsx("div", { style: muted, children: "Uitgiftedatum" }), _jsx("input", { type: "date", value: datum, onChange: (e) => setDatum(e.target.value), style: inp })] }), _jsx("button", { onClick: registreer, disabled: bezig, style: btnBlauw, children: bezig ? 'Bezig…' : 'Registreren' }), fout && _jsx("span", { style: { color: 'crimson' }, children: fout })] }), _jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }, children: [_jsx("input", { value: zoek, onChange: (e) => setZoek(e.target.value), placeholder: "Zoek op nummer\u2026", style: { ...inp, maxWidth: 220, marginBottom: 0 } }), _jsxs("span", { style: { fontSize: 13, color: '#6b7280' }, children: ["Openstaand (niet ingewisseld): ", _jsx("strong", { children: euro(openBedrag) })] })] }), _jsxs("table", { style: { width: '100%', borderCollapse: 'collapse', fontSize: 14 }, children: [_jsx("thead", { children: _jsxs("tr", { style: { textAlign: 'left', borderBottom: '1px solid #ddd', fontSize: 12, color: '#666' }, children: [_jsx("th", { style: { padding: 6 }, children: "Nummer" }), _jsx("th", { style: { padding: 6 }, children: "Uitgifte" }), _jsx("th", { style: { padding: 6, textAlign: 'right' }, children: "Bedrag" }), _jsx("th", { style: { padding: 6 }, children: "Status" }), _jsx("th", { style: { padding: 6 }, children: "Door" }), _jsx("th", {})] }) }), _jsxs("tbody", { children: [lijst.map((b) => (_jsxs("tr", { style: { borderBottom: '1px solid #f0f0f0', opacity: b.ingewisseld ? 0.6 : 1 }, children: [_jsx("td", { style: { padding: 6, fontFamily: 'monospace' }, children: b.nummer }), _jsx("td", { style: { padding: 6 }, children: new Date(b.datumUitgifte).toLocaleDateString('nl-BE') }), _jsx("td", { style: { padding: 6, textAlign: 'right' }, children: euro(b.bedrag) }), _jsx("td", { style: { padding: 6 }, children: b.ingewisseld
                                            ? _jsxs("span", { style: { color: '#6b7280' }, children: ["ingewisseld ", b.ingewisseldOp ? new Date(b.ingewisseldOp).toLocaleDateString('nl-BE') : ''] })
                                            : _jsx("span", { style: { color: '#166534' }, children: "geldig" }) }), _jsx("td", { style: { padding: 6, color: '#6b7280' }, children: b.gebruiker?.naam ?? '' }), _jsx("td", { style: { padding: 6, textAlign: 'right' }, children: !b.ingewisseld && _jsx("button", { onClick: () => inwisselen(b.id), style: btnMini, children: "Inwisselen" }) })] }, b.id))), lijst.length === 0 && _jsx("tr", { children: _jsx("td", { colSpan: 6, style: { padding: 16, color: '#999' }, children: "Nog geen cadeaubonnen." }) })] })] })] }));
}
const inp = { padding: 8, fontSize: 14, boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 6, marginBottom: 8 };
const muted = { fontSize: 12, color: '#6b7280', marginBottom: 2 };
const btnBlauw = { padding: '9px 16px', border: 'none', borderRadius: 6, background: '#2563eb', color: '#fff', cursor: 'pointer', fontWeight: 600 };
const btnMini = { padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 5, background: '#fff', cursor: 'pointer', fontSize: 13 };
