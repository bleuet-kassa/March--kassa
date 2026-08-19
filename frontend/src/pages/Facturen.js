import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { getMeta, factuurInlezen, factuurVerwerken, createLeverancier, } from '../api/client';
// Factuur-import (Fase 1): upload een leveranciersfactuur (PDF) → herkende regels
// controleren/aanpassen → producten aanmaken/bijwerken en voorraad bijboeken.
// Herkenning via Claude-AI als er een API-sleutel is ingesteld, anders lokaal.
export function Facturen() {
    const [meta, setMeta] = useState(null);
    const [bezig, setBezig] = useState(false);
    const [fout, setFout] = useState('');
    const [melding, setMelding] = useState('');
    const [bron, setBron] = useState('');
    const [locatieId, setLocatieId] = useState('');
    const [leverancierId, setLeverancierId] = useState('');
    const [rijen, setRijen] = useState([]);
    const [klaar, setKlaar] = useState(null);
    useEffect(() => {
        getMeta().then((m) => {
            setMeta(m);
            setLocatieId(m.locaties[0]?.id ?? '');
        });
    }, []);
    const btw21 = meta?.btwTarieven.find((b) => Number(b.percentage) === 21)?.id ?? meta?.btwTarieven[0]?.id ?? '';
    const verkoopUitInkoop = (inkoop) => Math.round((inkoop * 2.5) / 0.5) * 0.5;
    async function kiesBestand(e) {
        const file = e.target.files?.[0];
        if (!file || !meta)
            return;
        setFout('');
        setMelding('');
        setKlaar(null);
        setBezig(true);
        try {
            const res = await factuurInlezen(file);
            setBron(res.bron);
            if (res.waarschuwing)
                setMelding(res.waarschuwing);
            // koppel gedetecteerde leverancier indien die al bestaat
            const gevonden = res.leverancier
                ? meta.leveranciers.find((l) => l.naam.toLowerCase() === res.leverancier.toLowerCase())
                : undefined;
            if (gevonden)
                setLeverancierId(gevonden.id);
            setRijen(res.regels.map((r, i) => ({
                _key: i,
                naam: r.omschrijving,
                aantal: r.aantal,
                inkoopprijs: r.eenheidsprijs,
                verkoopprijs: verkoopUitInkoop(r.eenheidsprijs),
                btwTariefId: btw21,
                isAlcohol: true,
                categorieId: null,
            })));
            if (res.regels.length === 0)
                setFout('Geen regels herkend. Probeer een AI-sleutel of controleer de PDF.');
        }
        catch (err) {
            setFout(err instanceof Error ? err.message : 'Inlezen mislukt');
        }
        finally {
            setBezig(false);
            e.target.value = '';
        }
    }
    function wijzig(key, veld, waarde) {
        setRijen((rs) => rs.map((r) => (r._key === key ? { ...r, [veld]: waarde } : r)));
    }
    function verwijder(key) {
        setRijen((rs) => rs.filter((r) => r._key !== key));
    }
    async function nieuweLeverancier() {
        const naam = window.prompt('Naam leverancier?');
        if (!naam?.trim())
            return;
        const l = await createLeverancier(naam.trim());
        setMeta(await getMeta());
        setLeverancierId(l.id);
    }
    async function verwerk() {
        if (!rijen.length || !locatieId)
            return;
        setBezig(true);
        setFout('');
        try {
            const payload = rijen.map((r) => ({
                naam: r.naam.trim(),
                aantal: Number(r.aantal),
                inkoopprijs: Number(r.inkoopprijs),
                verkoopprijs: Number(r.verkoopprijs),
                btwTariefId: r.btwTariefId,
                isAlcohol: r.isAlcohol,
                leverancierId: leverancierId || null,
                categorieId: r.categorieId || null,
            }));
            const res = await factuurVerwerken(payload, locatieId);
            setKlaar(res);
            setRijen([]);
        }
        catch (err) {
            setFout(err instanceof Error ? err.message : 'Verwerken mislukt');
        }
        finally {
            setBezig(false);
        }
    }
    if (!meta)
        return _jsx("div", { children: "Laden\u2026" });
    return (_jsxs("div", { style: { maxWidth: 1000 }, children: [_jsx("h2", { children: "Factuur inlezen" }), _jsxs("p", { style: { color: '#6b7280', fontSize: 14 }, children: ["Upload een leveranciersfactuur (PDF). De regels worden herkend; controleer en pas aan v\u00F3\u00F3r je ze toevoegt. ", bron && _jsxs(_Fragment, { children: ["Herkenning: ", _jsx("strong", { children: bron === 'ai' ? 'AI' : 'lokaal' }), "."] })] }), _jsx("input", { type: "file", accept: "application/pdf", onChange: kiesBestand, disabled: bezig }), bezig && _jsx("span", { style: { marginLeft: 10 }, children: "Bezig\u2026" }), melding && _jsx("p", { style: { color: '#92400e', background: '#fef3c7', padding: '8px 12px', borderRadius: 8 }, children: melding }), fout && _jsx("p", { style: { color: 'crimson' }, children: fout }), klaar && (_jsxs("p", { style: { color: '#16a34a', fontWeight: 600 }, children: ["\u2713 Verwerkt: ", klaar.nieuw, " nieuw, ", klaar.bijgeboekt, " bijgeboekt (totaal ", klaar.totaal, ")."] })), rijen.length > 0 && (_jsxs(_Fragment, { children: [_jsxs("div", { style: { display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-end', margin: '12px 0' }, children: [_jsxs("div", { children: [_jsx("div", { style: muted, children: "Voorraad boeken op" }), _jsx("select", { value: locatieId, onChange: (e) => setLocatieId(e.target.value), style: inp, children: meta.locaties.map((l) => _jsx("option", { value: l.id, children: l.naam }, l.id)) })] }), _jsxs("div", { children: [_jsx("div", { style: muted, children: "Leverancier (voor alle regels)" }), _jsxs("div", { style: { display: 'flex', gap: 6 }, children: [_jsxs("select", { value: leverancierId, onChange: (e) => setLeverancierId(e.target.value), style: inp, children: [_jsx("option", { value: "", children: "\u2014" }), meta.leveranciers.map((l) => _jsx("option", { value: l.id, children: l.naam }, l.id))] }), _jsx("button", { onClick: nieuweLeverancier, style: btnGrijs, children: "+" })] })] })] }), _jsxs("table", { style: { width: '100%', borderCollapse: 'collapse', fontSize: 14 }, children: [_jsx("thead", { children: _jsxs("tr", { style: { textAlign: 'left', borderBottom: '1px solid #ddd', fontSize: 12, color: '#666' }, children: [_jsx("th", { style: { padding: 4 }, children: "Naam" }), _jsx("th", { style: { padding: 4, width: 60 }, children: "Aantal" }), _jsx("th", { style: { padding: 4, width: 90 }, children: "Inkoop \u20AC" }), _jsx("th", { style: { padding: 4, width: 90 }, children: "Verkoop \u20AC" }), _jsx("th", { style: { padding: 4, width: 110 }, children: "BTW" }), _jsx("th", { style: { padding: 4, width: 50 }, children: "Alc." }), _jsx("th", { style: { width: 30 } })] }) }), _jsx("tbody", { children: rijen.map((r) => (_jsxs("tr", { style: { borderBottom: '1px solid #f0f0f0' }, children: [_jsx("td", { style: { padding: 3 }, children: _jsx("input", { value: r.naam, onChange: (e) => wijzig(r._key, 'naam', e.target.value), style: { ...inp, marginBottom: 0 } }) }), _jsx("td", { style: { padding: 3 }, children: _jsx("input", { value: r.aantal, onChange: (e) => wijzig(r._key, 'aantal', Number(e.target.value)), inputMode: "numeric", style: { ...inp, marginBottom: 0 } }) }), _jsx("td", { style: { padding: 3 }, children: _jsx("input", { value: r.inkoopprijs, onChange: (e) => wijzig(r._key, 'inkoopprijs', Number(e.target.value)), inputMode: "decimal", style: { ...inp, marginBottom: 0 } }) }), _jsx("td", { style: { padding: 3 }, children: _jsx("input", { value: r.verkoopprijs, onChange: (e) => wijzig(r._key, 'verkoopprijs', Number(e.target.value)), inputMode: "decimal", style: { ...inp, marginBottom: 0 } }) }), _jsx("td", { style: { padding: 3 }, children: _jsx("select", { value: r.btwTariefId, onChange: (e) => wijzig(r._key, 'btwTariefId', e.target.value), style: { ...inp, marginBottom: 0 }, children: meta.btwTarieven.map((b) => _jsxs("option", { value: b.id, children: [b.percentage, "%"] }, b.id)) }) }), _jsx("td", { style: { padding: 3, textAlign: 'center' }, children: _jsx("input", { type: "checkbox", checked: !!r.isAlcohol, onChange: (e) => wijzig(r._key, 'isAlcohol', e.target.checked) }) }), _jsx("td", { style: { textAlign: 'right' }, children: _jsx("button", { onClick: () => verwijder(r._key), style: { border: 'none', background: 'none', color: 'crimson', cursor: 'pointer', fontSize: 18 }, children: "\u00D7" }) })] }, r._key))) })] }), _jsxs("p", { style: muted, children: ["Regels zonder gekozen bestaand product worden als ", _jsx("strong", { children: "nieuw product" }), " aangemaakt (met automatische in-store barcode). Bestaat de naam al exact, gebruik dan eerst het beheerscherm om te koppelen."] }), _jsx("button", { onClick: verwerk, disabled: bezig, style: { ...btnGroen, width: '100%', marginTop: 8 }, children: bezig ? 'Bezig…' : `${rijen.length} regels verwerken → producten + voorraad` })] }))] }));
}
const inp = { width: '100%', padding: 8, fontSize: 14, boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 6, marginBottom: 8 };
const muted = { fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 2 };
const btnGroen = { padding: 12, border: 'none', borderRadius: 8, background: '#16a34a', color: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 15 };
const btnGrijs = { padding: '8px 12px', border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', cursor: 'pointer' };
