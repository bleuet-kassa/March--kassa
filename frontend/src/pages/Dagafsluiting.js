import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { getDagoverzicht, dagAfsluiten, getAfsluitingen, getDagRapport, dagafsluitingCsvUrl, getMeta, updateOnderneming, } from '../api/client';
import { getVerkoper } from '../auth';
const euro = (n) => '€ ' + Number(n).toFixed(2);
// Nette naam van een betaalwijze op het dagafsluiting-ticket.
function betaalNaam(b) {
    switch (b) {
        case 'CASH': return 'Cash';
        case 'BANCONTACT': return 'Bancontact';
        case 'KAART': return 'Kaart';
        case 'OVERSCHRIJVING': return 'Overschrijving';
        case 'QR': return 'QR-code';
        case 'EIGEN_REKENING': return 'Eigen rekening';
        case 'ONLINE': return 'Online';
        default: return b ?? '—';
    }
}
// Dagontvangsten (Fase 2/wettelijk): toont de dagontvangsten van de winkel,
// gesplitst per BTW-tarief en betaalwijze, met de B2B-facturen apart. Sluit de
// dag af (onwijzigbaar, met volgnummer) en houdt een register bij.
export function Dagafsluiting() {
    const [rapport, setRapport] = useState(null);
    const [afgesloten, setAfgesloten] = useState(false);
    const [register, setRegister] = useState([]);
    const [fout, setFout] = useState('');
    const [bezig, setBezig] = useState(false);
    // onderneming-gegevens voor op het ticket
    const [ond, setOnd] = useState({ naam: '', btwNummer: '', adres: '' });
    const [ondOpgeslagen, setOndOpgeslagen] = useState('');
    async function laad() {
        setFout('');
        try {
            setRapport(await getDagoverzicht());
            setAfgesloten(false);
            setRegister(await getAfsluitingen());
            const m = await getMeta();
            if (m.onderneming)
                setOnd({ naam: m.onderneming.naam, btwNummer: m.onderneming.btwNummer ?? '', adres: m.onderneming.adres ?? '' });
        }
        catch {
            setFout('Kon de gegevens niet laden.');
        }
    }
    useEffect(() => { laad(); }, []);
    async function bewaarOnderneming() {
        await updateOnderneming(ond);
        setOndOpgeslagen('Opgeslagen.');
        setTimeout(() => setOndOpgeslagen(''), 2000);
        if (!afgesloten)
            setRapport(await getDagoverzicht());
    }
    async function afsluiten() {
        if (!rapport || (rapport.dagontvangsten.aantal + rapport.facturen.length) === 0 || bezig)
            return;
        if (!window.confirm('De dag definitief afsluiten? De ontvangsten worden onwijzigbaar vastgelegd.'))
            return;
        setBezig(true);
        setFout('');
        try {
            const r = await dagAfsluiten(getVerkoper()?.id);
            setRapport(r);
            setAfgesloten(true);
            setRegister(await getAfsluitingen());
        }
        catch {
            setFout('Afsluiten mislukt.');
        }
        finally {
            setBezig(false);
        }
    }
    async function bekijk(id) {
        setRapport(await getDagRapport(id));
        setAfgesloten(true);
    }
    if (!rapport)
        return _jsx("div", { children: fout || 'Laden…' });
    const leeg = rapport.dagontvangsten.aantal + rapport.facturen.length === 0;
    return (_jsxs("div", { style: { display: 'flex', gap: 24, flexWrap: 'wrap' }, children: [_jsxs("div", { style: { flex: '1 1 360px', maxWidth: 460 }, children: [_jsx("h2", { children: "Dagontvangsten" }), _jsxs("details", { style: { marginBottom: 12 }, children: [_jsx("summary", { style: { cursor: 'pointer', fontWeight: 600 }, children: "Onderneming-gegevens (voor op het ticket)" }), _jsxs("div", { style: { padding: '8px 0' }, children: [!ond.btwNummer && _jsx("p", { style: { color: '#92400e', fontSize: 13 }, children: "\u26A0 Vul het BTW-nummer in \u2014 verplicht op een wettelijk ticket." }), _jsx("input", { placeholder: "Naam", value: ond.naam, onChange: (e) => setOnd({ ...ond, naam: e.target.value }), style: inp }), _jsx("input", { placeholder: "BTW-nummer (BE0\u2026)", value: ond.btwNummer, onChange: (e) => setOnd({ ...ond, btwNummer: e.target.value }), style: inp }), _jsx("input", { placeholder: "Adres", value: ond.adres, onChange: (e) => setOnd({ ...ond, adres: e.target.value }), style: inp }), _jsx("button", { onClick: bewaarOnderneming, style: btnGrijs, children: "Opslaan" }), ondOpgeslagen && _jsx("span", { style: { color: '#16a34a', marginLeft: 8 }, children: ondOpgeslagen })] })] }), !afgesloten && (_jsx("button", { onClick: afsluiten, disabled: leeg || bezig, style: { ...btnGroen, width: '100%', background: leeg || bezig ? '#9ca3af' : '#16a34a' }, children: bezig ? 'Bezig…' : 'Dag afsluiten' })), afgesloten && (_jsx("button", { onClick: laad, style: { ...btnGrijs, width: '100%' }, children: "\u2190 Terug naar vandaag" })), fout && _jsx("p", { style: { color: 'crimson' }, children: fout }), _jsx("h3", { style: { marginTop: 20 }, children: "Register" }), _jsxs("table", { style: { width: '100%', borderCollapse: 'collapse', fontSize: 14 }, children: [_jsx("thead", { children: _jsxs("tr", { style: { textAlign: 'left', borderBottom: '1px solid #ddd', fontSize: 12, color: '#666' }, children: [_jsx("th", { style: { padding: 4 }, children: "Nr" }), _jsx("th", { style: { padding: 4 }, children: "Datum" }), _jsx("th", { style: { padding: 4, textAlign: 'right' }, children: "Totaal" }), _jsx("th", {})] }) }), _jsxs("tbody", { children: [register.map((a) => (_jsxs("tr", { style: { borderBottom: '1px solid #f0f0f0' }, children: [_jsx("td", { style: { padding: 4 }, children: a.volgnummer ?? '—' }), _jsx("td", { style: { padding: 4 }, children: new Date(a.tot).toLocaleDateString('nl-BE') }), _jsx("td", { style: { padding: 4, textAlign: 'right' }, children: euro(a.totaal) }), _jsxs("td", { style: { padding: 4, whiteSpace: 'nowrap' }, children: [_jsx("button", { onClick: () => bekijk(a.id), style: btnMini, children: "Bekijk" }), ' ', _jsx("a", { href: dagafsluitingCsvUrl(a.id), style: { ...btnMini, textDecoration: 'none', color: '#2563eb' }, children: "CSV" })] })] }, a.id))), register.length === 0 && _jsx("tr", { children: _jsx("td", { colSpan: 4, style: { padding: 12, color: '#999' }, children: "Nog geen afsluitingen." }) })] })] })] }), _jsxs("div", { style: { flex: '1 1 360px', maxWidth: 420 }, children: [_jsx(Ticket, { rapport: rapport, afgesloten: afgesloten }), _jsxs("div", { style: { display: 'flex', gap: 8, marginTop: 12 }, children: [_jsx("button", { onClick: () => window.print(), style: { ...btnGrijs, flex: 1 }, children: "Afdrukken" }), rapport.id && _jsx("a", { href: dagafsluitingCsvUrl(rapport.id), style: { ...btnGrijs, flex: 1, textAlign: 'center', textDecoration: 'none', color: '#111' }, children: "CSV-export" })] })] })] }));
}
function Ticket({ rapport, afgesloten }) {
    const d = rapport.dagontvangsten;
    return (_jsxs("div", { style: { border: '1px solid #ddd', borderRadius: 10, padding: 18, fontFamily: 'ui-monospace,Consolas,monospace' }, children: [_jsxs("div", { style: { textAlign: 'center' }, children: [_jsx("strong", { children: rapport.onderneming?.naam ?? 'Onderneming' }), _jsx("br", {}), rapport.onderneming?.adres && _jsxs("span", { style: { fontSize: 12 }, children: [rapport.onderneming.adres, _jsx("br", {})] }), _jsxs("span", { style: { fontSize: 12 }, children: [rapport.onderneming?.btwNummer ? `BTW ${rapport.onderneming.btwNummer}` : _jsx("em", { style: { color: 'crimson' }, children: "BTW-nummer ontbreekt" }), rapport.onderneming?.ondernemingsnummer ? ` · ond.nr ${rapport.onderneming.ondernemingsnummer}` : ''] })] }), _jsx("hr", {}), _jsxs("div", { style: { textAlign: 'center', fontWeight: 700 }, children: ["DAGONTVANGSTEN ", rapport.volgnummer != null ? `nr ${rapport.volgnummer}` : '(voorbeeld)'] }), _jsxs("div", { style: { textAlign: 'center', fontSize: 12, color: '#555' }, children: [rapport.tot ? new Date(rapport.tot).toLocaleString('nl-BE') : '', _jsx("br", {}), rapport.locatie, rapport.verkoper ? ` · ${rapport.verkoper}` : ''] }), _jsx("hr", {}), _jsxs("div", { style: { fontWeight: 600, fontSize: 13 }, children: ["BTW-uitsplitsing \u2014 ", d.aantal, " verkopen"] }), _jsx("table", { style: { width: '100%', fontSize: 13 }, children: _jsxs("tbody", { children: [d.perBtwTarief.map((b) => (_jsxs("tr", { children: [_jsxs("td", { children: ["BTW ", b.percentage, "%"] }), _jsxs("td", { style: { textAlign: 'right' }, children: ["maatstaf ", euro(b.maatstaf)] }), _jsx("td", { style: { textAlign: 'right' }, children: euro(b.btw) })] }, b.percentage))), d.perBtwTarief.length === 0 && _jsx("tr", { children: _jsx("td", { colSpan: 3, style: { color: '#999' }, children: "\u2014" }) })] }) }), _jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', fontSize: 13 }, children: [_jsx("span", { children: "Totaal excl. BTW" }), _jsx("span", { children: euro(d.totaalExcl) })] }), _jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', fontSize: 13 }, children: [_jsx("span", { children: "Totaal BTW" }), _jsx("span", { children: euro(d.totaalBtw) })] }), d.perCategorie.length > 0 && (_jsxs(_Fragment, { children: [_jsx("hr", {}), _jsx("div", { style: { fontWeight: 600, fontSize: 13 }, children: "Per categorie" }), d.perCategorie.map((c) => (_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', fontSize: 12 }, children: [_jsx("span", { children: c.categorie }), _jsx("span", { children: euro(c.omzetIncl) })] }, c.categorie)))] })), _jsx("div", { style: { fontSize: 12, color: '#555', marginTop: 6 }, children: Object.entries(d.perBetaalwijze).map(([k, v]) => (_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between' }, children: [_jsx("span", { children: betaalNaam(k) }), _jsx("span", { children: euro(v) })] }, k))) }), rapport.eigenGebruik && rapport.eigenGebruik.aantal > 0 && (_jsx("div", { style: { fontSize: 12, color: '#555', marginTop: 6, borderTop: '1px dashed #ccc', paddingTop: 6 }, children: _jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', fontStyle: 'italic' }, children: [_jsxs("span", { children: ["Eigen rekening (", rapport.eigenGebruik.aantal, ") \u2014 niet in de omzet"] }), _jsx("span", { children: euro(rapport.eigenGebruik.incl) })] }) })), _jsx("hr", {}), _jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 15 }, children: [_jsx("span", { children: "TOTAAL" }), _jsx("span", { children: euro(d.totaalIncl) })] }), _jsx("div", { style: { fontSize: 11, color: '#777', marginTop: 8, textAlign: 'center' }, children: afgesloten ? 'Onwijzigbaar bewaard — bewaarplicht 7 jaar.' : 'Voorbeeld — nog niet afgesloten.' })] }));
}
const inp = { width: '100%', padding: 8, fontSize: 14, boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 6, marginBottom: 8 };
const btnGroen = { padding: 12, border: 'none', borderRadius: 8, color: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 15 };
const btnGrijs = { padding: '9px 12px', border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', cursor: 'pointer' };
const btnMini = { padding: '3px 8px', border: '1px solid #cbd5e1', borderRadius: 5, background: '#fff', cursor: 'pointer', fontSize: 12 };
