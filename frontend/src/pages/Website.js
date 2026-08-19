import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { getSiteInhoud, zetSiteTeksten, zetOpeningsuren, nieuwePartner, updatePartner, verwijderPartner, uploadSiteAfbeelding, } from '../api/client';
const DAGEN = ['', 'Maandag', 'Dinsdag', 'Woensdag', 'Donderdag', 'Vrijdag', 'Zaterdag', 'Zondag'];
const AANBOD_TILES = [
    { slug: 'fruit', naam: 'Fruit' }, { slug: 'groenten', naam: 'Groenten' }, { slug: 'vlees', naam: 'Vlees' },
    { slug: 'vis', naam: 'Vis' }, { slug: 'kaas', naam: 'Kaas & Zuivel' }, { slug: 'traiteur', naam: 'Traiteur' },
    { slug: 'droge', naam: 'Droge voeding' }, { slug: 'wijnkelder', naam: 'Wijnkelder' },
];
function parseGalerij(w) {
    if (!w)
        return [];
    try {
        const v = JSON.parse(w);
        return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
    }
    catch {
        return [];
    }
}
const TEKSTVELDEN = [
    { groep: 'Bovenaan (hero)' },
    { sleutel: 'hero_eyebrow', label: 'Labeltekst bovenaan' },
    { sleutel: 'hero_titel', label: 'Titel (deel 1)' },
    { sleutel: 'hero_titel_accent', label: 'Titel (accent, in kleur)' },
    { sleutel: 'hero_intro', label: 'Introtekst', groot: true },
    { groep: 'Kwaliteitslabels (3 blokjes onder de titel)' },
    { sleutel: 'trust1_titel', label: 'Label 1 — titel' },
    { sleutel: 'trust1_sub', label: 'Label 1 — subtekst' },
    { sleutel: 'trust2_titel', label: 'Label 2 — titel' },
    { sleutel: 'trust2_sub', label: 'Label 2 — subtekst' },
    { sleutel: 'trust3_titel', label: 'Label 3 — titel' },
    { sleutel: 'trust3_sub', label: 'Label 3 — subtekst' },
    { groep: 'Kaartjes "Vers vandaag" (rechts bovenaan)' },
    { sleutel: 'ribbon', label: 'Badge-tekst' },
    { sleutel: 'card1_naam', label: 'Kaart 1 — naam' },
    { sleutel: 'card1_sub', label: 'Kaart 1 — subtekst' },
    { sleutel: 'card1_prijs', label: 'Kaart 1 — prijs' },
    { sleutel: 'card2_naam', label: 'Kaart 2 — naam' },
    { sleutel: 'card2_sub', label: 'Kaart 2 — subtekst' },
    { sleutel: 'card2_prijs', label: 'Kaart 2 — prijs' },
    { sleutel: 'card3_naam', label: 'Kaart 3 — naam' },
    { sleutel: 'card3_sub', label: 'Kaart 3 — subtekst' },
    { sleutel: 'card3_prijs', label: 'Kaart 3 — prijs' },
    { groep: 'Ons aanbod' },
    { sleutel: 'aanbod_titel', label: 'Titel' },
    { sleutel: 'aanbod_intro', label: 'Introtekst', groot: true },
    { groep: 'Webshop-blok' },
    { sleutel: 'webshop_titel', label: 'Titel (deel 1)' },
    { sleutel: 'webshop_titel_accent', label: 'Titel (accent, in kleur)' },
    { sleutel: 'webshop_intro', label: 'Introtekst', groot: true },
    { groep: 'Contact' },
    { sleutel: 'contact_adres', label: 'Adres' },
    { sleutel: 'contact_telefoon', label: 'Telefoon' },
    { sleutel: 'contact_email', label: 'E-mail' },
];
// Website-beheer: teksten, openingsuren en partners van de publieke site zelf
// aanpassen. Wat je hier bewaart, verschijnt meteen op marché.eu.
export function Website() {
    const [teksten, setTeksten] = useState({});
    const [heroFoto, setHeroFoto] = useState('');
    const [aanbodFotos, setAanbodFotos] = useState({});
    const [galerij, setGalerij] = useState([]);
    const [uren, setUren] = useState([]);
    const [partners, setPartners] = useState([]);
    const [pNaam, setPNaam] = useState('');
    const [pWebsite, setPWebsite] = useState('');
    const [melding, setMelding] = useState('');
    const [fout, setFout] = useState('');
    function vulIn(i) {
        const t = {};
        for (const v of TEKSTVELDEN)
            if ('sleutel' in v)
                t[v.sleutel] = i.teksten[v.sleutel] ?? '';
        setTeksten(t);
        setHeroFoto(i.teksten['hero_afbeelding'] ?? '');
        const af = {};
        for (const t of AANBOD_TILES)
            af[t.slug] = i.teksten[`aanbodfoto_${t.slug}`] ?? '';
        setAanbodFotos(af);
        setGalerij(parseGalerij(i.teksten['galerij']));
        // Zorg dat er altijd 7 dagen zijn.
        const perDag = new Map(i.openingsuren.map((u) => [u.dag, u]));
        setUren(Array.from({ length: 7 }, (_, k) => perDag.get(k + 1) ?? { id: '', dag: k + 1, gesloten: false, van: '', tot: '' }));
        setPartners(i.partners);
    }
    async function laad() { vulIn(await getSiteInhoud()); }
    useEffect(() => { laad(); }, []);
    function flits(m) { setMelding(m); setTimeout(() => setMelding(''), 2500); }
    async function bewaarTeksten() {
        setFout('');
        try {
            await zetSiteTeksten(teksten);
            flits('Teksten bewaard.');
        }
        catch (e) {
            setFout(e instanceof Error ? e.message : 'Bewaren mislukt');
        }
    }
    async function bewaarUren() {
        setFout('');
        try {
            const rijen = uren.map((u) => ({ dag: u.dag, gesloten: u.gesloten, van: u.van || null, tot: u.tot || null }));
            const nieuw = await zetOpeningsuren(rijen);
            setUren(nieuw);
            flits('Openingsuren bewaard.');
        }
        catch (e) {
            setFout(e instanceof Error ? e.message : 'Bewaren mislukt');
        }
    }
    async function voegPartnerToe() {
        if (!pNaam.trim())
            return;
        setFout('');
        try {
            await nieuwePartner({ naam: pNaam.trim(), website: pWebsite.trim() || null, volgorde: partners.length });
            setPNaam('');
            setPWebsite('');
            await laad();
        }
        catch (e) {
            setFout(e instanceof Error ? e.message : 'Toevoegen mislukt');
        }
    }
    async function uploadHero(bestand) {
        if (!bestand)
            return;
        setFout('');
        try {
            const { url } = await uploadSiteAfbeelding(bestand);
            await zetSiteTeksten({ hero_afbeelding: url });
            setHeroFoto(url);
            flits('Hero-foto bewaard.');
        }
        catch (e) {
            setFout(e instanceof Error ? e.message : 'Uploaden mislukt');
        }
    }
    async function verwijderHero() {
        await zetSiteTeksten({ hero_afbeelding: '' });
        setHeroFoto('');
        flits('Hero-foto verwijderd.');
    }
    async function uploadAanbodFoto(slug, bestand) {
        if (!bestand)
            return;
        setFout('');
        try {
            const { url } = await uploadSiteAfbeelding(bestand);
            await zetSiteTeksten({ [`aanbodfoto_${slug}`]: url });
            setAanbodFotos((a) => ({ ...a, [slug]: url }));
            flits('Foto bewaard.');
        }
        catch (e) {
            setFout(e instanceof Error ? e.message : 'Uploaden mislukt');
        }
    }
    async function verwijderAanbodFoto(slug) {
        await zetSiteTeksten({ [`aanbodfoto_${slug}`]: '' });
        setAanbodFotos((a) => ({ ...a, [slug]: '' }));
        flits('Foto verwijderd.');
    }
    async function uploadGalerij(bestand) {
        if (!bestand)
            return;
        setFout('');
        try {
            const { url } = await uploadSiteAfbeelding(bestand);
            const nieuw = [...galerij, url];
            await zetSiteTeksten({ galerij: JSON.stringify(nieuw) });
            setGalerij(nieuw);
            flits('Foto toegevoegd.');
        }
        catch (e) {
            setFout(e instanceof Error ? e.message : 'Uploaden mislukt');
        }
    }
    async function verwijderGalerijFoto(url) {
        const nieuw = galerij.filter((u) => u !== url);
        await zetSiteTeksten({ galerij: JSON.stringify(nieuw) });
        setGalerij(nieuw);
    }
    async function uploadPartnerLogo(p, bestand) {
        if (!bestand)
            return;
        setFout('');
        try {
            const { url } = await uploadSiteAfbeelding(bestand);
            await updatePartner(p.id, { logoUrl: url });
            await laad();
        }
        catch (e) {
            setFout(e instanceof Error ? e.message : 'Uploaden mislukt');
        }
    }
    async function schrapPartner(id) { await verwijderPartner(id); await laad(); }
    async function hernoemPartner(p, naam) {
        setPartners((ps) => ps.map((x) => (x.id === p.id ? { ...x, naam } : x)));
    }
    async function bewaarPartner(p) { await updatePartner(p.id, { naam: p.naam, website: p.website }); flits('Partner bewaard.'); }
    return (_jsxs("div", { style: { maxWidth: 760 }, children: [_jsx("h2", { children: "Website" }), _jsx("p", { style: { color: '#6b7280', marginTop: 4 }, children: "Pas de inhoud van de publieke site aan. Wijzigingen verschijnen meteen op de site." }), melding && _jsx("div", { style: { background: '#dcfce7', color: '#166534', padding: '8px 12px', borderRadius: 8, margin: '10px 0' }, children: melding }), fout && _jsx("div", { style: { color: 'crimson', margin: '10px 0' }, children: fout }), _jsxs("section", { style: kaart, children: [_jsx("h3", { style: { marginTop: 0 }, children: "Teksten" }), TEKSTVELDEN.map((v, idx) => ('groep' in v ? (_jsx("div", { style: { fontWeight: 700, color: '#0d4589', margin: idx === 0 ? '0 0 8px' : '20px 0 8px', borderBottom: '1px solid #e5e7eb', paddingBottom: 4 }, children: v.groep }, 'g' + idx)) : (_jsxs("div", { style: { marginBottom: 12 }, children: [_jsx("div", { style: muted, children: v.label }), v.groot
                                ? _jsx("textarea", { value: teksten[v.sleutel] ?? '', onChange: (e) => setTeksten({ ...teksten, [v.sleutel]: e.target.value }), rows: 3, style: { ...inp, width: '100%', resize: 'vertical' } })
                                : _jsx("input", { value: teksten[v.sleutel] ?? '', onChange: (e) => setTeksten({ ...teksten, [v.sleutel]: e.target.value }), style: { ...inp, width: '100%' } })] }, v.sleutel)))), _jsx("button", { onClick: bewaarTeksten, style: btnBlauw, children: "Teksten bewaren" })] }), _jsxs("section", { style: kaart, children: [_jsx("h3", { style: { marginTop: 0 }, children: "Foto's" }), _jsx("div", { style: muted, children: "Hero-foto (grote sfeerfoto bovenaan). Vervangt de kaartjes rechts." }), heroFoto
                        ? _jsxs("div", { style: { marginTop: 8 }, children: [_jsx("img", { src: heroFoto, alt: "Hero", style: { maxWidth: 320, width: '100%', borderRadius: 10, border: '1px solid #e5e7eb', display: 'block' } }), _jsxs("div", { style: { marginTop: 8, display: 'flex', gap: 8 }, children: [_jsxs("label", { style: { ...btnMini, cursor: 'pointer' }, children: ["Vervangen", _jsx("input", { type: "file", accept: "image/*", hidden: true, onChange: (e) => uploadHero(e.target.files?.[0]) })] }), _jsx("button", { onClick: verwijderHero, style: { ...btnMini, color: 'crimson' }, children: "Verwijderen" })] })] })
                        : _jsxs("label", { style: { ...btnBlauw, display: 'inline-block', cursor: 'pointer', marginTop: 8 }, children: ["Foto kiezen", _jsx("input", { type: "file", accept: "image/*", hidden: true, onChange: (e) => uploadHero(e.target.files?.[0]) })] })] }), _jsxs("section", { style: kaart, children: [_jsx("h3", { style: { marginTop: 0 }, children: "Foto per afdeling (\"Ons aanbod\")" }), _jsx("div", { style: muted, children: "Zonder foto toont de tegel een icoontje." }), _jsx("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12, marginTop: 10 }, children: AANBOD_TILES.map((t) => (_jsxs("div", { style: { border: '1px solid #e5e7eb', borderRadius: 10, padding: 10 }, children: [_jsx("div", { style: { fontWeight: 600, marginBottom: 6 }, children: t.naam }), aanbodFotos[t.slug]
                                    ? _jsx("img", { src: aanbodFotos[t.slug], alt: t.naam, style: { width: '100%', height: 90, objectFit: 'cover', borderRadius: 8 } })
                                    : _jsx("div", { style: { height: 90, borderRadius: 8, border: '1px dashed #cbd5e1', display: 'grid', placeItems: 'center', color: '#9ca3af', fontSize: 13 }, children: "geen foto" }), _jsxs("div", { style: { display: 'flex', gap: 6, marginTop: 6 }, children: [_jsxs("label", { style: { ...btnMini, cursor: 'pointer' }, children: [aanbodFotos[t.slug] ? 'Vervangen' : 'Kiezen', _jsx("input", { type: "file", accept: "image/*", hidden: true, onChange: (e) => uploadAanbodFoto(t.slug, e.target.files?.[0]) })] }), aanbodFotos[t.slug] && _jsx("button", { onClick: () => verwijderAanbodFoto(t.slug), style: { ...btnMini, color: 'crimson' }, children: "\u00D7" })] })] }, t.slug))) })] }), _jsxs("section", { style: kaart, children: [_jsx("h3", { style: { marginTop: 0 }, children: "Sfeerfoto's (galerij)" }), _jsx("div", { style: muted, children: "Een strook foto's op de landingspagina. Leeg = de strook wordt niet getoond." }), _jsxs("label", { style: { ...btnBlauw, display: 'inline-block', cursor: 'pointer', margin: '10px 0' }, children: ["Foto toevoegen", _jsx("input", { type: "file", accept: "image/*", hidden: true, onChange: (e) => uploadGalerij(e.target.files?.[0]) })] }), _jsxs("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 10 }, children: [galerij.map((url) => (_jsxs("div", { style: { position: 'relative' }, children: [_jsx("img", { src: url, alt: "", style: { width: '100%', height: 100, objectFit: 'cover', borderRadius: 8, border: '1px solid #e5e7eb' } }), _jsx("button", { onClick: () => verwijderGalerijFoto(url), title: "Verwijderen", style: { position: 'absolute', top: 4, right: 4, border: 'none', borderRadius: 6, background: 'rgba(0,0,0,.6)', color: '#fff', cursor: 'pointer', width: 24, height: 24 }, children: "\u00D7" })] }, url))), galerij.length === 0 && _jsx("div", { style: { color: '#999' }, children: "Nog geen sfeerfoto's." })] })] }), _jsxs("section", { style: kaart, children: [_jsx("h3", { style: { marginTop: 0 }, children: "Openingsuren" }), _jsx("table", { style: { width: '100%', borderCollapse: 'collapse' }, children: _jsx("tbody", { children: uren.map((u, i) => (_jsxs("tr", { style: { borderBottom: '1px solid #f0f0f0' }, children: [_jsx("td", { style: { padding: '8px 6px', width: 120 }, children: DAGEN[u.dag] }), _jsx("td", { style: { padding: '8px 6px', width: 110 }, children: _jsxs("label", { style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#374151' }, children: [_jsx("input", { type: "checkbox", checked: u.gesloten, onChange: (e) => setUren(uren.map((x, k) => k === i ? { ...x, gesloten: e.target.checked } : x)) }), "gesloten"] }) }), _jsx("td", { style: { padding: '8px 6px' }, children: !u.gesloten && (_jsxs("span", { style: { display: 'inline-flex', alignItems: 'center', gap: 6 }, children: [_jsx("input", { type: "time", value: u.van ?? '', onChange: (e) => setUren(uren.map((x, k) => k === i ? { ...x, van: e.target.value } : x)), style: { ...inp, marginBottom: 0 } }), _jsx("span", { children: "tot" }), _jsx("input", { type: "time", value: u.tot ?? '', onChange: (e) => setUren(uren.map((x, k) => k === i ? { ...x, tot: e.target.value } : x)), style: { ...inp, marginBottom: 0 } })] })) })] }, u.dag))) }) }), _jsx("button", { onClick: bewaarUren, style: { ...btnBlauw, marginTop: 12 }, children: "Openingsuren bewaren" })] }), _jsxs("section", { style: kaart, children: [_jsx("h3", { style: { marginTop: 0 }, children: "Partners" }), _jsxs("div", { style: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }, children: [_jsxs("div", { children: [_jsx("div", { style: muted, children: "Naam" }), _jsx("input", { value: pNaam, onChange: (e) => setPNaam(e.target.value), style: { ...inp, width: 200 } })] }), _jsxs("div", { children: [_jsx("div", { style: muted, children: "Website (optioneel)" }), _jsx("input", { value: pWebsite, onChange: (e) => setPWebsite(e.target.value), placeholder: "https://\u2026", style: { ...inp, width: 220 } })] }), _jsx("button", { onClick: voegPartnerToe, style: btnBlauw, children: "Toevoegen" })] }), partners.map((p) => (_jsxs("div", { style: { display: 'flex', gap: 8, alignItems: 'center', borderBottom: '1px solid #f0f0f0', padding: '6px 0' }, children: [p.logoUrl
                                ? _jsx("img", { src: p.logoUrl, alt: p.naam, style: { width: 40, height: 40, objectFit: 'contain', borderRadius: 6, border: '1px solid #e5e7eb' } })
                                : _jsx("span", { style: { width: 40, height: 40, borderRadius: 6, border: '1px dashed #cbd5e1', display: 'inline-block' } }), _jsx("input", { value: p.naam, onChange: (e) => hernoemPartner(p, e.target.value), style: { ...inp, marginBottom: 0, width: 170 } }), _jsx("input", { value: p.website ?? '', onChange: (e) => setPartners(partners.map((x) => x.id === p.id ? { ...x, website: e.target.value } : x)), placeholder: "https://\u2026", style: { ...inp, marginBottom: 0, flex: 1 } }), _jsxs("label", { style: { ...btnMini, cursor: 'pointer' }, children: ["Logo\u2026", _jsx("input", { type: "file", accept: "image/*", hidden: true, onChange: (e) => uploadPartnerLogo(p, e.target.files?.[0]) })] }), _jsx("button", { onClick: () => bewaarPartner(p), style: btnMini, children: "Bewaren" }), _jsx("button", { onClick: () => schrapPartner(p.id), style: { ...btnMini, color: 'crimson' }, children: "\u00D7" })] }, p.id))), partners.length === 0 && _jsx("div", { style: { color: '#999' }, children: "Nog geen partners." })] })] }));
}
const kaart = { border: '1px solid #e5e7eb', borderRadius: 12, padding: 18, margin: '16px 0' };
const inp = { padding: 8, fontSize: 14, boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 6, marginBottom: 8 };
const muted = { fontSize: 12, color: '#6b7280', marginBottom: 2 };
const btnBlauw = { padding: '9px 16px', border: 'none', borderRadius: 6, background: '#0d4589', color: '#fff', cursor: 'pointer', fontWeight: 600 };
const btnMini = { padding: '4px 10px', border: '1px solid #cbd5e1', borderRadius: 5, background: '#fff', cursor: 'pointer', fontSize: 13 };
