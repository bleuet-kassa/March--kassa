import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { login } from '../api/client';
import { setSessie } from '../auth';
// Eenvoudig inlogscherm voor de verkoper. Na succes wordt de verkoper lokaal
// bewaard en meegestuurd bij elke verkoop (verschijnt op het ticket).
export function Login({ onIngelogd }) {
    const [email, setEmail] = useState('kassa@winkel.be');
    const [wachtwoord, setWachtwoord] = useState('');
    const [fout, setFout] = useState('');
    const [bezig, setBezig] = useState(false);
    async function verstuur(e) {
        e.preventDefault();
        setFout('');
        setBezig(true);
        try {
            const g = await login(email.trim(), wachtwoord);
            setSessie(g);
            onIngelogd();
        }
        catch (err) {
            setFout(err instanceof Error ? err.message : 'Inloggen mislukt');
        }
        finally {
            setBezig(false);
        }
    }
    return (_jsxs("div", { style: { maxWidth: 320, margin: '10vh auto' }, children: [_jsx("h2", { children: "Aanmelden" }), _jsxs("form", { onSubmit: verstuur, children: [_jsx("label", { style: { fontSize: 13, color: '#666' }, children: "E-mail" }), _jsx("input", { value: email, onChange: (e) => setEmail(e.target.value), style: { width: '100%', padding: 10, boxSizing: 'border-box', marginBottom: 10 } }), _jsx("label", { style: { fontSize: 13, color: '#666' }, children: "Wachtwoord" }), _jsx("input", { type: "password", value: wachtwoord, onChange: (e) => setWachtwoord(e.target.value), autoFocus: true, style: { width: '100%', padding: 10, boxSizing: 'border-box', marginBottom: 12 } }), fout && _jsx("p", { style: { color: 'crimson' }, children: fout }), _jsx("button", { type: "submit", disabled: bezig, style: { width: '100%', padding: 12, fontWeight: 700, color: '#fff', background: '#2563eb', border: 'none', borderRadius: 6, cursor: 'pointer' }, children: bezig ? 'Bezig…' : 'Aanmelden' })] })] }));
}
