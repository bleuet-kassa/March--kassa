import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { getOndernemingen, updateOndernemingById } from '../api/client';
// Instellingen: ondernemingsgegevens die op de documenten (dagontvangsten-ticket,
// facturen, Scrada) moeten staan. Per entiteit (winkel + import-onderneming).
export function Instellingen() {
    const [lijst, setLijst] = useState([]);
    const [melding, setMelding] = useState('');
    async function laad() { setLijst(await getOndernemingen()); }
    useEffect(() => { laad(); }, []);
    return (_jsxs("div", { style: { maxWidth: 640 }, children: [_jsx("h2", { children: "Instellingen \u2014 ondernemingen" }), _jsx("p", { style: { color: '#6b7280', fontSize: 14 }, children: "Deze gegevens verschijnen op je documenten (dagontvangsten-ticket, facturen, Scrada)." }), melding && _jsx("p", { style: { color: '#16a34a', fontWeight: 600 }, children: melding }), lijst.map((o) => (_jsx(OndernemingKaart, { onderneming: o, onOpgeslagen: () => { setMelding('Opgeslagen.'); setTimeout(() => setMelding(''), 2000); laad(); } }, o.id))), lijst.length === 0 && _jsx("p", { style: { color: '#999' }, children: "Laden\u2026" })] }));
}
function OndernemingKaart({ onderneming, onOpgeslagen }) {
    const [naam, setNaam] = useState(onderneming.naam);
    const [nr, setNr] = useState(onderneming.ondernemingsnummer);
    const [btw, setBtw] = useState(onderneming.btwNummer ?? '');
    const [adres, setAdres] = useState(onderneming.adres ?? '');
    const [fout, setFout] = useState('');
    const [bezig, setBezig] = useState(false);
    async function opslaan() {
        setFout('');
        setBezig(true);
        try {
            await updateOndernemingById(onderneming.id, { naam, ondernemingsnummer: nr, btwNummer: btw, adres });
            onOpgeslagen();
        }
        catch (e) {
            setFout(e instanceof Error ? e.message : 'Opslaan mislukt');
        }
        finally {
            setBezig(false);
        }
    }
    return (_jsxs("div", { style: { border: '1px solid #e5e7eb', borderRadius: 10, padding: 16, marginBottom: 14 }, children: [_jsx("div", { style: { fontWeight: 700, marginBottom: 8 }, children: onderneming.isImporteur ? 'Import-onderneming' : 'Winkel' }), _jsx("label", { style: muted, children: "Naam" }), _jsx("input", { value: naam, onChange: (e) => setNaam(e.target.value), style: inp }), _jsxs("div", { style: { display: 'flex', gap: 12 }, children: [_jsxs("div", { style: { flex: 1 }, children: [_jsx("label", { style: muted, children: "Ondernemingsnummer" }), _jsx("input", { value: nr, onChange: (e) => setNr(e.target.value), placeholder: "0801.311.258", style: inp })] }), _jsxs("div", { style: { flex: 1 }, children: [_jsx("label", { style: muted, children: "BTW-nummer" }), _jsx("input", { value: btw, onChange: (e) => setBtw(e.target.value), placeholder: "BE0801311258", style: inp })] })] }), _jsx("label", { style: muted, children: "Adres" }), _jsx("input", { value: adres, onChange: (e) => setAdres(e.target.value), placeholder: "Straat 1, 9680 Maarkedal", style: inp }), fout && _jsx("p", { style: { color: 'crimson' }, children: fout }), _jsx("button", { onClick: opslaan, disabled: bezig, style: btn, children: bezig ? 'Bezig…' : 'Opslaan' })] }));
}
const inp = { width: '100%', padding: 8, fontSize: 14, boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 6, marginBottom: 8 };
const muted = { fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 2 };
const btn = { padding: '9px 16px', border: 'none', borderRadius: 6, background: '#2563eb', color: '#fff', cursor: 'pointer', fontWeight: 600 };
