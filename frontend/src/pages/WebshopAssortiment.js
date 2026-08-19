import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from 'react';
import { getProductenBeheer, setProductWebshop, getMeta, } from '../api/client';
import { ProductForm } from './Beheer';
// Webshop-assortiment: snel producten in/uit de webshop zetten (dagelijks werk)
// en manueel nieuwe producten toevoegen per afdeling. Enkel actieve producten
// verschijnen effectief online — een product offline zetten aan de kassa haalt
// het automatisch uit de webshop.
export function WebshopAssortiment() {
    const [meta, setMeta] = useState(null);
    const [producten, setProducten] = useState([]);
    const [zoek, setZoek] = useState('');
    const [afdId, setAfdId] = useState('');
    const [enkelOnline, setEnkelOnline] = useState(false);
    const [bezigId, setBezigId] = useState('');
    const [form, setForm] = useState(null);
    async function laadMeta() { setMeta(await getMeta()); }
    async function laadProducten() { setProducten(await getProductenBeheer(zoek)); }
    useEffect(() => { laadMeta(); }, []);
    useEffect(() => { const t = setTimeout(laadProducten, 150); return () => clearTimeout(t); }, [zoek]);
    const zichtbaar = useMemo(() => {
        return producten
            .filter((p) => (!afdId || (p.afdelingId ?? p.afdeling?.id) === afdId))
            .filter((p) => (!enkelOnline || p.webshopZichtbaar))
            .sort((a, b) => a.naam.localeCompare(b.naam));
    }, [producten, afdId, enkelOnline]);
    const aantalOnline = producten.filter((p) => p.webshopZichtbaar && p.actief).length;
    async function toggle(p) {
        setBezigId(p.id);
        try {
            const bijgewerkt = await setProductWebshop(p.id, !p.webshopZichtbaar);
            setProducten((lijst) => lijst.map((x) => (x.id === p.id ? { ...x, webshopZichtbaar: bijgewerkt.webshopZichtbaar } : x)));
        }
        finally {
            setBezigId('');
        }
    }
    if (form && meta) {
        return (_jsxs("div", { style: { maxWidth: 620 }, children: [_jsx("button", { onClick: () => setForm(null), style: { ...btnGrijs, marginBottom: 12 }, children: "\u2190 Terug naar assortiment" }), _jsx(ProductForm, { meta: meta, product: form.product, prefillAfdelingId: afdId || undefined, onKlaar: () => { setForm(null); laadProducten(); }, onMetaWijzig: laadMeta })] }));
    }
    return (_jsxs("div", { style: { maxWidth: 900 }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }, children: [_jsx("h2", { style: { margin: 0 }, children: "Webshop-assortiment" }), _jsxs("span", { style: { color: '#6b7280', fontSize: 14 }, children: [_jsx("strong", { children: aantalOnline }), " producten online"] })] }), _jsxs("p", { style: { color: '#6b7280', marginTop: 6 }, children: ["Vink aan wat online mag staan. Enkel ", _jsx("strong", { children: "actieve" }), " producten verschijnen in de webshop."] }), _jsxs("div", { style: { display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', margin: '10px 0 14px' }, children: [_jsx("input", { value: zoek, onChange: (e) => setZoek(e.target.value), placeholder: "Zoek product\u2026", style: { ...inp, maxWidth: 220, marginBottom: 0 } }), _jsxs("select", { value: afdId, onChange: (e) => setAfdId(e.target.value), style: { ...inp, marginBottom: 0 }, children: [_jsx("option", { value: "", children: "Alle afdelingen" }), meta?.afdelingen.map((a) => _jsx("option", { value: a.id, children: a.naam }, a.id))] }), _jsxs("label", { style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, color: '#374151' }, children: [_jsx("input", { type: "checkbox", checked: enkelOnline, onChange: (e) => setEnkelOnline(e.target.checked) }), "enkel online"] }), _jsx("button", { onClick: () => setForm({ product: null }), style: { ...btnBlauw, marginLeft: 'auto' }, children: "+ Nieuw product" })] }), _jsxs("table", { style: { width: '100%', borderCollapse: 'collapse', fontSize: 14 }, children: [_jsx("thead", { children: _jsxs("tr", { style: { textAlign: 'left', borderBottom: '1px solid #ddd', fontSize: 12, color: '#666' }, children: [_jsx("th", { style: { padding: 6 }, children: "Product" }), _jsx("th", { style: { padding: 6 }, children: "Afdeling" }), _jsx("th", { style: { padding: 6, textAlign: 'right' }, children: "Prijs" }), _jsx("th", { style: { padding: 6 }, children: "Status" }), _jsx("th", { style: { padding: 6, textAlign: 'center' }, children: "In webshop" }), _jsx("th", {})] }) }), _jsxs("tbody", { children: [zichtbaar.map((p) => (_jsxs("tr", { style: { borderBottom: '1px solid #f0f0f0', opacity: p.actief ? 1 : 0.55 }, children: [_jsxs("td", { style: { padding: 6 }, children: [p.naam, p.isAlcohol && ' 🍷'] }), _jsx("td", { style: { padding: 6, color: '#6b7280' }, children: p.afdeling?.naam ?? '—' }), _jsxs("td", { style: { padding: 6, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }, children: ["\u20AC ", Number(p.verkoopprijs).toFixed(2)] }), _jsx("td", { style: { padding: 6 }, children: p.actief
                                            ? _jsx("span", { style: { color: '#166534' }, children: "actief" })
                                            : _jsx("span", { style: { color: '#b91c1c' }, children: "offline" }) }), _jsxs("td", { style: { padding: 6, textAlign: 'center' }, children: [_jsx("button", { onClick: () => toggle(p), disabled: bezigId === p.id, title: p.webshopZichtbaar ? 'Uit de webshop halen' : 'In de webshop tonen', style: {
                                                    width: 46, height: 26, borderRadius: 999, border: '1px solid ' + (p.webshopZichtbaar ? '#0d4589' : '#cbd5e1'),
                                                    background: p.webshopZichtbaar ? '#0d4589' : '#e5e7eb', position: 'relative', cursor: 'pointer',
                                                    transition: 'background .15s',
                                                }, children: _jsx("span", { style: {
                                                        position: 'absolute', top: 2, left: p.webshopZichtbaar ? 22 : 2, width: 20, height: 20,
                                                        borderRadius: '50%', background: '#fff', transition: 'left .15s',
                                                    } }) }), !p.actief && p.webshopZichtbaar && _jsx("div", { style: { fontSize: 11, color: '#b91c1c' }, children: "toont pas als actief" })] }), _jsx("td", { style: { padding: 6, textAlign: 'right' }, children: _jsx("button", { onClick: () => setForm({ product: p }), style: btnMini, children: "Bewerken" }) })] }, p.id))), zichtbaar.length === 0 && _jsx("tr", { children: _jsx("td", { colSpan: 6, style: { padding: 16, color: '#999' }, children: "Geen producten gevonden." }) })] })] })] }));
}
const inp = { padding: 8, fontSize: 14, boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 6, marginBottom: 8 };
const btnBlauw = { padding: '9px 16px', border: 'none', borderRadius: 6, background: '#0d4589', color: '#fff', cursor: 'pointer', fontWeight: 600 };
const btnGrijs = { padding: '8px 14px', border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', cursor: 'pointer' };
const btnMini = { padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 5, background: '#fff', cursor: 'pointer', fontSize: 13 };
