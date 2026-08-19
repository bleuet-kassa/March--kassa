import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { getMeta, getProductenBeheer, getProduct, getProductByBarcode, nieuweBarcode, createProduct, updateProduct, createCategorie, createAfdeling, createLeverancier, voorraadOntvangst, uploadSiteAfbeelding, } from '../api/client';
// Beheerscherm (Fase 1): producten manueel of via barcode toevoegen/bewerken en
// voorraad ontvangen. (Factuur-import volgt als aparte stap.)
export function Beheer() {
    const [meta, setMeta] = useState(null);
    const [lijst, setLijst] = useState([]);
    const [zoek, setZoek] = useState('');
    const [barcode, setBarcode] = useState('');
    const [fout, setFout] = useState('');
    const [bewerken, setBewerken] = useState(null);
    async function laadMeta() { setMeta(await getMeta()); }
    async function laadLijst() { setLijst(await getProductenBeheer(zoek)); }
    useEffect(() => { laadMeta(); }, []);
    useEffect(() => { const t = setTimeout(laadLijst, 200); return () => clearTimeout(t); }, [zoek]);
    // Barcode toevoegen: bestaat ze -> bewerken; onbekend -> nieuw met code ingevuld.
    async function barcodeToevoegen() {
        const code = barcode.trim();
        if (!code)
            return;
        setFout('');
        try {
            const gevonden = await getProductByBarcode(code);
            const vol = await getProduct(gevonden.id);
            setBewerken({ mode: 'edit', product: vol });
        }
        catch {
            setBewerken({ mode: 'nieuw', product: null, prefillBarcode: code });
        }
        setBarcode('');
    }
    if (bewerken && meta) {
        return (_jsx(ProductForm, { meta: meta, product: bewerken.product, prefillBarcode: bewerken.prefillBarcode, onMetaWijzig: laadMeta, onKlaar: () => { setBewerken(null); laadLijst(); } }));
    }
    return (_jsxs("div", { style: { maxWidth: 900 }, children: [_jsx("h2", { children: "Beheer \u2014 producten" }), _jsxs("div", { style: { display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }, children: [_jsxs("div", { style: { flex: '1 1 260px' }, children: [_jsx("div", { style: muted, children: "Zoeken (naam of barcode)" }), _jsx("input", { value: zoek, onChange: (e) => setZoek(e.target.value), placeholder: "Zoek\u2026", style: inp })] }), _jsxs("div", { style: { flex: '1 1 260px' }, children: [_jsx("div", { style: muted, children: "Barcode toevoegen / opzoeken" }), _jsx("input", { value: barcode, onChange: (e) => setBarcode(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter')
                                    barcodeToevoegen(); }, placeholder: "Scan of typ een barcode en druk Enter", style: inp })] }), _jsx("button", { onClick: () => setBewerken({ mode: 'nieuw', product: null }), style: btnBlauw, children: "+ Nieuw product" })] }), fout && _jsx("p", { style: { color: 'crimson' }, children: fout }), _jsxs("table", { style: { width: '100%', borderCollapse: 'collapse' }, children: [_jsx("thead", { children: _jsxs("tr", { style: { textAlign: 'left', borderBottom: '1px solid #ddd', fontSize: 12, color: '#666' }, children: [_jsx("th", { style: { padding: '6px 4px' }, children: "Naam" }), _jsx("th", { style: { padding: '6px 4px' }, children: "Barcode" }), _jsx("th", { style: { padding: '6px 4px', textAlign: 'right' }, children: "Verkoop" }), _jsx("th", { style: { padding: '6px 4px' }, children: "BTW" }), _jsx("th", { style: { padding: '6px 4px', textAlign: 'right' }, children: "Voorraad" })] }) }), _jsxs("tbody", { children: [lijst.map((p) => {
                                const totaalStock = p.voorraad.reduce((s, v) => s + Number(v.aantal), 0);
                                return (_jsxs("tr", { onClick: () => setBewerken({ mode: 'edit', product: p }), style: { borderBottom: '1px solid #f0f0f0', cursor: 'pointer' }, children: [_jsxs("td", { style: { padding: '8px 4px' }, children: [p.naam, p.isAlcohol && ' 🍷'] }), _jsx("td", { style: { padding: '8px 4px', fontFamily: 'monospace', fontSize: 13 }, children: p.barcode }), _jsxs("td", { style: { padding: '8px 4px', textAlign: 'right' }, children: ["\u20AC ", Number(p.verkoopprijs).toFixed(2)] }), _jsxs("td", { style: { padding: '8px 4px' }, children: [p.btwTarief.percentage, "%"] }), _jsx("td", { style: { padding: '8px 4px', textAlign: 'right' }, children: totaalStock })] }, p.id));
                            }), lijst.length === 0 && _jsx("tr", { children: _jsx("td", { colSpan: 5, style: { padding: 16, color: '#999' }, children: "Geen producten gevonden." }) })] })] })] }));
}
export function ProductForm({ meta, product, prefillBarcode, prefillAfdelingId, onKlaar, onMetaWijzig, }) {
    const [naam, setNaam] = useState(product?.naam ?? '');
    const [barcode, setBarcode] = useState(product?.barcode ?? prefillBarcode ?? '');
    const [verkoop, setVerkoop] = useState(product ? String(Number(product.verkoopprijs)) : '');
    const [inkoop, setInkoop] = useState(product?.inkoopprijs != null ? String(Number(product.inkoopprijs)) : '');
    const [btwId, setBtwId] = useState(product?.btwTariefId ?? meta.btwTarieven[0]?.id ?? '');
    const [afdId, setAfdId] = useState(product?.afdelingId
        ?? (product?.categorieId ? (meta.categorieen.find((c) => c.id === product.categorieId)?.afdelingId ?? '') : '')
        ?? prefillAfdelingId
        ?? '');
    const [catId, setCatId] = useState(product?.categorieId ?? '');
    const [levId, setLevId] = useState(product?.leverancierId ?? '');
    const [alcohol, setAlcohol] = useState(product?.isAlcohol ?? false);
    const [webshop, setWebshop] = useState(product?.webshopZichtbaar ?? false);
    const [foto, setFoto] = useState(product?.fotoUrl ?? '');
    const [eenheid, setEenheid] = useState(product?.eenheid ?? 'STUK');
    const [fout, setFout] = useState('');
    const [bezig, setBezig] = useState(false);
    const num = (s) => Number(s.replace(',', '.'));
    async function opslaan() {
        setFout('');
        if (!naam.trim()) {
            setFout('Naam is verplicht.');
            return;
        }
        if (!verkoop || Number.isNaN(num(verkoop))) {
            setFout('Geef een geldige verkoopprijs.');
            return;
        }
        if (!afdId) {
            setFout('Kies een afdeling.');
            return;
        }
        setBezig(true);
        const input = {
            naam: naam.trim(),
            barcode: barcode.trim() || null,
            verkoopprijs: num(verkoop),
            inkoopprijs: inkoop ? num(inkoop) : null,
            isAlcohol: alcohol,
            eenheid,
            webshopZichtbaar: webshop,
            fotoUrl: foto || null,
            btwTariefId: btwId,
            afdelingId: afdId || null,
            categorieId: catId || null,
            leverancierId: levId || null,
        };
        try {
            if (product)
                await updateProduct(product.id, input);
            else
                await createProduct(input);
            onKlaar();
        }
        catch (e) {
            setFout(e instanceof Error ? e.message : 'Opslaan mislukt');
        }
        finally {
            setBezig(false);
        }
    }
    async function genereer() {
        setBarcode(await nieuweBarcode());
    }
    async function uploadFoto(bestand) {
        if (!bestand)
            return;
        try {
            const { url } = await uploadSiteAfbeelding(bestand);
            setFoto(url);
        }
        catch (e) {
            setFout(e instanceof Error ? e.message : 'Uploaden mislukt');
        }
    }
    async function nieuweAfdeling() {
        const naam = window.prompt('Naam nieuwe afdeling? (bv. Traiteur, Voeding, Dranken)');
        if (!naam?.trim())
            return;
        const a = await createAfdeling(naam.trim());
        await onMetaWijzig();
        setAfdId(a.id);
    }
    async function nieuweCategorie() {
        if (!afdId) {
            setFout('Kies eerst een afdeling voor de nieuwe categorie.');
            return;
        }
        const naam = window.prompt('Naam nieuwe categorie (binnen deze afdeling)?');
        if (!naam?.trim())
            return;
        const c = await createCategorie(naam.trim(), afdId || null);
        await onMetaWijzig();
        setAfdId(c.afdelingId ?? afdId);
        setCatId(c.id);
    }
    async function nieuweLeverancier() {
        const naam = window.prompt('Naam nieuwe leverancier?');
        if (!naam?.trim())
            return;
        const l = await createLeverancier(naam.trim());
        await onMetaWijzig();
        setLevId(l.id);
    }
    return (_jsxs("div", { style: { maxWidth: 560 }, children: [_jsx("button", { onClick: onKlaar, style: { ...btnGrijs, marginBottom: 12 }, children: "\u2190 Terug naar lijst" }), _jsx("h2", { children: product ? 'Product bewerken' : 'Nieuw product' }), fout && _jsx("p", { style: { color: 'crimson' }, children: fout }), _jsx("label", { style: muted, children: "Naam *" }), _jsx("input", { value: naam, onChange: (e) => setNaam(e.target.value), style: inp, autoFocus: true }), _jsx("label", { style: muted, children: "Barcode" }), _jsxs("div", { style: { display: 'flex', gap: 8 }, children: [_jsx("input", { value: barcode, onChange: (e) => setBarcode(e.target.value), placeholder: "EAN of laat leeg voor automatisch", style: { ...inp, flex: 1 } }), _jsx("button", { onClick: genereer, style: btnGrijs, title: "Genereer een eigen in-store barcode", children: "Genereer" })] }), _jsxs("div", { style: { display: 'flex', gap: 12 }, children: [_jsxs("div", { style: { flex: 1 }, children: [_jsx("label", { style: muted, children: "Verkoopprijs (incl. BTW) *" }), _jsx("input", { value: verkoop, onChange: (e) => setVerkoop(e.target.value), inputMode: "decimal", style: inp })] }), _jsxs("div", { style: { flex: 1 }, children: [_jsx("label", { style: muted, children: "Inkoopprijs" }), _jsx("input", { value: inkoop, onChange: (e) => setInkoop(e.target.value), inputMode: "decimal", style: inp })] })] }), _jsxs("div", { style: { display: 'flex', gap: 12 }, children: [_jsxs("div", { style: { flex: 1 }, children: [_jsx("label", { style: muted, children: "BTW-tarief *" }), _jsx("select", { value: btwId, onChange: (e) => setBtwId(e.target.value), style: inp, children: meta.btwTarieven.map((b) => _jsx("option", { value: b.id, children: b.naam }, b.id)) })] }), _jsxs("div", { style: { flex: 1 }, children: [_jsx("label", { style: muted, children: "Eenheid" }), _jsxs("select", { value: eenheid, onChange: (e) => setEenheid(e.target.value), style: inp, children: [_jsx("option", { value: "STUK", children: "Stuk" }), _jsx("option", { value: "KG", children: "Kg" })] })] })] }), _jsx("label", { style: muted, children: "Afdeling (winkelsectie \u2014 verplicht)" }), _jsxs("div", { style: { display: 'flex', gap: 6, marginBottom: 8 }, children: [_jsxs("select", { value: afdId, onChange: (e) => {
                            setAfdId(e.target.value);
                            const c = meta.categorieen.find((x) => x.id === catId);
                            if (c && c.afdelingId !== e.target.value)
                                setCatId('');
                        }, style: { ...inp, flex: 1, marginBottom: 0 }, children: [_jsx("option", { value: "", children: "\u2014" }), meta.afdelingen.map((a) => _jsx("option", { value: a.id, children: a.naam }, a.id))] }), _jsx("button", { onClick: nieuweAfdeling, style: btnGrijs, children: "+" })] }), _jsxs("div", { style: { display: 'flex', gap: 12 }, children: [_jsxs("div", { style: { flex: 1 }, children: [_jsx("label", { style: muted, children: "Categorie (optioneel)" }), _jsxs("div", { style: { display: 'flex', gap: 6 }, children: [_jsxs("select", { value: catId, onChange: (e) => setCatId(e.target.value), style: { ...inp, flex: 1 }, disabled: !afdId, children: [_jsx("option", { value: "", children: "\u2014" }), meta.categorieen.filter((c) => !afdId || c.afdelingId === afdId).map((c) => _jsx("option", { value: c.id, children: c.naam }, c.id))] }), _jsx("button", { onClick: nieuweCategorie, style: btnGrijs, children: "+" })] })] }), _jsxs("div", { style: { flex: 1 }, children: [_jsx("label", { style: muted, children: "Leverancier" }), _jsxs("div", { style: { display: 'flex', gap: 6 }, children: [_jsxs("select", { value: levId, onChange: (e) => setLevId(e.target.value), style: { ...inp, flex: 1 }, children: [_jsx("option", { value: "", children: "\u2014" }), meta.leveranciers.map((l) => _jsx("option", { value: l.id, children: l.naam }, l.id))] }), _jsx("button", { onClick: nieuweLeverancier, style: btnGrijs, children: "+" })] })] })] }), _jsxs("label", { style: { display: 'flex', alignItems: 'center', gap: 8, margin: '12px 0 6px' }, children: [_jsx("input", { type: "checkbox", checked: alcohol, onChange: (e) => setAlcohol(e.target.checked) }), "Alcohol (leeftijdscontrole aan de kassa)"] }), _jsxs("label", { style: { display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 12px' }, children: [_jsx("input", { type: "checkbox", checked: webshop, onChange: (e) => setWebshop(e.target.checked) }), "Toon in de webshop (enkel zichtbaar zolang het product actief is)"] }), _jsxs("div", { style: { margin: '0 0 12px' }, children: [_jsx("div", { style: muted, children: "Productfoto (webshop)" }), foto
                        ? _jsxs("div", { style: { display: 'flex', gap: 8, alignItems: 'center' }, children: [_jsx("img", { src: foto, alt: "", style: { width: 56, height: 56, objectFit: 'cover', borderRadius: 8, border: '1px solid #e5e7eb' } }), _jsxs("label", { style: { ...btnGrijs, cursor: 'pointer' }, children: ["Vervangen", _jsx("input", { type: "file", accept: "image/*", hidden: true, onChange: (e) => uploadFoto(e.target.files?.[0]) })] }), _jsx("button", { onClick: () => setFoto(''), style: { ...btnGrijs, color: 'crimson' }, children: "\u00D7" })] })
                        : _jsxs("label", { style: { ...btnGrijs, cursor: 'pointer', display: 'inline-block' }, children: ["Foto kiezen", _jsx("input", { type: "file", accept: "image/*", hidden: true, onChange: (e) => uploadFoto(e.target.files?.[0]) })] })] }), _jsx("button", { onClick: opslaan, disabled: bezig, style: { ...btnGroen, width: '100%' }, children: bezig ? 'Bezig…' : product ? 'Wijzigingen opslaan' : 'Product aanmaken' }), product && _jsx(Ontvangst, { product: product, meta: meta })] }));
}
// Voorraad bijboeken op een locatie (bv. bij een levering).
function Ontvangst({ product, meta }) {
    const [locatieId, setLocatieId] = useState(meta.locaties[0]?.id ?? '');
    const [aantal, setAantal] = useState('');
    const [melding, setMelding] = useState('');
    async function boek() {
        const n = Number(aantal.replace(',', '.'));
        if (!n)
            return;
        await voorraadOntvangst(product.id, locatieId, n);
        setMelding(`+${n} geboekt.`);
        setAantal('');
    }
    return (_jsxs("div", { style: { marginTop: 20, borderTop: '1px solid #e5e7eb', paddingTop: 14 }, children: [_jsx("h3", { style: { margin: '0 0 8px' }, children: "Voorraad ontvangen" }), _jsxs("div", { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }, children: [_jsx("select", { value: locatieId, onChange: (e) => setLocatieId(e.target.value), style: { ...inp, width: 'auto' }, children: meta.locaties.map((l) => _jsx("option", { value: l.id, children: l.naam }, l.id)) }), _jsx("input", { value: aantal, onChange: (e) => setAantal(e.target.value), inputMode: "decimal", placeholder: "Aantal", style: { ...inp, width: 120 } }), _jsx("button", { onClick: boek, style: btnBlauw, children: "Boek ontvangst" }), melding && _jsx("span", { style: { color: '#16a34a' }, children: melding })] }), _jsxs("div", { style: { ...muted, marginTop: 8 }, children: ["Huidige voorraad: ", product.voorraad.map((v) => `${v.locatie?.naam ?? v.locatieId}: ${Number(v.aantal)}`).join(' · ') || '—'] })] }));
}
const inp = { width: '100%', padding: 9, fontSize: 15, boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 6, marginBottom: 8 };
const muted = { fontSize: 12, color: '#6b7280', display: 'block', marginBottom: 2 };
const btnBlauw = { padding: '9px 14px', border: 'none', borderRadius: 6, background: '#2563eb', color: '#fff', cursor: 'pointer', fontWeight: 600 };
const btnGroen = { padding: 12, border: 'none', borderRadius: 8, background: '#16a34a', color: '#fff', cursor: 'pointer', fontWeight: 700, fontSize: 16 };
const btnGrijs = { padding: '9px 12px', border: '1px solid #cbd5e1', borderRadius: 6, background: '#fff', cursor: 'pointer' };
