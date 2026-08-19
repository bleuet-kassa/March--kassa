import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { getPersoneel, nieuwPersoneelslid, updatePersoneelslid, } from '../api/client';
const ROLLEN = ['KASSA', 'BEHEER', 'BEHEERDER'];
// Personeelsbeheer: een account per medewerker/gérante. Elke verkoop kan zo op
// naam van de juiste persoon geboekt worden (zie verkoper-keuze aan de kassa).
export function Personeel() {
    const [lijst, setLijst] = useState([]);
    const [naam, setNaam] = useState('');
    const [email, setEmail] = useState('');
    const [wachtwoord, setWachtwoord] = useState('');
    const [rol, setRol] = useState('KASSA');
    const [fout, setFout] = useState('');
    const [bezig, setBezig] = useState(false);
    async function laad() { setLijst(await getPersoneel()); }
    useEffect(() => { laad(); }, []);
    async function voegToe() {
        setFout('');
        if (!naam.trim() || !email.trim()) {
            setFout('Naam en e-mail zijn vereist.');
            return;
        }
        if (wachtwoord.length < 4) {
            setFout('Kies een wachtwoord van minstens 4 tekens.');
            return;
        }
        setBezig(true);
        try {
            await nieuwPersoneelslid({ naam: naam.trim(), email: email.trim(), wachtwoord, rol });
            setNaam('');
            setEmail('');
            setWachtwoord('');
            setRol('KASSA');
            await laad();
        }
        catch (e) {
            setFout(e instanceof Error ? e.message : 'Aanmaken mislukt');
        }
        finally {
            setBezig(false);
        }
    }
    async function wijzigRol(p, nieuweRol) {
        await updatePersoneelslid(p.id, { rol: nieuweRol });
        await laad();
    }
    async function zetActief(p, actief) {
        await updatePersoneelslid(p.id, { actief });
        await laad();
    }
    async function resetWachtwoord(p) {
        const nw = window.prompt(`Nieuw wachtwoord voor ${p.naam}?`);
        if (!nw)
            return;
        if (nw.length < 4) {
            setFout('Wachtwoord van minstens 4 tekens vereist.');
            return;
        }
        await updatePersoneelslid(p.id, { wachtwoord: nw });
        setFout('');
        window.alert('Wachtwoord aangepast.');
    }
    return (_jsxs("div", { style: { maxWidth: 800 }, children: [_jsx("h2", { children: "Personeel" }), _jsx("p", { style: { color: '#6b7280', marginTop: 4 }, children: "Maak een account per medewerker. Aan de kassa kies je per ticket wie bedient, zodat elke verkoop op de juiste naam staat." }), _jsxs("div", { style: { border: '1px solid #e5e7eb', borderRadius: 10, padding: 14, margin: '12px 0 20px', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }, children: [_jsxs("div", { children: [_jsx("div", { style: muted, children: "Naam" }), _jsx("input", { value: naam, onChange: (e) => setNaam(e.target.value), style: { ...inp, width: 160 } })] }), _jsxs("div", { children: [_jsx("div", { style: muted, children: "E-mail (login)" }), _jsx("input", { value: email, onChange: (e) => setEmail(e.target.value), style: { ...inp, width: 200 } })] }), _jsxs("div", { children: [_jsx("div", { style: muted, children: "Wachtwoord" }), _jsx("input", { value: wachtwoord, onChange: (e) => setWachtwoord(e.target.value), type: "text", placeholder: "min. 4 tekens", style: { ...inp, width: 130 } })] }), _jsxs("div", { children: [_jsx("div", { style: muted, children: "Rol" }), _jsx("select", { value: rol, onChange: (e) => setRol(e.target.value), style: inp, children: ROLLEN.map((r) => _jsx("option", { value: r, children: r }, r)) })] }), _jsx("button", { onClick: voegToe, disabled: bezig, style: btnBlauw, children: bezig ? 'Bezig…' : 'Account aanmaken' }), fout && _jsx("span", { style: { color: 'crimson' }, children: fout })] }), _jsxs("table", { style: { width: '100%', borderCollapse: 'collapse', fontSize: 14 }, children: [_jsx("thead", { children: _jsxs("tr", { style: { textAlign: 'left', borderBottom: '1px solid #ddd', fontSize: 12, color: '#666' }, children: [_jsx("th", { style: { padding: 6 }, children: "Naam" }), _jsx("th", { style: { padding: 6 }, children: "E-mail" }), _jsx("th", { style: { padding: 6 }, children: "Rol" }), _jsx("th", { style: { padding: 6 }, children: "Status" }), _jsx("th", {})] }) }), _jsxs("tbody", { children: [lijst.map((p) => (_jsxs("tr", { style: { borderBottom: '1px solid #f0f0f0', opacity: p.actief ? 1 : 0.5 }, children: [_jsx("td", { style: { padding: 6 }, children: p.naam }), _jsx("td", { style: { padding: 6, fontFamily: 'monospace' }, children: p.email }), _jsx("td", { style: { padding: 6 }, children: _jsx("select", { value: p.rol, onChange: (e) => wijzigRol(p, e.target.value), style: { ...inp, marginBottom: 0, padding: 4 }, children: ROLLEN.map((r) => _jsx("option", { value: r, children: r }, r)) }) }), _jsx("td", { style: { padding: 6 }, children: p.actief ? _jsx("span", { style: { color: '#166534' }, children: "actief" }) : _jsx("span", { style: { color: '#6b7280' }, children: "uit dienst" }) }), _jsxs("td", { style: { padding: 6, textAlign: 'right', whiteSpace: 'nowrap' }, children: [_jsx("button", { onClick: () => resetWachtwoord(p), style: btnMini, children: "Wachtwoord\u2026" }), ' ', p.actief
                                                ? _jsx("button", { onClick: () => zetActief(p, false), style: { ...btnMini, color: 'crimson' }, children: "Deactiveren" })
                                                : _jsx("button", { onClick: () => zetActief(p, true), style: { ...btnMini, color: '#166534' }, children: "Heractiveren" })] })] }, p.id))), lijst.length === 0 && _jsx("tr", { children: _jsx("td", { colSpan: 5, style: { padding: 16, color: '#999' }, children: "Nog geen accounts." }) })] })] })] }));
}
const inp = { padding: 8, fontSize: 14, boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 6, marginBottom: 8 };
const muted = { fontSize: 12, color: '#6b7280', marginBottom: 2 };
const btnBlauw = { padding: '9px 16px', border: 'none', borderRadius: 6, background: '#0d4589', color: '#fff', cursor: 'pointer', fontWeight: 600 };
const btnMini = { padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 5, background: '#fff', cursor: 'pointer', fontSize: 13 };
