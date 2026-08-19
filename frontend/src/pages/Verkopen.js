import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { getVerkopen, getTicket, annuleerVerkoop, wijzigVerkoopBetaalwijze, } from '../api/client';
import { TicketWeergave } from './Kassa';
const euro = (n) => '€ ' + n.toFixed(2);
const vandaag = () => new Date().toISOString().slice(0, 10);
// Nette naam van een betaalwijze.
function betaalNaam(b) {
    switch (b) {
        case 'CASH': return 'Cash';
        case 'BANCONTACT': return 'Bancontact';
        case 'KAART': return 'Kaart';
        case 'OVERSCHRIJVING': return 'Overschrijving';
        case 'QR': return 'QR-code';
        case 'EIGEN_REKENING': return 'Eigen rekening';
        case 'ONLINE': return 'Online';
        default: return b ?? '-';
    }
}
// Betaalwijzen die je aan de kassa kan kiezen (voor het wijzigen).
const BETAALWIJZEN = ['CASH', 'BANCONTACT', 'KAART', 'OVERSCHRIJVING', 'QR', 'EIGEN_REKENING'];
// Terugvinden van eerdere verkopen: ticket herafdrukken, en (voor beheerders)
// een verkoop annuleren of de betaalwijze corrigeren.
export function Verkopen() {
    const [datum, setDatum] = useState(vandaag());
    const [lijst, setLijst] = useState([]);
    const [ticket, setTicket] = useState(null);
    const [fout, setFout] = useState('');
    const [betaalRij, setBetaalRij] = useState(null);
    const [bezig, setBezig] = useState(false);
    async function laad() {
        setFout('');
        try {
            setLijst(await getVerkopen(datum || undefined));
        }
        catch (e) {
            setFout(e instanceof Error ? e.message : 'Laden mislukt');
        }
    }
    useEffect(() => { laad(); }, [datum]);
    async function herafdruk(id) {
        setFout('');
        try {
            setTicket(await getTicket(id));
        }
        catch (e) {
            setFout(e instanceof Error ? e.message : 'Ticket ophalen mislukt');
        }
    }
    async function annuleer(v) {
        if (!window.confirm(`Verkoop van ${euro(v.totaal)} annuleren?\n\nDe verkoop telt dan niet meer mee in de dagafsluiting en de voorraad wordt teruggeboekt.`))
            return;
        const reden = window.prompt('Reden van de annulatie (optioneel):', '') ?? undefined;
        setBezig(true);
        setFout('');
        try {
            await annuleerVerkoop(v.id, reden || undefined);
            await laad();
        }
        catch (e) {
            setFout(e instanceof Error ? e.message : 'Annuleren mislukt');
        }
        finally {
            setBezig(false);
        }
    }
    async function zetBetaalwijze(v, bw) {
        setBezig(true);
        setFout('');
        try {
            await wijzigVerkoopBetaalwijze(v.id, bw);
            setBetaalRij(null);
            await laad();
        }
        catch (e) {
            setFout(e instanceof Error ? e.message : 'Wijzigen mislukt');
        }
        finally {
            setBezig(false);
        }
    }
    if (ticket) {
        return _jsx(TicketWeergave, { ticket: ticket, onNieuw: () => setTicket(null), nieuwLabel: "\u2190 Terug naar de lijst" });
    }
    return (_jsxs("div", { style: { maxWidth: 920 }, children: [_jsx("h2", { children: "Verkopen" }), _jsx("p", { style: { color: '#6b7280', marginTop: 4 }, children: "Vind een eerdere verkoop terug, druk het ticket opnieuw af, annuleer een verkoop of corrigeer de betaalwijze. Verkopen die al in een afgesloten dagafsluiting zitten (\uD83D\uDD12) zijn wettelijk niet meer te wijzigen." }), _jsxs("div", { style: { display: 'flex', gap: 12, alignItems: 'center', margin: '12px 0' }, children: [_jsx("label", { style: { fontSize: 13, color: '#6b7280' }, children: "Dag" }), _jsx("input", { type: "date", value: datum, onChange: (e) => setDatum(e.target.value), style: inp }), _jsx("button", { onClick: () => setDatum(''), style: btnGrijs, children: "Alle" }), _jsx("button", { onClick: () => setDatum(vandaag()), style: btnGrijs, children: "Vandaag" })] }), fout && _jsx("p", { style: { color: 'crimson' }, children: fout }), _jsxs("table", { style: { width: '100%', borderCollapse: 'collapse', fontSize: 14 }, children: [_jsx("thead", { children: _jsxs("tr", { style: { textAlign: 'left', borderBottom: '1px solid #ddd', fontSize: 12, color: '#666' }, children: [_jsx("th", { style: { padding: 6 }, children: "Tijdstip" }), _jsx("th", { style: { padding: 6 }, children: "Kanaal" }), _jsx("th", { style: { padding: 6 }, children: "Betaal" }), _jsx("th", { style: { padding: 6 }, children: "Verkoper" }), _jsx("th", { style: { padding: 6, textAlign: 'right' }, children: "Artikels" }), _jsx("th", { style: { padding: 6, textAlign: 'right' }, children: "Totaal" }), _jsx("th", {})] }) }), _jsxs("tbody", { children: [lijst.map((v) => {
                                const vergrendeld = v.afgesloten; // in een afgesloten dagafsluiting → niet meer wijzigbaar
                                return (_jsxs("tr", { style: { borderBottom: '1px solid #f0f0f0', opacity: v.geannuleerd ? 0.5 : 1, background: v.geannuleerd ? '#fef2f2' : undefined }, children: [_jsxs("td", { style: { padding: 6 }, children: [new Date(v.datum).toLocaleString('nl-BE'), v.geannuleerd && _jsx("span", { style: { marginLeft: 6, color: '#b91c1c', fontWeight: 700, fontSize: 12 }, children: "GEANNULEERD" })] }), _jsx("td", { style: { padding: 6 }, children: v.kanaal === 'WEBSHOP' ? 'Webshop' : 'Kassa' }), _jsx("td", { style: { padding: 6 }, children: betaalRij === v.id ? (_jsx("select", { autoFocus: true, value: v.betaalwijze ?? '', disabled: bezig, onChange: (e) => zetBetaalwijze(v, e.target.value), onBlur: () => setBetaalRij(null), style: { ...inp, padding: 4 }, children: BETAALWIJZEN.map((b) => _jsx("option", { value: b, children: betaalNaam(b) }, b)) })) : (_jsx("span", { style: { textDecoration: v.geannuleerd ? 'line-through' : 'none' }, children: betaalNaam(v.betaalwijze) })) }), _jsx("td", { style: { padding: 6 }, children: v.verkoper ?? '-' }), _jsx("td", { style: { padding: 6, textAlign: 'right' }, children: v.aantalLijnen }), _jsx("td", { style: { padding: 6, textAlign: 'right', fontWeight: 600, textDecoration: v.geannuleerd ? 'line-through' : 'none' }, children: euro(v.totaal) }), _jsxs("td", { style: { padding: 6, textAlign: 'right', whiteSpace: 'nowrap' }, children: [_jsx("button", { onClick: () => herafdruk(v.id), style: btnBlauw, children: "Herafdrukken" }), !v.geannuleerd && v.kanaal !== 'WEBSHOP' && (vergrendeld ? (_jsx("span", { title: "Zit in een afgesloten dagafsluiting \u2014 wettelijk niet meer wijzigbaar", style: { marginLeft: 8, fontSize: 11, color: '#9ca3af' }, children: "\uD83D\uDD12 afgesloten" })) : (_jsxs(_Fragment, { children: [_jsx("button", { onClick: () => setBetaalRij(betaalRij === v.id ? null : v.id), disabled: bezig, style: btnGrijsMini, children: "Betaalwijze" }), _jsx("button", { onClick: () => annuleer(v), disabled: bezig, style: btnRood, children: "Annuleren" })] })))] })] }, v.id));
                            }), lijst.length === 0 && _jsx("tr", { children: _jsx("td", { colSpan: 7, style: { padding: 16, color: '#999' }, children: "Geen verkopen voor deze selectie." }) })] })] })] }));
}
const inp = { padding: 8, fontSize: 14, boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 6 };
const btnGrijs = { padding: '7px 12px', border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 13 };
const btnGrijsMini = { marginLeft: 8, padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 13 };
const btnBlauw = { padding: '6px 12px', border: 'none', borderRadius: 6, background: '#2563eb', color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: 13 };
const btnRood = { marginLeft: 8, padding: '6px 10px', border: '1px solid #b91c1c', borderRadius: 6, background: '#fff', color: '#b91c1c', cursor: 'pointer', fontWeight: 600, fontSize: 13 };
