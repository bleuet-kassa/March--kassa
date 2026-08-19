import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { getWebshopProducten, getWebshopAfdelingen, plaatsBestelling, betalingAfronden, } from '../api/client';
import './site.css';
const euro = (n) => '€ ' + n.toFixed(2);
// Publieke webshop: catalogus (selectie uit het assortiment) → winkelmandje →
// afrekenen (afhalen/leveren, betalen bij afhaling). Verlaagt dezelfde stock.
export function WebshopPubliek() {
    const [producten, setProducten] = useState([]);
    const [afdelingen, setAfdelingen] = useState([]);
    const [afd, setAfd] = useState('');
    const [mandje, setMandje] = useState({});
    const [scherm, setScherm] = useState('catalogus');
    const [klant, setKlant] = useState({ naam: '', email: '', telefoon: '', adres: '' });
    const [leverwijze, setLeverwijze] = useState('AFHALEN');
    const [betaalwijze, setBetaalwijze] = useState('ACHTERAF');
    const [betaald, setBetaald] = useState(false);
    const [leeftijdOk, setLeeftijdOk] = useState(false);
    const [akkoord, setAkkoord] = useState(false);
    const [bevestiging, setBevestiging] = useState(null);
    const [fout, setFout] = useState('');
    const [bezig, setBezig] = useState(false);
    useEffect(() => {
        document.title = 'Webshop — Marché';
        getWebshopProducten().then(setProducten).catch(() => { });
        getWebshopAfdelingen().then(setAfdelingen).catch(() => { });
    }, []);
    const prodById = useMemo(() => Object.fromEntries(producten.map((p) => [p.id, p])), [producten]);
    const zichtbaar = useMemo(() => producten.filter((p) => !afd || p.afdelingId === afd), [producten, afd]);
    const lijnen = useMemo(() => Object.entries(mandje).map(([id, aantal]) => ({ p: prodById[id], aantal })).filter((x) => x.p), [mandje, prodById]);
    const totaal = lijnen.reduce((s, l) => s + Number(l.p.verkoopprijs) * l.aantal, 0);
    const aantalItems = lijnen.reduce((s, l) => s + l.aantal, 0);
    const heeftAlcohol = lijnen.some((l) => l.p.isAlcohol);
    function stap(id, delta) {
        setMandje((m) => {
            const p = prodById[id];
            const step = p?.eenheid === 'KG' ? 0.5 : 1;
            const n = Math.round(((m[id] ?? 0) + delta * step) * 1000) / 1000;
            const kopie = { ...m };
            if (n <= 0)
                delete kopie[id];
            else
                kopie[id] = n;
            return kopie;
        });
    }
    function zet(id, waarde) {
        const n = Number(waarde.replace(',', '.'));
        setMandje((m) => {
            const kopie = { ...m };
            if (!(n > 0))
                delete kopie[id];
            else
                kopie[id] = n;
            return kopie;
        });
    }
    async function bestel() {
        setFout('');
        if (!lijnen.length) {
            setFout('Je winkelmandje is leeg.');
            return;
        }
        if (!klant.naam.trim() || !klant.email.trim()) {
            setFout('Vul je naam en e-mail in.');
            return;
        }
        if (leverwijze === 'LEVEREN' && !klant.adres.trim()) {
            setFout('Vul een leveradres in.');
            return;
        }
        if (heeftAlcohol && !leeftijdOk) {
            setFout('Bevestig dat je oud genoeg bent voor alcohol.');
            return;
        }
        if (!akkoord) {
            setFout('Bevestig dat je akkoord gaat met de voorwaarden.');
            return;
        }
        setBezig(true);
        try {
            const b = await plaatsBestelling({
                lijnen: lijnen.map((l) => ({ productId: l.p.id, aantal: l.aantal })),
                klant: { naam: klant.naam.trim(), email: klant.email.trim(), telefoon: klant.telefoon.trim() || undefined, adres: klant.adres.trim() || undefined },
                leverwijze, betaalwijze,
            });
            setBevestiging(b);
            setMandje({});
            if (b.online && b.betaalModus === 'LIVE' && b.betaalUrl) {
                window.location.href = b.betaalUrl; // echte Axepta-betaalpagina
                return;
            }
            setScherm(b.online ? 'betalen' : 'klaar'); // online → (test)betaalscherm
        }
        catch (e) {
            setFout(e instanceof Error ? e.message : 'Bestellen mislukt');
        }
        finally {
            setBezig(false);
        }
    }
    async function simuleerBetaling(gelukt) {
        if (!bevestiging)
            return;
        setBezig(true);
        try {
            const r = await betalingAfronden(bevestiging.id, gelukt);
            if (r.betaald) {
                setBetaald(true);
                setScherm('klaar');
            }
            else {
                setFout('Betaling niet gelukt. Probeer opnieuw of kies "betalen bij afhaling".');
                setScherm('afrekenen');
            }
        }
        catch (e) {
            setFout(e instanceof Error ? e.message : 'Betaling mislukt');
        }
        finally {
            setBezig(false);
        }
    }
    return (_jsxs("div", { className: "marche-site", children: [_jsx("header", { className: "top", children: _jsxs("div", { className: "wrap topbar", children: [_jsxs(Link, { className: "brand", to: "/", "aria-label": "March\u00E9 \u2014 home", children: [_jsxs("svg", { className: "mark", width: "38", height: "38", viewBox: "0 0 40 40", fill: "none", "aria-hidden": "true", children: [_jsx("circle", { cx: "20", cy: "20", r: "18.6", stroke: "currentColor", strokeWidth: "1.5" }), _jsx("circle", { cx: "20", cy: "20", r: "14.4", stroke: "currentColor", strokeWidth: "1", opacity: "0.45" }), _jsx("text", { x: "20", y: "26.5", textAnchor: "middle", fontSize: "19", fontWeight: "600", fill: "currentColor", children: "M" })] }), _jsxs("span", { className: "word-wrap", children: [_jsx("span", { className: "word", children: "March\u00E9" }), _jsx("span", { className: "ph", children: "webshop" })] })] }), _jsx("span", { style: { marginLeft: 'auto' } }), scherm === 'catalogus' && lijnen.length > 0 && (_jsxs("button", { className: "btn btn-primary", onClick: () => setScherm('afrekenen'), children: ["Mandje (", aantalItems % 1 === 0 ? aantalItems : aantalItems.toFixed(1), ") \u00B7 ", euro(totaal)] })), _jsx(Link, { className: "btn btn-ghost", to: "/", children: "\u2190 Winkel" })] }) }), _jsx("main", { children: _jsxs("div", { className: "wrap", style: { paddingTop: 32, paddingBottom: 60 }, children: [fout && _jsx("div", { style: { background: '#fee2e2', color: '#991b1b', padding: '10px 14px', borderRadius: 10, marginBottom: 16 }, children: fout }), scherm === 'klaar' && bevestiging && (_jsxs("div", { style: { maxWidth: 560 }, children: [_jsx("span", { className: "eyebrow", children: "Bedankt!" }), _jsx("h1", { style: { fontSize: 'clamp(2rem,4vw,2.8rem)', margin: '10px 0' }, children: "Je bestelling is geplaatst." }), _jsxs("p", { className: "lead", children: ["We hebben je bestelling goed ontvangen", bevestiging.klant ? `, ${bevestiging.klant.naam}` : '', ".", betaald ? ' Je betaling is ontvangen.' : ` Je betaalt bij ${bevestiging.leverwijze === 'LEVEREN' ? 'de levering' : 'het afhalen'}.`, " We contacteren je zodra ze klaar is."] }), _jsxs("div", { className: "panel", style: { marginTop: 16 }, children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 18 }, children: [_jsx("span", { children: "Totaal" }), _jsx("span", { children: euro(bevestiging.totaal) })] }), _jsxs("div", { style: { color: 'var(--muted)', marginTop: 6 }, children: [bevestiging.leverwijze === 'LEVEREN' ? 'Levering' : 'Afhalen in de winkel', " \u00B7 ", bevestiging.lijnen.length, " artikel(s)"] }), bevestiging.kortingReden && _jsxs("div", { style: { color: 'var(--brand)', marginTop: 6 }, children: ["Korting toegepast: ", bevestiging.kortingReden] })] }), _jsxs("div", { className: "actions", style: { marginTop: 24 }, children: [_jsx("button", { className: "btn btn-primary", onClick: () => { setScherm('catalogus'); setBevestiging(null); }, children: "Verder winkelen" }), _jsx(Link, { className: "btn btn-ghost", to: "/", children: "Naar de startpagina" })] })] })), scherm === 'betalen' && bevestiging && (_jsxs("div", { style: { maxWidth: 480 }, children: [_jsx("span", { className: "eyebrow", children: "Betaling \u00B7 testmodus" }), _jsx("h1", { style: { fontSize: 'clamp(1.7rem,4vw,2.3rem)', margin: '10px 0' }, children: "Online betalen (Axepta)" }), _jsxs("div", { className: "panel", children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 20 }, children: [_jsx("span", { children: "Te betalen" }), _jsx("span", { children: euro(bevestiging.totaal) })] }), _jsx("p", { style: { color: 'var(--muted)', marginTop: 10 }, children: "Dit is de testomgeving. In het echt kom je hier op de beveiligde betaalpagina van Axepta terecht. Simuleer nu het resultaat:" }), _jsxs("div", { style: { display: 'flex', gap: 10, marginTop: 12 }, children: [_jsx("button", { className: "btn btn-primary", disabled: bezig, onClick: () => simuleerBetaling(true), style: { flex: 1, justifyContent: 'center' }, children: "Betaling gelukt" }), _jsx("button", { className: "btn btn-ghost", disabled: bezig, onClick: () => simuleerBetaling(false), style: { flex: 1, justifyContent: 'center' }, children: "Mislukt" })] })] })] })), scherm === 'afrekenen' && (_jsxs("div", { style: { display: 'grid', gridTemplateColumns: '1.1fr .9fr', gap: 28, alignItems: 'start' }, className: "checkout-grid", children: [_jsxs("div", { children: [_jsx("button", { className: "btn btn-ghost", onClick: () => setScherm('catalogus'), style: { marginBottom: 16 }, children: "\u2190 Verder winkelen" }), _jsx("h2", { style: { marginBottom: 12 }, children: "Jouw gegevens" }), _jsxs("div", { className: "form-veld", children: [_jsx("label", { children: "Naam" }), _jsx("input", { value: klant.naam, onChange: (e) => setKlant({ ...klant, naam: e.target.value }) })] }), _jsxs("div", { className: "form-veld", children: [_jsx("label", { children: "E-mail" }), _jsx("input", { value: klant.email, onChange: (e) => setKlant({ ...klant, email: e.target.value }), placeholder: "voor de bevestiging" })] }), _jsxs("div", { className: "form-veld", children: [_jsx("label", { children: "Telefoon (optioneel)" }), _jsx("input", { value: klant.telefoon, onChange: (e) => setKlant({ ...klant, telefoon: e.target.value }) })] }), _jsx("h2", { style: { margin: '20px 0 12px' }, children: "Afhalen of leveren?" }), _jsx("div", { style: { display: 'flex', gap: 10, marginBottom: 12 }, children: ['AFHALEN', 'LEVEREN'].map((lw) => (_jsx("button", { onClick: () => setLeverwijze(lw), style: { flex: 1, padding: 12, borderRadius: 10, cursor: 'pointer', border: leverwijze === lw ? '2px solid var(--brand)' : '1px solid var(--line)', background: leverwijze === lw ? 'var(--surface-2)' : 'var(--surface)', fontWeight: 600 }, children: lw === 'AFHALEN' ? 'Afhalen in de winkel' : 'Laten leveren' }, lw))) }), leverwijze === 'LEVEREN' && (_jsxs("div", { className: "form-veld", children: [_jsx("label", { children: "Leveradres" }), _jsx("input", { value: klant.adres, onChange: (e) => setKlant({ ...klant, adres: e.target.value }), placeholder: "straat, nr, postcode, gemeente" })] })), _jsx("h2", { style: { margin: '20px 0 12px' }, children: "Betaling" }), _jsx("div", { style: { display: 'flex', gap: 10, marginBottom: 4 }, children: [['ACHTERAF', 'Bij afhaling/levering'], ['ONLINE', 'Nu online betalen']].map(([bw, label]) => (_jsx("button", { onClick: () => setBetaalwijze(bw), style: { flex: 1, padding: 12, borderRadius: 10, cursor: 'pointer', border: betaalwijze === bw ? '2px solid var(--brand)' : '1px solid var(--line)', background: betaalwijze === bw ? 'var(--surface-2)' : 'var(--surface)', fontWeight: 600 }, children: label }, bw))) }), betaalwijze === 'ONLINE' && _jsx("div", { style: { fontSize: 13, color: 'var(--muted)', marginBottom: 6 }, children: "Online betalen (Axepta) staat in testmodus \u2014 je kunt de betaling simuleren." }), heeftAlcohol && (_jsxs("label", { style: { display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 12 }, children: [_jsx("input", { type: "checkbox", checked: leeftijdOk, onChange: (e) => setLeeftijdOk(e.target.checked) }), _jsx("span", { children: "Mijn mandje bevat alcohol. Ik bevestig dat ik oud genoeg ben (wijn/bier 16+, sterke drank 18+)." })] })), _jsxs("label", { style: { display: 'flex', gap: 8, alignItems: 'flex-start', marginTop: 10 }, children: [_jsx("input", { type: "checkbox", checked: akkoord, onChange: (e) => setAkkoord(e.target.checked) }), _jsx("span", { children: "Ik ga akkoord met de algemene voorwaarden en het privacybeleid. Betaling gebeurt bij afhaling/levering." })] }), _jsx("button", { className: "btn btn-primary", onClick: bestel, disabled: bezig, style: { marginTop: 18, width: '100%', justifyContent: 'center', fontSize: 17 }, children: bezig ? 'Bezig…' : `${betaalwijze === 'ONLINE' ? 'Naar betaling' : 'Bestelling plaatsen'} · ${euro(totaal)}` })] }), _jsxs("div", { className: "panel", children: [_jsx("h3", { style: { marginTop: 0 }, children: "Je mandje" }), lijnen.map((l) => (_jsxs("div", { style: { display: 'flex', gap: 8, alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--line)' }, children: [_jsxs("div", { style: { flex: 1 }, children: [_jsxs("div", { style: { fontWeight: 600 }, children: [l.p.naam, l.p.isAlcohol && ' 🍷'] }), _jsxs("div", { style: { fontSize: 13, color: 'var(--muted)' }, children: [euro(Number(l.p.verkoopprijs)), l.p.eenheid === 'KG' ? ' /kg' : ''] })] }), _jsxs("div", { style: { whiteSpace: 'nowrap' }, children: [_jsx("button", { onClick: () => stap(l.p.id, -1), style: qtyBtn, children: "\u2212" }), _jsxs("span", { style: { display: 'inline-block', minWidth: 34, textAlign: 'center' }, children: [l.aantal, l.p.eenheid === 'KG' ? ' kg' : ''] }), _jsx("button", { onClick: () => stap(l.p.id, +1), style: qtyBtn, children: "+" })] }), _jsx("div", { style: { width: 70, textAlign: 'right', fontWeight: 600 }, children: euro(Number(l.p.verkoopprijs) * l.aantal) })] }, l.p.id))), _jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', fontWeight: 800, fontSize: 18, marginTop: 12 }, children: [_jsx("span", { children: "Totaal" }), _jsx("span", { children: euro(totaal) })] })] })] })), scherm === 'catalogus' && (_jsxs(_Fragment, { children: [_jsx("span", { className: "eyebrow", children: "Webshop" }), _jsx("h1", { style: { fontSize: 'clamp(2rem,4vw,2.8rem)', margin: '8px 0 6px' }, children: "Bestel online, haal af of laat leveren." }), _jsx("p", { className: "lead", style: { marginBottom: 20 }, children: "Een dagverse selectie uit onze winkel. Betalen doe je bij afhaling of levering." }), producten.length === 0 && _jsx("p", { style: { color: 'var(--muted)' }, children: "Er staan momenteel geen producten online." }), afdelingen.length > 0 && (_jsxs("div", { style: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }, children: [_jsx("button", { onClick: () => setAfd(''), className: "chip", style: chip(afd === ''), children: "Alles" }), afdelingen.map((a) => _jsx("button", { onClick: () => setAfd(a.id), style: chip(afd === a.id), children: a.naam }, a.id))] })), _jsx("div", { className: "shop-grid", children: zichtbaar.map((p) => {
                                        const aantal = mandje[p.id] ?? 0;
                                        return (_jsxs("div", { className: "shop-card", children: [_jsx("div", { className: "shop-foto", children: p.fotoUrl ? _jsx("img", { src: p.fotoUrl, alt: p.naam }) : _jsx("span", { className: "shop-foto-leeg", children: "\uD83D\uDED2" }) }), _jsxs("div", { className: "shop-body", children: [_jsxs("div", { className: "shop-naam", children: [p.naam, p.isAlcohol && ' 🍷'] }), _jsxs("div", { className: "shop-prijs", children: [euro(Number(p.verkoopprijs)), p.eenheid === 'KG' ? ' /kg' : ''] }), aantal > 0
                                                            ? _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }, children: [_jsx("button", { onClick: () => stap(p.id, -1), style: qtyBtn, children: "\u2212" }), _jsx("input", { value: aantal, onChange: (e) => zet(p.id, e.target.value), inputMode: "decimal", style: { width: 50, textAlign: 'center', padding: 4, border: '1px solid var(--line)', borderRadius: 6 } }), _jsx("button", { onClick: () => stap(p.id, +1), style: qtyBtn, children: "+" }), p.eenheid === 'KG' && _jsx("span", { style: { fontSize: 12, color: 'var(--muted)' }, children: "kg" })] })
                                                            : _jsx("button", { className: "btn btn-primary", onClick: () => stap(p.id, +1), style: { marginTop: 8, width: '100%', justifyContent: 'center' }, children: "Toevoegen" })] })] }, p.id));
                                    }) })] }))] }) })] }));
}
const qtyBtn = { border: '1px solid var(--line)', background: 'var(--surface)', borderRadius: 6, width: 28, height: 28, cursor: 'pointer', fontSize: 16 };
function chip(actief) {
    return { padding: '7px 14px', borderRadius: 20, cursor: 'pointer', fontSize: 14, border: actief ? '2px solid var(--brand)' : '1px solid var(--line)', background: actief ? 'var(--surface-2)' : 'var(--surface)', fontWeight: actief ? 600 : 400 };
}
