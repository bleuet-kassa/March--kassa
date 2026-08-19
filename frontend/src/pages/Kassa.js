import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from 'react';
import { getProductByBarcode, afrekenen, getMeta, getKortingsregelingen, getGebruikers, getWeegEtiket, getSpeciaalProducten, getRekeningenKassa, createProduct, } from '../api/client';
import { getVerkoper } from '../auth';
import { drukEtiketAf, parseWeegBarcode } from '../etiket';
import { getCachedProduct, getCachedProducten, ververCache, enqueue, isNetwerkfout, } from '../offline';
// Het "getekende" aantal: bij een retour telt de lijn negatief mee, zodat ze
// van het totaal (en van een lopende rekening) wordt afgetrokken.
const tekenAantal = (l) => (l.retour ? -Math.abs(l.aantal) : l.aantal);
const ADMIN_ROLLEN = ['BEHEER', 'BEHEERDER'];
// Nette naam van een betaalwijze (voor de knoppen, het ticket en de dagafsluiting).
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
// Kort waarschuwingsgeluidje (geen bestand nodig) — bv. bij een onbekende scan.
function piep() {
    try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx)
            return;
        const ctx = new Ctx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.value = 340;
        gain.gain.value = 0.08;
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.28);
        osc.onended = () => ctx.close();
    }
    catch { /* geluid niet beschikbaar — geen probleem */ }
}
function genKey() {
    return typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : String(Date.now()) + Math.random().toString(16).slice(2);
}
const CASH_LIMIET = 3000;
function maakBon() {
    return { id: genKey(), verkoperId: '', lijnen: [], betaalwijze: 'BANCONTACT', ontvangen: '', gekozenRegelingId: '', handkorting: 0, opRekening: false, rekeningBedrijfId: '', rekeningLidId: '', retourModus: false };
}
// Kassascherm (Fase 2): scannen, aantallen, betaalwijze, BTW-uitsplitsing,
// cash-teruggave en een ticket. Een USB-barcodescanner gedraagt zich als een
// toetsenbord: hij "typt" de code en drukt Enter — daarom vangen we Enter op.
export function Kassa() {
    const [barcode, setBarcode] = useState('');
    const [fout, setFout] = useState('');
    const [bezig, setBezig] = useState(false);
    const [ticket, setTicket] = useState(null);
    // Tegel-kassa: producten + afdelingen, gekozen afdeling/categorie, weegmodal.
    const [producten, setProducten] = useState(getCachedProducten());
    const [afdelingen, setAfdelingen] = useState([]);
    const [afdId, setAfdId] = useState('');
    const [catId, setCatId] = useState(null);
    const [weegProduct, setWeegProduct] = useState(null);
    // Kortingsregelingen (personeel / friends & family) — enkel voor beheerders.
    const [regelingen, setRegelingen] = useState([]);
    // Verkopers voor de naam-keuze per ticket.
    const [verkopers, setVerkopers] = useState([]);
    // "Diversen"/cadeaubon-knoppen (vrij bedrag aan een vaste BTW-voet).
    const [speciaal, setSpeciaal] = useState([]);
    // Welk "diversen"-product krijgt een bedrag ingetikt (opent het cijferklavier).
    const [vrijProduct, setVrijProduct] = useState(null);
    // Gescande barcode die (nog) niet in het systeem zit -> toont een pop-up.
    const [onbekendeBarcode, setOnbekendeBarcode] = useState(null);
    // Nieuw-artikel-flow (afdeling kiezen -> barcode scannen -> aanmaken).
    const [btwTarieven, setBtwTarieven] = useState([]);
    const [metaCategorieen, setMetaCategorieen] = useState([]);
    // null = dicht; anders de (eventueel al ingevulde) start-barcode.
    const [nieuwArtikel, setNieuwArtikel] = useState(null);
    // Cijferklavier voor het cash-ontvangen bedrag (touchscreen).
    const [ontvangstKlavier, setOntvangstKlavier] = useState(false);
    // Cijferklavier voor de manuele korting (%).
    const [kortingKlavier, setKortingKlavier] = useState(false);
    // Welke lijn krijgt een lijnkorting via het klavier (key van de lijn).
    const [kortingLijn, setKortingLijn] = useState(null);
    const [aantalLijn, setAantalLijn] = useState(null);
    // Bedrijven met leden voor "op rekening".
    const [rekeningBedrijven, setRekeningBedrijven] = useState([]);
    // Prijs/kg-flow: eerst prijs per kg, dan gewicht.
    const [prijsKgStap, setPrijsKgStap] = useState(null);
    const [prijsKgWaarde, setPrijsKgWaarde] = useState(0);
    // Meerdere tickets tegelijk open; elk een eigen mandje + verkoper.
    const [bonnen, setBonnen] = useState(() => [maakBon()]);
    const [actiefId, setActiefId] = useState('');
    const inputRef = useRef(null);
    const scanRef = useRef(() => { });
    const scanTimer = useRef(undefined);
    const verkoper = getVerkoper();
    const isAdmin = ADMIN_ROLLEN.includes((verkoper?.rol ?? '').toUpperCase());
    // Het actieve ticket + afgeleide waarden. Wrapper-setters schrijven telkens
    // naar het actieve ticket, zodat de bestaande code (lijnen, betaalwijze, …)
    // ongewijzigd kan blijven werken.
    const bon = bonnen.find((b) => b.id === actiefId) ?? bonnen[0];
    const lijnen = bon.lijnen;
    const betaalwijze = bon.betaalwijze;
    const ontvangen = bon.ontvangen;
    const gekozenRegelingId = bon.gekozenRegelingId;
    const retourModus = bon.retourModus ?? false; // negatieve rekening: nieuwe lijnen worden afgetrokken
    function patchBon(id, patch) {
        setBonnen((bs) => bs.map((b) => (b.id === id ? { ...b, ...patch } : b)));
    }
    function setLijnen(updater) {
        setBonnen((bs) => bs.map((b) => (b.id === bon.id
            ? { ...b, lijnen: typeof updater === 'function' ? updater(b.lijnen) : updater }
            : b)));
    }
    const setBetaalwijze = (v) => patchBon(bon.id, { betaalwijze: v });
    const setOntvangen = (v) => patchBon(bon.id, { ontvangen: v });
    const setGekozenRegelingId = (v) => patchBon(bon.id, { gekozenRegelingId: v });
    // Als het actiefId nog niet (meer) bestaat, val terug op het eerste ticket.
    useEffect(() => {
        if (!bonnen.some((b) => b.id === actiefId))
            setActiefId(bonnen[0]?.id ?? '');
    }, [bonnen, actiefId]);
    function nieuwBon() {
        const b = maakBon();
        setBonnen((bs) => [...bs, b]);
        setActiefId(b.id);
        setCatId(null);
    }
    function sluitBon(id) {
        const doelwit = bonnen.find((b) => b.id === id);
        if (doelwit && doelwit.lijnen.length > 0 && !window.confirm('Dit ticket heeft nog artikels. Sluiten?'))
            return;
        setBonnen((bs) => {
            const rest = bs.filter((b) => b.id !== id);
            return rest.length ? rest : [maakBon()];
        });
    }
    useEffect(() => {
        if (!ticket)
            inputRef.current?.focus();
    }, [ticket]);
    // Ververs de lokale productcache (voor scannen én de tegels) + afdelingen,
    // verkopers, kortingen, speciale knoppen en lopende rekeningen. Herbruikbaar
    // via de "Vernieuwen"-knop, zodat het touchscreen zonder F5 kan verversen.
    async function laadData() {
        await ververCache();
        setProducten(getCachedProducten());
        getMeta().then((m) => { setAfdelingen(m.afdelingen); setBtwTarieven(m.btwTarieven); setMetaCategorieen(m.categorieen); }).catch(() => { });
        // Kortingsregelingen enkel voor beheerders (endpoint is admin-only).
        if (isAdmin)
            getKortingsregelingen().then((r) => setRegelingen(Array.isArray(r) ? r : [])).catch(() => { });
        getGebruikers().then(setVerkopers).catch(() => { });
        getSpeciaalProducten().then((s) => setSpeciaal(Array.isArray(s) ? s : [])).catch(() => { });
        getRekeningenKassa().then((r) => setRekeningBedrijven(Array.isArray(r) ? r : [])).catch(() => { });
    }
    useEffect(() => { laadData(); }, []);
    // Toont kort een bevestiging na het handmatig verversen.
    const [vernieuwd, setVernieuwd] = useState(false);
    async function vernieuwNu() {
        await laadData();
        setVernieuwd(true);
        window.setTimeout(() => setVernieuwd(false), 1500);
    }
    // Globale barcodescanner-opvang: een scanner "typt" de code supersnel en sluit
    // af met Enter. We vangen dat overal op (behalve wanneer je in een tekstveld
    // typt), zodat scannen werkt ongeacht waar de focus staat — handig op touch.
    useEffect(() => {
        let buf = '';
        let last = 0;
        let timer;
        const verwerk = () => { if (buf.length >= 4) {
            const code = buf;
            buf = '';
            scanRef.current(code);
        } };
        function onKey(e) {
            const el = document.activeElement;
            if (el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))
                return; // handmatig typen met rust laten
            const nu = Date.now();
            if (nu - last > 120)
                buf = ''; // trage toets = nieuwe reeks (geen scanner)
            last = nu;
            if (timer)
                window.clearTimeout(timer);
            if (e.key === 'Enter') {
                verwerk();
                return;
            }
            if (e.key.length === 1)
                buf += e.key;
            timer = window.setTimeout(verwerk, 150); // scanner zonder Enter -> na korte pauze
        }
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);
    // "Diversen"/cadeaubon: open het cijferklavier voor dit product.
    function voegVrijBedrag(sp) {
        setFout('');
        setVrijProduct(sp);
    }
    // Prijs/kg: lijn = prijs per kg (stukprijs) × gewicht (aantal).
    function voegPrijsKgToe(prijsPerKg, gewicht) {
        const p = speciaal.find((s) => s.interneCode === 'PRIJSKG');
        if (!p)
            return;
        setLijnen((l) => [
            ...l,
            {
                key: genKey(),
                productId: p.id,
                naam: `Prijs/kg (${gewicht.toFixed(3)} kg)`,
                prijs: prijsPerKg,
                btwPercentage: Number(p.btwTarief.percentage),
                isAlcohol: false,
                aantal: gewicht,
                kortingPct: 0,
                vrijBedrag: true,
                vastAantal: true,
                retour: retourModus,
            },
        ]);
        setPrijsKgStap(null);
        setPrijsKgWaarde(0);
    }
    // Bevestigd bedrag uit het klavier -> vrij-bedrag-lijn toevoegen.
    function voegVrijBedragToe(sp, bedrag, aantal = 1) {
        setLijnen((l) => [
            ...l,
            {
                key: genKey(),
                productId: sp.id,
                naam: sp.naam,
                prijs: Math.round(bedrag * 100) / 100,
                btwPercentage: Number(sp.btwTarief.percentage),
                isAlcohol: false,
                aantal: aantal > 0 ? aantal : 1,
                kortingPct: 0,
                vrijBedrag: true,
                retour: retourModus,
            },
        ]);
        setVrijProduct(null);
    }
    // Voegt een product toe aan het ticket. Weegproducten (eenheid KG) krijgen
    // een gewicht (in kg) als aantal; stukproducten tellen op.
    function voegToe(p, aantal, weeg = false) {
        if (p.isAlcohol) {
            const ok = window.confirm('Alcohol: klant 16+ (wijn/bier) of 18+ (sterke drank)?');
            if (!ok)
                return;
        }
        setLijnen((l) => {
            if (!weeg) {
                // Losse stukproducten zonder eigen korting tellen we samen — maar enkel
                // met een lijn van hetzelfde teken (gewone verkoop bij verkoop, retour bij retour).
                const bestaat = l.find((x) => x.productId === p.id && x.kortingPct === 0 && !!x.retour === retourModus);
                if (bestaat)
                    return l.map((x) => (x === bestaat ? { ...x, aantal: x.aantal + aantal } : x));
            }
            return [
                ...l,
                {
                    key: genKey(),
                    productId: p.id,
                    naam: p.naam,
                    prijs: Number(p.verkoopprijs),
                    btwPercentage: Number(p.btwTarief.percentage),
                    isAlcohol: p.isAlcohol,
                    aantal,
                    kortingPct: 0,
                    retour: retourModus,
                },
            ];
        });
    }
    // Klik op een producttegel: weegproduct -> gewicht vragen; anders 1 stuk.
    function kiesProduct(p) {
        if (p.eenheid === 'KG')
            setWeegProduct(p);
        else
            voegToe(p, 1);
    }
    // Nieuw artikel aangemaakt vanuit de kassa: cache verversen (zodat scannen het
    // meteen vindt) en desgewenst op het ticket zetten.
    async function artikelAangemaakt(p, opTicket) {
        await ververCache();
        setProducten(getCachedProducten());
        if (opTicket)
            voegToe(p, 1);
        setNieuwArtikel(null);
    }
    // Verwerkt één gescande/ingetikte code (barcode of weeg-etiket).
    async function scanCode(rawCode) {
        const code = rawCode.trim();
        if (!code)
            return;
        setFout('');
        setOnbekendeBarcode(null);
        // Weeg-etiketbarcode (prefix 21)? Zoek het weegproduct en voeg het gewogen
        // artikel toe met het gewicht uit de barcode.
        const weeg = parseWeegBarcode(code);
        if (weeg) {
            const wp = producten.find((x) => x.weegNummer === weeg.weegNummer);
            if (wp)
                voegToe(wp, Math.round((weeg.gram / 1000) * 1000) / 1000, true);
            else
                setFout(`Onbekend weeg-etiket (nr ${weeg.weegNummer})`);
            return;
        }
        // Eerst de lokale cache (werkt offline); enkel als de server bereikbaar is
        // en het product niet gecached is, vragen we het online op.
        let p = getCachedProduct(code);
        if (!p && navigator.onLine) {
            try {
                p = (await getProductByBarcode(code));
            }
            catch { /* laat p leeg */ }
        }
        if (!p) {
            setOnbekendeBarcode(code);
            piep();
            return;
        }
        voegToe(p, 1);
    }
    async function scan() {
        if (scanTimer.current)
            window.clearTimeout(scanTimer.current);
        await scanCode(barcode);
        setBarcode('');
    }
    // Scanner zonder Enter-suffix: verwerk de code zodra het typen ~150ms stilvalt
    // (en ze lang genoeg is). Elke wijziging herstart de timer.
    function onBarcodeChange(v) {
        setBarcode(v);
        if (scanTimer.current)
            window.clearTimeout(scanTimer.current);
        const val = v.trim();
        if (val.length >= 6) {
            scanTimer.current = window.setTimeout(() => { scanRef.current(val); setBarcode(''); }, 150);
        }
    }
    // Steeds de nieuwste scanCode (met het actieve ticket) voor de globale opvang.
    scanRef.current = scanCode;
    // Vraagt de etiketgegevens op en opent het printvenster (Zebra/gewone printer).
    async function etiketAfdrukken(p, kg) {
        try {
            const e = await getWeegEtiket(p.id, kg);
            drukEtiketAf({ naam: e.naam, weegNummer: e.weegNummer, eenheidsprijs: e.eenheidsprijs, gewicht: e.gewicht, prijs: e.prijs, barcode: e.barcode });
            // Vernieuw de cache zodat het nieuwe weegnummer lokaal bekend is (voor scannen).
            ververCache().then(() => setProducten(getCachedProducten()));
            setWeegProduct(null);
        }
        catch (err) {
            setFout(err instanceof Error ? err.message : 'Etiket afdrukken mislukt');
        }
    }
    function wijzigAantal(key, delta) {
        setLijnen((l) => l
            .map((x) => (x.key === key ? { ...x, aantal: Math.round((x.aantal + delta) * 1000) / 1000 } : x))
            .filter((x) => x.aantal > 0));
    }
    // Direct een aantal invoeren (handig voor gewichten, bv. 0,750 kg).
    function zetAantal(key, waarde) {
        const n = Number(waarde.replace(',', '.'));
        if (Number.isNaN(n))
            return;
        setLijnen((l) => l.map((x) => (x.key === key ? { ...x, aantal: n } : x)));
    }
    // Korting per lijn (0-100%), begrensd.
    function zetKorting(key, waarde) {
        const n = Math.min(100, Math.max(0, Number(waarde.replace(',', '.')) || 0));
        setLijnen((l) => l.map((x) => (x.key === key ? { ...x, kortingPct: n } : x)));
    }
    function verwijder(key) {
        setLijnen((l) => l.filter((x) => x.key !== key));
    }
    // Retour/terugname: zet deze lijn op negatief (of terug op positief). Handig om
    // een verkeerd aangeslagen artikel of diverse af te trekken van (o.a.) de rekening.
    function wisselRetour(key) {
        setLijnen((l) => l.map((x) => (x.key === key ? { ...x, retour: !x.retour } : x)));
    }
    // Gekozen kortingsregeling (personeel/F&F) geldt voor de héle verkoop.
    const gekozenRegeling = regelingen.find((r) => r.id === gekozenRegelingId) ?? null;
    const regelingPct = gekozenRegeling ? Number(gekozenRegeling.pct) : 0;
    const handkorting = bon.handkorting || 0;
    // De hoogste van de gekozen regeling en de manueel ingetikte korting geldt
    // als verkoopbrede korting (los van een eventuele lijnkorting).
    const saleKortingPct = Math.max(regelingPct, handkorting);
    const saleFactor = 1 - saleKortingPct / 100;
    const kortingReden = saleKortingPct > 0
        ? (handkorting >= regelingPct ? `Korting ${handkorting}%` : `${gekozenRegeling.naam} ${regelingPct}%`)
        : undefined;
    // Lijnkorting (enkel op deze lijn). De nettoprijs is de stukprijs ná lijnkorting;
    // de verkoopbrede korting komt daar bovenop op het subtotaal.
    const lijnKorting = (l) => Math.min(100, Math.max(l.kortingPct || 0, 0));
    const nettoPrijs = (l) => l.prijs * (1 - lijnKorting(l) / 100);
    const subtotaal = useMemo(() => lijnen.reduce((s, l) => s + nettoPrijs(l) * tekenAantal(l), 0), [lijnen]);
    const totaal = Math.round(subtotaal * saleFactor * 100) / 100;
    // BTW-uitsplitsing per tarief (na lijnkorting, dan geschaald met de
    // verkoopbrede korting). De server rekent het definitief uit bij het afrekenen.
    const btwOverzicht = useMemo(() => {
        const per = new Map();
        for (const l of lijnen) {
            const bruto = nettoPrijs(l) * tekenAantal(l);
            const excl = bruto / (1 + l.btwPercentage / 100);
            const rij = per.get(l.btwPercentage) ?? { maatstaf: 0, btw: 0 };
            rij.maatstaf += excl;
            rij.btw += bruto - excl;
            per.set(l.btwPercentage, rij);
        }
        return [...per.entries()]
            .sort((a, b) => a[0] - b[0])
            .map(([percentage, r]) => ({ percentage, maatstaf: r.maatstaf * saleFactor, btw: r.btw * saleFactor }));
    }, [lijnen, saleFactor]);
    // De afdeling van een product: rechtstreeks, anders via zijn categorie.
    const prodAfd = (p) => p.afdelingId ?? p.categorie?.afdelingId ?? null;
    // Afdeling-tegels: alle afdelingen (op volgorde) met hun aantal producten.
    const afdTegels = useMemo(() => {
        const telling = new Map();
        for (const p of producten) {
            const a = prodAfd(p);
            if (a)
                telling.set(a, (telling.get(a) ?? 0) + 1);
        }
        return [...afdelingen]
            .sort((a, b) => a.volgorde - b.volgorde || a.naam.localeCompare(b.naam))
            .map((a) => ({ ...a, aantal: telling.get(a.id) ?? 0 }));
    }, [afdelingen, producten]);
    // Categorie-chips binnen de gekozen afdeling (enkel als er categorieën zijn).
    const afdCategorieen = useMemo(() => {
        if (!afdId)
            return [];
        const m = new Map();
        for (const p of producten) {
            if (prodAfd(p) === afdId && p.categorie)
                m.set(p.categorie.id, { id: p.categorie.id, naam: p.categorie.naam });
        }
        return [...m.values()].sort((a, b) => a.naam.localeCompare(b.naam));
    }, [producten, afdId]);
    // Producten van de gekozen afdeling, optioneel gefilterd op categorie-chip.
    const afdProducten = useMemo(() => {
        if (!afdId)
            return [];
        return producten
            .filter((p) => prodAfd(p) === afdId && (!catId || p.categorie?.id === catId))
            .sort((a, b) => a.naam.localeCompare(b.naam));
    }, [producten, afdId, catId]);
    const ontvangenNum = Number(ontvangen.replace(',', '.'));
    const teruggeven = betaalwijze === 'CASH' && ontvangen && !Number.isNaN(ontvangenNum)
        ? ontvangenNum - totaal
        : null;
    const cash = betaalwijze === 'CASH' && !bon.opRekening;
    // Netto terugbetaling (retour groter dan de verkoop): dit geld geven we cash
    // terug uit de lade — nooit via Bancontact/Kaart. (Op rekening blijft wel: dan
    // verrekenen we het op de rekening van het bedrijf.)
    const isTerugbetaling = totaal < 0;
    const cashTeVeel = cash && totaal > CASH_LIMIET;
    const cashTeWeinig = cash && !isTerugbetaling && ontvangen !== '' && ontvangenNum < totaal;
    // Bancontact/Kaart kan je niet gebruiken om cash terug te geven: bij een netto
    // terugbetaling (en niet op rekening) zetten we de betaalwijze op Cash.
    useEffect(() => {
        if (isTerugbetaling && !bon.opRekening && betaalwijze !== 'CASH')
            setBetaalwijze('CASH');
    }, [isTerugbetaling, bon.opRekening, betaalwijze]);
    // Bouwt een ticket lokaal (voor het offline-geval), identiek aan het serverticket.
    function lokaalTicket(key) {
        const o = ontvangenNum;
        const cash = betaalwijze === 'CASH' && !Number.isNaN(o);
        return {
            id: 'offline-' + key.slice(0, 8),
            datum: new Date().toISOString(),
            betaalwijze,
            verkoper: verkopers.find((v) => v.id === bon.verkoperId)?.naam ?? getVerkoper()?.naam ?? null,
            offline: true,
            totaal: Math.round(totaal * 100) / 100,
            ontvangen: cash ? o : null,
            teruggeven: cash ? Math.round((o - totaal) * 100) / 100 : null,
            kortingReden,
            verkoopKortingPct: saleKortingPct || null,
            subtotaal: Math.round(subtotaal * 100) / 100,
            lijnen: lijnen.map((l) => ({
                naam: l.retour ? `Retour: ${l.naam}` : l.naam,
                aantal: tekenAantal(l),
                eenheidsprijs: Math.round(nettoPrijs(l) * 100) / 100, // ná lijnkorting
                btwPercentage: l.btwPercentage,
                totaal: Math.round(nettoPrijs(l) * tekenAantal(l) * 100) / 100, // ná lijnkorting, vóór verkoopkorting
                kortingPct: l.kortingPct || null,
                origineelTotaal: l.kortingPct ? Math.round(l.prijs * tekenAantal(l) * 100) / 100 : null,
            })),
            btwOverzicht: btwOverzicht.map((b) => ({
                percentage: b.percentage,
                maatstaf: Math.round(b.maatstaf * 100) / 100,
                btw: Math.round(b.btw * 100) / 100,
            })),
        };
    }
    async function afrekenenNu() {
        if (!lijnen.length || bezig || cashTeVeel || cashTeWeinig)
            return;
        if (!bon.verkoperId) {
            setFout('Kies eerst de verkoper voor dit ticket.');
            return;
        }
        if (bon.opRekening && (!bon.rekeningBedrijfId || !bon.rekeningLidId)) {
            setFout('Kies het bedrijf en het personeelslid voor de rekening.');
            return;
        }
        const gesloten = bon.id; // welk ticket we afsluiten
        setBezig(true);
        setFout('');
        const key = typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : String(Date.now()) + Math.random().toString(16).slice(2);
        const payload = {
            lijnen: lijnen.map((l) => ({
                productId: l.productId,
                aantal: tekenAantal(l), // negatief bij een retour → trekt af (ook van de rekening)
                kortingPct: l.kortingPct || undefined, // enkel de lijnkorting
                bedrag: l.vrijBedrag ? l.prijs : undefined, // vrij bedrag voor diversen/cadeaubon
            })),
            betaalwijze: bon.opRekening ? undefined : betaalwijze,
            ontvangen: cash && !isTerugbetaling && ontvangen !== '' && !Number.isNaN(ontvangenNum) ? ontvangenNum : undefined,
            gebruikerId: bon.verkoperId,
            kortingReden,
            verkoopKortingPct: saleKortingPct || undefined, // verkoopbrede korting
            rekeningBedrijfId: bon.opRekening ? bon.rekeningBedrijfId : undefined,
            rekeningLidId: bon.opRekening ? bon.rekeningLidId : undefined,
            idempotencyKey: key,
        };
        try {
            const t = await afrekenen(payload);
            setTicket(t);
            sluitVerkochtBon(gesloten);
        }
        catch (e) {
            if (isNetwerkfout(e)) {
                // Internet weg: verkoop lokaal bewaren en het ticket toch tonen.
                enqueue({ idempotencyKey: key, payload, tijd: Date.now() });
                setTicket(lokaalTicket(key));
                sluitVerkochtBon(gesloten);
            }
            else {
                setFout(e instanceof Error ? e.message : 'Afrekenen mislukt');
            }
        }
        finally {
            setBezig(false);
        }
    }
    // Na een afgeronde verkoop verdwijnt dat ticket; blijft er geen enkel over,
    // dan starten we meteen een vers, leeg ticket.
    function sluitVerkochtBon(id) {
        setBonnen((bs) => {
            const rest = bs.filter((b) => b.id !== id);
            return rest.length ? rest : [maakBon()];
        });
    }
    function nieuweVerkoop() {
        setTicket(null);
        setCatId(null);
        setFout('');
    }
    if (ticket) {
        return _jsx(TicketWeergave, { ticket: ticket, onNieuw: nieuweVerkoop });
    }
    // QR-code als betaalwijze: actief sinds de backend-herstart die ze in de
    // database activeerde.
    const QR_ACTIEF = true;
    const betaalwijzen = ['BANCONTACT', 'KAART', 'CASH', 'OVERSCHRIJVING', ...(QR_ACTIEF ? ['QR'] : []), 'EIGEN_REKENING'];
    return (_jsxs("div", { style: { display: 'flex', gap: 24, flexWrap: 'wrap', maxWidth: 940 }, children: [_jsxs("div", { style: { flexBasis: '100%', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }, children: [bonnen.map((b, i) => {
                        const naam = verkopers.find((v) => v.id === b.verkoperId)?.naam;
                        const actief = b.id === bon.id;
                        return (_jsxs("div", { onClick: () => setActiefId(b.id), style: ticketTab(actief), children: [_jsx("span", { style: { fontWeight: 600 }, children: naam ?? `Ticket ${i + 1}` }), _jsxs("span", { style: { fontSize: 12, color: actief ? '#c7d2fe' : '#6b7280' }, children: [b.lijnen.length, " art."] }), bonnen.length > 1 && (_jsx("span", { onClick: (e) => { e.stopPropagation(); sluitBon(b.id); }, title: "Ticket sluiten", style: { color: actief ? '#fecaca' : '#b91c1c', cursor: 'pointer', fontWeight: 700 }, children: "\u00D7" }))] }, b.id));
                    }), _jsx("button", { onClick: nieuwBon, style: { ...ticketTab(false), border: '1px dashed #94a3b8', color: '#2563eb', fontWeight: 600 }, children: "+ Ticket" }), _jsx("button", { onClick: vernieuwNu, title: "Producten, knoppen en rekeningen opnieuw ophalen", style: { ...ticketTab(false), marginLeft: 'auto', border: '1px solid #cbd5e1', color: vernieuwd ? '#166534' : '#334155', fontWeight: 600 }, children: vernieuwd ? '✓ Vernieuwd' : '⟳ Vernieuwen' })] }), _jsxs("div", { style: { flex: '1 1 460px' }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }, children: [_jsx("h2", { style: { margin: 0 }, children: "Kassa" }), _jsx("button", { onClick: () => patchBon(bon.id, { retourModus: !retourModus }), title: "Negatieve rekening: elk toegevoegd artikel wordt afgetrokken", style: { padding: '8px 14px', borderRadius: 8, cursor: 'pointer', fontWeight: 700, border: '2px solid #b91c1c', background: retourModus ? '#b91c1c' : '#fff', color: retourModus ? '#fff' : '#b91c1c' }, children: retourModus ? '● RETOUR-modus AAN (−)' : 'Retour / negatief (−)' })] }), retourModus && (_jsxs("div", { style: { marginTop: 8, padding: '8px 12px', borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontWeight: 600 }, children: ["Retour-modus: elk artikel dat je toevoegt (scannen, tegel, diversen, prijs/kg) wordt ", _jsx("u", { children: "afgetrokken" }), ". Zet uit om terug gewoon te verkopen."] })), _jsx("input", { ref: inputRef, value: barcode, onChange: (e) => onBarcodeChange(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter')
                            scan(); }, placeholder: "Scan of typ een barcode", style: { width: '100%', marginTop: 10, padding: 10, fontSize: 16, boxSizing: 'border-box', border: retourModus ? '2px solid #b91c1c' : undefined } }), fout && _jsx("p", { style: { color: 'crimson' }, children: fout }), _jsxs("div", { style: { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }, children: [speciaal
                                .filter((sp) => (sp.interneCode ?? '').startsWith('DIV'))
                                .sort((a, b) => Number(a.btwTarief.percentage) - Number(b.btwTarief.percentage))
                                .map((sp) => (_jsx("button", { onClick: () => voegVrijBedrag(sp), style: diversenKnop, children: sp.naam }, sp.id))), speciaal.some((sp) => sp.interneCode === 'PRIJSKG') && (_jsx("button", { onClick: () => { setPrijsKgWaarde(0); setPrijsKgStap('prijs'); }, style: { ...diversenKnop, background: '#fefce8', borderColor: '#fde68a', color: '#854d0e' }, children: "Prijs/kg" })), speciaal.filter((sp) => sp.interneCode === 'CADEAU').map((sp) => (_jsx("button", { onClick: () => voegVrijBedrag(sp), style: diversenKnop, children: sp.naam }, sp.id))), _jsx("button", { onClick: () => setNieuwArtikel(''), style: { ...diversenKnop, background: '#ecfdf5', borderColor: '#a7f3d0', color: '#166534' }, children: "+ Nieuw artikel" })] }), afdId === '' ? (_jsx("div", { style: { marginTop: 12 }, children: _jsxs("div", { style: tegelGrid, children: [afdTegels.length === 0 && (_jsx("div", { style: { color: '#999', gridColumn: '1 / -1', padding: 8 }, children: "Geen afdelingen in de cache." })), afdTegels.map((a) => (_jsxs("button", { onClick: () => { setAfdId(a.id); setCatId(null); }, disabled: a.aantal === 0, style: { ...tegel('#eef2ff', '#c7d2fe'), opacity: a.aantal === 0 ? 0.45 : 1, cursor: a.aantal === 0 ? 'default' : 'pointer' }, children: [_jsx("div", { style: { fontWeight: 600 }, children: a.naam }), _jsxs("div", { style: { fontSize: 12, color: '#666' }, children: [a.aantal, " art."] })] }, a.id)))] }) })) : (_jsxs("div", { style: { marginTop: 12 }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }, children: [_jsx("button", { onClick: () => { setAfdId(''); setCatId(null); }, style: filterKnop(false), children: "\u2190 Afdelingen" }), _jsx("strong", { children: afdelingen.find((a) => a.id === afdId)?.naam ?? '' })] }), afdCategorieen.length > 0 && (_jsxs("div", { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }, children: [_jsx("button", { onClick: () => setCatId(null), style: filterKnop(catId === null), children: "Alle" }), afdCategorieen.map((c) => (_jsx("button", { onClick: () => setCatId(c.id), style: filterKnop(catId === c.id), children: c.naam }, c.id)))] })), _jsxs("div", { style: tegelGrid, children: [afdProducten.length === 0 && (_jsx("div", { style: { color: '#999', gridColumn: '1 / -1', padding: 8 }, children: "Geen producten in deze afdeling." })), afdProducten.map((p) => (_jsxs("button", { onClick: () => kiesProduct(p), style: tegel('#f0fdf4', '#bbf7d0'), children: [_jsxs("div", { style: { fontWeight: 600 }, children: [p.naam, p.isAlcohol && ' 🍷', p.eenheid === 'KG' && ' ⚖️'] }), _jsxs("div", { style: { fontSize: 12, color: '#666' }, children: ["\u20AC ", Number(p.verkoopprijs).toFixed(2), p.eenheid === 'KG' ? ' /kg' : ''] })] }, p.id)))] })] })), _jsxs("table", { style: { width: '100%', marginTop: 16, borderCollapse: 'collapse' }, children: [_jsx("thead", { children: _jsxs("tr", { style: { textAlign: 'left', borderBottom: '1px solid #ddd', fontSize: 13, color: '#666' }, children: [_jsx("th", { style: { padding: '6px 4px' }, children: "Product" }), _jsx("th", { style: { padding: '6px 4px', width: 110, textAlign: 'center' }, children: "Aantal" }), _jsx("th", { style: { padding: '6px 4px', width: 70, textAlign: 'center' }, children: "Korting" }), _jsx("th", { style: { padding: '6px 4px', textAlign: 'right' }, children: "Totaal" }), _jsx("th", { style: { width: 28 } })] }) }), _jsxs("tbody", { children: [lijnen.length === 0 && (_jsx("tr", { children: _jsx("td", { colSpan: 5, style: { padding: 16, color: '#999' }, children: "Nog geen artikels." }) })), lijnen.map((l) => {
                                        const eff = lijnKorting(l);
                                        return (_jsxs("tr", { style: { borderBottom: '1px solid #f0f0f0', background: l.retour ? '#fef2f2' : undefined }, children: [_jsxs("td", { style: { padding: '8px 4px' }, children: [l.retour && _jsx("span", { style: { color: '#b91c1c', fontWeight: 700, marginRight: 6 }, children: "RETOUR" }), l.naam, l.isAlcohol && _jsx("span", { title: "Alcohol", style: { marginLeft: 6 }, children: "\uD83C\uDF77" }), _jsxs("div", { style: { fontSize: 12, color: '#888' }, children: ["\u20AC ", l.prijs.toFixed(2), " \u00B7 ", l.btwPercentage, "% BTW", eff > 0 && _jsxs("span", { style: { color: '#16a34a' }, children: [" \u00B7 \u2212", eff, "% \u2192 \u20AC ", nettoPrijs(l).toFixed(2)] })] })] }), _jsx("td", { style: { padding: '8px 4px', textAlign: 'center', whiteSpace: 'nowrap' }, children: l.vastAantal ? (_jsx("span", { style: { color: '#374151' }, children: l.aantal })) : (_jsxs(_Fragment, { children: [_jsx("button", { onClick: () => wijzigAantal(l.key, -1), style: knopMini, children: "\u2212" }), _jsx("button", { onClick: () => setAantalLijn(l.key), title: "Aantal instellen", style: { minWidth: 44, margin: '0 2px', padding: '4px 6px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }, children: l.aantal }), _jsx("button", { onClick: () => wijzigAantal(l.key, +1), style: knopMini, children: "+" })] })) }), _jsx("td", { style: { padding: '8px 4px', textAlign: 'center' }, children: _jsx("button", { onClick: () => setKortingLijn(l.key), style: { minWidth: 46, padding: '4px 6px', borderRadius: 6, cursor: 'pointer', border: l.kortingPct ? '2px solid #7c3aed' : '1px solid #cbd5e1', background: l.kortingPct ? '#f5f3ff' : '#fff', color: l.kortingPct ? '#6d28d9' : '#374151', fontWeight: 600, fontSize: 13 }, children: l.kortingPct ? `${l.kortingPct}%` : '−%' }) }), _jsxs("td", { style: { padding: '8px 4px', textAlign: 'right', color: l.retour ? '#b91c1c' : undefined, fontWeight: l.retour ? 700 : undefined }, children: ["\u20AC ", (nettoPrijs(l) * tekenAantal(l)).toFixed(2)] }), _jsxs("td", { style: { textAlign: 'right', whiteSpace: 'nowrap' }, children: [_jsx("button", { onClick: () => wisselRetour(l.key), title: l.retour ? 'Terug naar gewone verkoop' : 'Retour: deze lijn aftrekken', style: { ...knopMini, color: l.retour ? '#fff' : '#b91c1c', background: l.retour ? '#b91c1c' : '#fff', border: '1px solid #b91c1c', marginRight: 4 }, children: "\u21A9" }), _jsx("button", { onClick: () => verwijder(l.key), title: "Verwijderen", style: { ...knopMini, color: 'crimson' }, children: "\u00D7" })] })] }, l.key));
                                    })] })] })] }), _jsx("div", { style: { flex: '1 1 300px', minWidth: 280 }, children: _jsxs("div", { style: { border: '1px solid #ddd', borderRadius: 8, padding: 16 }, children: [_jsxs("div", { style: { marginBottom: 14 }, children: [_jsx("div", { style: { fontSize: 13, color: '#666', marginBottom: 6 }, children: "Verkoper \u2014 wie bedient?" }), _jsxs("select", { value: bon.verkoperId, onChange: (e) => patchBon(bon.id, { verkoperId: e.target.value }), style: {
                                        width: '100%', padding: 10, fontSize: 15, boxSizing: 'border-box', borderRadius: 6,
                                        border: bon.verkoperId ? '1px solid #ccc' : '2px solid #f59e0b',
                                    }, children: [_jsx("option", { value: "", children: "\u2014 kies je naam \u2014" }), verkopers.map((v) => _jsx("option", { value: v.id, children: v.naam }, v.id))] })] }), _jsx("h3", { style: { margin: '0 0 8px' }, children: "Te betalen" }), _jsxs("div", { style: { fontSize: 32, fontWeight: 700 }, children: ["\u20AC ", totaal.toFixed(2)] }), btwOverzicht.length > 0 && (_jsx("table", { style: { width: '100%', marginTop: 12, fontSize: 13, color: '#555' }, children: _jsx("tbody", { children: btwOverzicht.map((b) => (_jsxs("tr", { children: [_jsxs("td", { children: ["BTW ", b.percentage, "%"] }), _jsxs("td", { style: { textAlign: 'right' }, children: ["maatstaf \u20AC ", b.maatstaf.toFixed(2)] }), _jsxs("td", { style: { textAlign: 'right' }, children: ["\u20AC ", b.btw.toFixed(2)] })] }, b.percentage))) }) })), isAdmin && regelingen.length > 0 && (_jsxs("div", { style: { marginTop: 16 }, children: [_jsx("div", { style: { fontSize: 13, color: '#666', marginBottom: 6 }, children: "Korting (beheerder)" }), _jsxs("select", { value: gekozenRegelingId, onChange: (e) => setGekozenRegelingId(e.target.value), style: { width: '100%', padding: 8, fontSize: 15, boxSizing: 'border-box' }, children: [_jsx("option", { value: "", children: "Geen kassabrede korting" }), regelingen.map((r) => (_jsxs("option", { value: r.id, children: [r.naam, " \u2014 ", Number(r.pct), "%"] }, r.id)))] }), gekozenRegeling && (_jsxs("div", { style: { fontSize: 12, color: '#16a34a', marginTop: 4 }, children: [kortingReden, " toegepast op de hele verkoop."] }))] })), _jsxs("div", { style: { marginTop: 16 }, children: [_jsx("div", { style: { fontSize: 13, color: '#666', marginBottom: 6 }, children: "Korting" }), _jsxs("div", { style: { display: 'flex', gap: 6, alignItems: 'center' }, children: [_jsx("button", { onClick: () => setKortingKlavier(true), style: { flex: 1, padding: '10px 12px', borderRadius: 8, cursor: 'pointer', textAlign: 'left', fontWeight: 600, border: handkorting > 0 ? '2px solid #7c3aed' : '1px solid #cbd5e1', background: handkorting > 0 ? '#f5f3ff' : '#fff', color: handkorting > 0 ? '#6d28d9' : '#374151' }, children: handkorting > 0 ? `${handkorting}% korting op de verkoop` : 'Korting toevoegen (%)' }), handkorting > 0 && (_jsx("button", { onClick: () => patchBon(bon.id, { handkorting: 0 }), title: "Korting wissen", style: { padding: '10px 14px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', color: 'crimson', cursor: 'pointer', fontWeight: 700 }, children: "\u00D7" }))] })] }), _jsxs("div", { style: { marginTop: 16 }, children: [_jsx("div", { style: { fontSize: 13, color: '#666', marginBottom: 6 }, children: "Betaalwijze" }), _jsxs("div", { style: { display: 'flex', gap: 8, flexWrap: 'wrap' }, children: [betaalwijzen.map((b) => {
                                            const actief = !bon.opRekening && betaalwijze === b;
                                            // Bij een terugbetaling enkel Cash toelaten (geld uit de lade).
                                            const geblokkeerd = isTerugbetaling && b !== 'CASH';
                                            return (_jsx("button", { disabled: geblokkeerd, title: geblokkeerd ? 'Een terugbetaling geef je cash terug' : undefined, onClick: () => { setBetaalwijze(b); patchBon(bon.id, { opRekening: false }); }, style: { flex: '1 1 45%', padding: '10px 4px', borderRadius: 6, cursor: geblokkeerd ? 'not-allowed' : 'pointer', border: actief ? '2px solid #2563eb' : '1px solid #ccc', background: actief ? '#eff6ff' : '#fff', fontWeight: actief ? 600 : 400, opacity: geblokkeerd ? 0.4 : 1 }, children: betaalNaam(b) }, b));
                                        }), _jsx("button", { onClick: () => patchBon(bon.id, { opRekening: true }), style: { flex: '1 1 45%', padding: '10px 4px', borderRadius: 6, cursor: 'pointer', border: bon.opRekening ? '2px solid #2563eb' : '1px solid #ccc', background: bon.opRekening ? '#eff6ff' : '#fff', fontWeight: bon.opRekening ? 600 : 400 }, children: "Op rekening" })] }), bon.opRekening && (_jsxs("div", { style: { marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }, children: [_jsxs("select", { value: bon.rekeningBedrijfId, onChange: (e) => patchBon(bon.id, { rekeningBedrijfId: e.target.value, rekeningLidId: '' }), style: { flex: 1, minWidth: 140, padding: 9, fontSize: 15, borderRadius: 6, border: bon.rekeningBedrijfId ? '1px solid #ccc' : '2px solid #f59e0b' }, children: [_jsx("option", { value: "", children: "\u2014 bedrijf \u2014" }), rekeningBedrijven.map((rb) => _jsx("option", { value: rb.id, children: rb.naam }, rb.id))] }), _jsxs("select", { value: bon.rekeningLidId, onChange: (e) => patchBon(bon.id, { rekeningLidId: e.target.value }), disabled: !bon.rekeningBedrijfId, style: { flex: 1, minWidth: 140, padding: 9, fontSize: 15, borderRadius: 6, border: bon.rekeningLidId ? '1px solid #ccc' : '2px solid #f59e0b' }, children: [_jsx("option", { value: "", children: "\u2014 personeelslid \u2014" }), (rekeningBedrijven.find((rb) => rb.id === bon.rekeningBedrijfId)?.leden ?? []).map((l) => _jsx("option", { value: l.id, children: l.naam }, l.id))] })] }))] }), !bon.opRekening && isTerugbetaling && (_jsxs("div", { style: { marginTop: 12, padding: 12, borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca' }, children: [_jsx("div", { style: { fontSize: 13, color: '#b91c1c' }, children: "Terugbetaling \u2014 cash uit de lade" }), _jsxs("div", { style: { fontSize: 24, fontWeight: 700, color: '#b91c1c' }, children: ["Terug te geven: \u20AC ", Math.abs(totaal).toFixed(2)] })] })), !bon.opRekening && betaalwijze === 'CASH' && !isTerugbetaling && (_jsxs("div", { style: { marginTop: 12 }, children: [_jsx("label", { style: { fontSize: 13, color: '#666' }, children: "Ontvangen" }), _jsxs("div", { style: { display: 'flex', gap: 6, marginTop: 4 }, children: [_jsx("input", { value: ontvangen, onChange: (e) => setOntvangen(e.target.value), inputMode: "decimal", placeholder: "0,00", style: { flex: 1, padding: 8, fontSize: 16, boxSizing: 'border-box' } }), _jsx("button", { onClick: () => setOntvangstKlavier(true), title: "Klavier", style: { padding: '8px 14px', fontSize: 18, borderRadius: 8, border: '1px solid #cbd5e1', background: '#eef2ff', cursor: 'pointer' }, children: "\u2328" })] }), teruggeven != null && teruggeven >= 0 && (_jsxs("div", { style: { marginTop: 6, fontWeight: 600 }, children: ["Teruggeven: \u20AC ", teruggeven.toFixed(2)] })), cashTeWeinig && _jsx("div", { style: { color: 'crimson', marginTop: 6 }, children: "Te weinig ontvangen." }), cashTeVeel && (_jsxs("div", { style: { color: 'crimson', marginTop: 6 }, children: ["Cash boven \u20AC ", CASH_LIMIET, " mag niet (wettelijke limiet)."] }))] })), lijnen.length > 0 && !bon.verkoperId && (_jsx("div", { style: { color: '#b45309', marginTop: 12, fontSize: 13 }, children: "Kies bovenaan de verkoper om af te rekenen." })), _jsx("button", { onClick: afrekenenNu, disabled: !lijnen.length || bezig || cashTeVeel || cashTeWeinig || !bon.verkoperId, style: {
                                width: '100%', marginTop: 12, padding: 14, fontSize: 18, fontWeight: 700,
                                borderRadius: 8, border: 'none', cursor: 'pointer', color: '#fff',
                                background: !lijnen.length || bezig || cashTeVeel || cashTeWeinig || !bon.verkoperId ? '#9ca3af' : '#16a34a',
                            }, children: bezig ? 'Bezig…' : 'Afrekenen' })] }) }), weegProduct && (_jsx(WeegModal, { product: weegProduct, onEtiket: (kg) => etiketAfdrukken(weegProduct, kg), onBevestig: (kg) => { voegToe(weegProduct, kg, true); setWeegProduct(null); }, onSluit: () => setWeegProduct(null) })), vrijProduct && (_jsx(BedragModal, { titel: vrijProduct.naam, subtitel: `Bedrag incl. ${Number(vrijProduct.btwTarief.percentage)}% BTW`, metAantal: true, onBevestig: (bedrag, aantal) => voegVrijBedragToe(vrijProduct, bedrag, aantal), onSluit: () => setVrijProduct(null) })), ontvangstKlavier && (_jsx(BedragModal, { titel: "Ontvangen (cash)", subtitel: `Te betalen: € ${totaal.toFixed(2)}`, bevestigLabel: "Bevestigen", onBevestig: (b) => { setOntvangen(b.toFixed(2)); setOntvangstKlavier(false); }, onSluit: () => setOntvangstKlavier(false) })), kortingKlavier && (_jsx(BedragModal, { titel: "Korting", subtitel: "Percentage op de hele verkoop", eenheid: "%", bevestigLabel: "Toepassen", onBevestig: (p) => { patchBon(bon.id, { handkorting: p }); setKortingKlavier(false); }, onSluit: () => setKortingKlavier(false) })), kortingLijn && (_jsx(BedragModal, { titel: "Korting op artikel", subtitel: lijnen.find((l) => l.key === kortingLijn)?.naam, eenheid: "%", bevestigLabel: "Toepassen", onBevestig: (p) => { zetKorting(kortingLijn, String(p)); setKortingLijn(null); }, onSluit: () => setKortingLijn(null) })), aantalLijn && (() => {
                const l = lijnen.find((x) => x.key === aantalLijn);
                if (!l)
                    return null;
                const isKg = producten.find((p) => p.id === l.productId)?.eenheid === 'KG';
                const sluit = () => { setAantalLijn(null); inputRef.current?.focus(); };
                return (_jsx(BedragModal, { titel: "Aantal", subtitel: l.naam, eenheid: isKg ? 'kg' : 'stuks', bevestigLabel: "Instellen", onBevestig: (waarde) => { zetAantal(l.key, String(waarde)); sluit(); }, onSluit: sluit }));
            })(), prijsKgStap === 'prijs' && (_jsx(BedragModal, { titel: "Prijs per kg", subtitel: "Geef de prijs per kilo (incl. BTW)", bevestigLabel: "Volgende", onBevestig: (p) => { setPrijsKgWaarde(p); setPrijsKgStap('gewicht'); }, onSluit: () => setPrijsKgStap(null) })), prijsKgStap === 'gewicht' && (_jsx(BedragModal, { titel: "Gewicht", subtitel: `€ ${prijsKgWaarde.toFixed(2)} / kg`, bevestigLabel: "Toevoegen", eenheid: "kg", onBevestig: (g) => voegPrijsKgToe(prijsKgWaarde, g), onSluit: () => setPrijsKgStap(null) })), onbekendeBarcode && (_jsx("div", { onClick: () => setOnbekendeBarcode(null), style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60 }, children: _jsxs("div", { onClick: (e) => e.stopPropagation(), style: { background: '#fff', borderRadius: 14, padding: 26, width: 360, maxWidth: '92vw', textAlign: 'center' }, children: [_jsx("div", { style: { fontSize: 46, lineHeight: 1 }, children: "\u26A0\uFE0F" }), _jsx("h3", { style: { margin: '10px 0 6px' }, children: "Onbekende barcode" }), _jsx("p", { style: { color: '#555', margin: '0 0 12px' }, children: "Dit product zit nog niet in het systeem." }), _jsx("div", { style: { fontFamily: 'monospace', fontSize: 18, fontWeight: 700, background: '#f3f4f6', borderRadius: 8, padding: '10px 12px', wordBreak: 'break-all' }, children: onbekendeBarcode }), _jsx("p", { style: { color: '#6b7280', fontSize: 13, margin: '12px 0 16px' }, children: "Voeg het artikel meteen toe (de barcode staat dan al ingevuld)." }), _jsxs("div", { style: { display: 'flex', gap: 8 }, children: [_jsx("button", { onClick: () => setOnbekendeBarcode(null), style: { flex: 1, padding: 14, fontSize: 16, borderRadius: 10, border: '1px solid #cbd5e1', cursor: 'pointer', background: '#fff' }, children: "Sluiten" }), _jsx("button", { onClick: () => { const c = onbekendeBarcode; setOnbekendeBarcode(null); setNieuwArtikel(c); }, autoFocus: true, style: { flex: 2, padding: 14, fontSize: 16, fontWeight: 700, borderRadius: 10, border: 'none', cursor: 'pointer', color: '#fff', background: '#16a34a' }, children: "+ Artikel toevoegen" })] })] }) })), nieuwArtikel !== null && (_jsx(NieuwArtikelModal, { initBarcode: nieuwArtikel, afdelingen: afdelingen, categorieen: metaCategorieen, btwTarieven: btwTarieven, onAangemaakt: artikelAangemaakt, onSluit: () => setNieuwArtikel(null) }))] }));
}
// Nieuw artikel aanmaken vanuit de kassa: afdeling kiezen -> barcode scannen ->
// naam + prijs -> aanmaken (en eventueel meteen op het ticket).
function NieuwArtikelModal({ initBarcode, afdelingen, categorieen, btwTarieven, onAangemaakt, onSluit, }) {
    const [afdId, setAfdId] = useState('');
    const [catId, setCatId] = useState('');
    const [barcode, setBarcode] = useState(initBarcode);
    const [naam, setNaam] = useState('');
    const [prijs, setPrijs] = useState('');
    const [btwId, setBtwId] = useState(btwTarieven[0]?.id ?? '');
    const [eenheid, setEenheid] = useState('STUK');
    const [fout, setFout] = useState('');
    const [bezig, setBezig] = useState(false);
    const num = (s) => Number(s.replace(',', '.'));
    const cats = categorieen.filter((c) => c.afdelingId === afdId);
    async function aanmaken(opTicket) {
        setFout('');
        if (!afdId) {
            setFout('Kies eerst een afdeling.');
            return;
        }
        if (!naam.trim()) {
            setFout('Geef een naam.');
            return;
        }
        if (!(num(prijs) > 0)) {
            setFout('Geef een geldige prijs.');
            return;
        }
        if (!btwId) {
            setFout('Kies een BTW-tarief.');
            return;
        }
        setBezig(true);
        try {
            const input = {
                naam: naam.trim(),
                barcode: barcode.trim() || null,
                verkoopprijs: num(prijs),
                eenheid,
                btwTariefId: btwId,
                afdelingId: afdId,
                categorieId: catId || null,
            };
            const gemaakt = await createProduct(input);
            onAangemaakt(gemaakt, opTicket);
        }
        catch (e) {
            setFout(e instanceof Error ? e.message : 'Aanmaken mislukt');
        }
        finally {
            setBezig(false);
        }
    }
    const veldLabel = { fontSize: 12, color: '#6b7280', fontWeight: 600, margin: '10px 0 3px' };
    const veld = { width: '100%', padding: 10, fontSize: 15, boxSizing: 'border-box', border: '1px solid #cbd5e1', borderRadius: 8 };
    return (_jsx("div", { onClick: onSluit, style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, padding: 12 }, children: _jsxs("div", { onClick: (e) => e.stopPropagation(), style: { background: '#fff', borderRadius: 14, padding: 22, width: 440, maxWidth: '94vw', maxHeight: '90vh', overflowY: 'auto' }, children: [_jsx("h3", { style: { margin: '0 0 4px' }, children: "Nieuw artikel" }), _jsx("div", { style: veldLabel, children: "1. Kies de afdeling" }), _jsx("div", { style: { display: 'flex', gap: 6, flexWrap: 'wrap' }, children: afdelingen.map((a) => (_jsx("button", { onClick: () => { setAfdId(a.id); setCatId(''); }, style: { padding: '8px 12px', borderRadius: 20, cursor: 'pointer', fontSize: 13,
                            border: afdId === a.id ? '2px solid #16a34a' : '1px solid #cbd5e1',
                            background: afdId === a.id ? '#ecfdf5' : '#fff', fontWeight: afdId === a.id ? 600 : 400 }, children: a.naam }, a.id))) }), cats.length > 0 && (_jsxs(_Fragment, { children: [_jsx("div", { style: veldLabel, children: "Categorie (optioneel)" }), _jsxs("select", { value: catId, onChange: (e) => setCatId(e.target.value), style: veld, children: [_jsx("option", { value: "", children: "\u2014" }), cats.map((c) => _jsx("option", { value: c.id, children: c.naam }, c.id))] })] })), _jsx("div", { style: veldLabel, children: "2. Barcode (scan of typ)" }), _jsx("input", { autoFocus: true, value: barcode, onChange: (e) => setBarcode(e.target.value), placeholder: "scan de barcode\u2026", style: { ...veld, fontFamily: 'monospace' } }), _jsx("div", { style: veldLabel, children: "Naam" }), _jsx("input", { value: naam, onChange: (e) => setNaam(e.target.value), style: veld }), _jsxs("div", { style: { display: 'flex', gap: 10 }, children: [_jsxs("div", { style: { flex: 1 }, children: [_jsx("div", { style: veldLabel, children: "Prijs (incl. BTW)" }), _jsx("input", { value: prijs, onChange: (e) => setPrijs(e.target.value), inputMode: "decimal", placeholder: "0,00", style: veld })] }), _jsxs("div", { style: { flex: 1 }, children: [_jsx("div", { style: veldLabel, children: "BTW" }), _jsx("select", { value: btwId, onChange: (e) => setBtwId(e.target.value), style: veld, children: btwTarieven.map((t) => _jsxs("option", { value: t.id, children: [Number(t.percentage), "%"] }, t.id)) })] }), _jsxs("div", { style: { width: 100 }, children: [_jsx("div", { style: veldLabel, children: "Eenheid" }), _jsxs("select", { value: eenheid, onChange: (e) => setEenheid(e.target.value), style: veld, children: [_jsx("option", { value: "STUK", children: "Stuk" }), _jsx("option", { value: "KG", children: "Kg" })] })] })] }), fout && _jsx("p", { style: { color: 'crimson', margin: '10px 0 0' }, children: fout }), _jsxs("div", { style: { display: 'flex', gap: 8, marginTop: 16 }, children: [_jsx("button", { onClick: onSluit, style: { flex: 1, padding: 12, borderRadius: 10, border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer' }, children: "Annuleren" }), _jsx("button", { onClick: () => aanmaken(false), disabled: bezig, style: { flex: 1, padding: 12, borderRadius: 10, border: '1px solid #16a34a', background: '#fff', color: '#166534', cursor: 'pointer', fontWeight: 600 }, children: "Aanmaken" }), _jsx("button", { onClick: () => aanmaken(true), disabled: bezig, style: { flex: 2, padding: 12, borderRadius: 10, border: 'none', background: '#16a34a', color: '#fff', cursor: 'pointer', fontWeight: 700 }, children: bezig ? 'Bezig…' : 'Aanmaken + op ticket' })] })] }) }));
}
// Cijferklavier-pop-up voor een vrij bedrag (touchscreen-vriendelijk).
// Cent-voor-cent: tik 1 2 5 0 -> € 12,50.
function BedragModal({ titel, subtitel, bevestigLabel = 'Toevoegen', eenheid = '€', metAantal = false, onBevestig, onSluit, }) {
    const [cijfers, setCijfers] = useState('');
    const [aantal, setAantal] = useState(1);
    const isKg = eenheid === 'kg';
    const isPct = eenheid === '%';
    const isStuks = eenheid === 'stuks';
    const deler = isPct || isStuks ? 1 : isKg ? 1000 : 100; // %/stuks : heel getal · kg : gram · € : cent
    const ruw = Number(cijfers || '0') / deler;
    const waarde = isPct ? Math.min(ruw, 100) : ruw; // korting begrensd op 100%
    const weergave = isPct ? `${waarde} %` : isStuks ? `${waarde}` : isKg ? `${waarde.toFixed(3)} kg` : `€ ${waarde.toFixed(2)}`;
    function tik(d) {
        setCijfers((c) => {
            const n = (c + d).replace(/^0+(?=\d)/, '');
            return n.length > 8 ? c : n;
        });
    }
    function backspace() { setCijfers((c) => c.slice(0, -1)); }
    const toetsen = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '00', '0', '⌫'];
    return (_jsx("div", { onClick: onSluit, style: overlayStyle, children: _jsxs("div", { onClick: (e) => e.stopPropagation(), style: { background: '#fff', borderRadius: 14, padding: 20, width: 300, maxWidth: '92vw' }, children: [_jsx("h3", { style: { margin: '0 0 2px' }, children: titel }), subtitel && _jsx("div", { style: { color: '#666', fontSize: 13, marginBottom: 12 }, children: subtitel }), _jsx("div", { style: { fontSize: 34, fontWeight: 800, textAlign: 'right', padding: '8px 12px', background: '#f3f4f6', borderRadius: 10, margin: subtitel ? '0 0 12px' : '10px 0 12px', fontVariantNumeric: 'tabular-nums' }, children: weergave }), metAantal && (_jsxs("div", { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }, children: [_jsx("span", { style: { fontSize: 14, color: '#374151', fontWeight: 600 }, children: "Aantal" }), _jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 10 }, children: [_jsx("button", { onClick: () => setAantal((a) => Math.max(1, a - 1)), style: aantalTelKnop, children: "\u2212" }), _jsx("span", { style: { minWidth: 34, textAlign: 'center', fontSize: 22, fontWeight: 700 }, children: aantal }), _jsx("button", { onClick: () => setAantal((a) => a + 1), style: aantalTelKnop, children: "+" })] })] })), _jsxs("div", { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }, children: [toetsen.map((t) => (_jsx("button", { onClick: () => (t === '⌫' ? backspace() : tik(t)), style: { padding: '18px 0', fontSize: 22, fontWeight: 700, borderRadius: 10, cursor: 'pointer', border: '1px solid #cbd5e1', background: t === '⌫' ? '#f1f5f9' : '#fff' }, children: t }, t))), _jsx("button", { onClick: () => setCijfers(''), style: { gridColumn: '1 / -1', padding: '12px 0', fontSize: 15, fontWeight: 700, borderRadius: 10, cursor: 'pointer', border: '1px solid #cbd5e1', background: '#f1f5f9', color: '#b91c1c' }, children: "Wissen (C)" })] }), _jsxs("div", { style: { display: 'flex', gap: 8, marginTop: 14 }, children: [_jsx("button", { onClick: onSluit, style: { flex: 1, padding: 14, borderRadius: 10, border: '1px solid #ccc', background: '#fff', cursor: 'pointer', fontSize: 16 }, children: "Annuleren" }), _jsx("button", { onClick: () => waarde > 0 && onBevestig(isPct ? waarde : isStuks ? Math.round(waarde) : isKg ? Math.round(waarde * 1000) / 1000 : Math.round(waarde * 100) / 100, aantal), disabled: !(waarde > 0), style: { flex: 2, padding: 14, borderRadius: 10, border: 'none', color: '#fff', fontWeight: 700, fontSize: 16, cursor: waarde > 0 ? 'pointer' : 'not-allowed', background: waarde > 0 ? '#16a34a' : '#9ca3af' }, children: bevestigLabel })] })] }) }));
}
const aantalTelKnop = {
    width: 44, height: 44, borderRadius: 10, fontSize: 22, fontWeight: 700, cursor: 'pointer',
    border: '1px solid #cbd5e1', background: '#fff',
};
const overlayStyle = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50,
};
// Weegflow: het gewicht komt (later) van de gekoppelde weegschaal; nu vult de
// medewerker het in of bevestigt de waarde. "Klopt dit?" vóór toevoegen.
function WeegModal({ product, onBevestig, onEtiket, onSluit, }) {
    const [gewicht, setGewicht] = useState('');
    const kg = Number(gewicht.replace(',', '.'));
    const geldig = kg > 0 && !Number.isNaN(kg);
    const prijs = geldig ? kg * Number(product.verkoopprijs) : 0;
    return (_jsx("div", { onClick: onSluit, style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }, children: _jsxs("div", { onClick: (e) => e.stopPropagation(), style: { background: '#fff', borderRadius: 12, padding: 24, width: 320, maxWidth: '90vw' }, children: [_jsx("h3", { style: { margin: '0 0 4px' }, children: product.naam }), _jsxs("div", { style: { color: '#666', fontSize: 13, marginBottom: 16 }, children: ["\u2696\uFE0F \u20AC ", Number(product.verkoopprijs).toFixed(2), " per kg"] }), _jsx("label", { style: { fontSize: 13, color: '#666' }, children: "Gewicht (kg)" }), _jsx("input", { autoFocus: true, value: gewicht, onChange: (e) => setGewicht(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter' && geldig)
                        onBevestig(kg); }, inputMode: "decimal", placeholder: "bv. 0,750", style: { width: '100%', padding: 10, fontSize: 18, boxSizing: 'border-box', marginTop: 4 } }), _jsxs("div", { style: { fontSize: 22, fontWeight: 700, marginTop: 12 }, children: ["\u20AC ", prijs.toFixed(2)] }), _jsx("div", { style: { fontSize: 13, color: '#666', marginTop: 8 }, children: "Klopt dit gewicht?" }), _jsxs("div", { style: { display: 'flex', gap: 8, marginTop: 12 }, children: [_jsx("button", { onClick: onSluit, style: { flex: 1, padding: 12, borderRadius: 8, border: '1px solid #ccc', background: '#fff', cursor: 'pointer' }, children: "Annuleren" }), _jsx("button", { onClick: () => geldig && onBevestig(kg), disabled: !geldig, style: { flex: 2, padding: 12, borderRadius: 8, border: 'none', color: '#fff', fontWeight: 700, cursor: geldig ? 'pointer' : 'not-allowed', background: geldig ? '#16a34a' : '#9ca3af' }, children: "Ja, toevoegen" })] }), _jsx("button", { onClick: () => geldig && onEtiket(kg), disabled: !geldig, title: "Etiket met barcode om op de verpakking te plakken", style: { width: '100%', marginTop: 10, padding: 11, borderRadius: 8, border: '1px solid #0d4589', background: '#fff', color: '#0d4589', fontWeight: 600, cursor: geldig ? 'pointer' : 'not-allowed' }, children: "\uD83C\uDFF7\uFE0F Etiket afdrukken" })] }) }));
}
const knopMini = {
    border: '1px solid #ccc', background: '#fff', borderRadius: 4,
    width: 26, height: 26, cursor: 'pointer', fontSize: 16, lineHeight: 1,
};
const diversenKnop = {
    padding: '10px 14px', borderRadius: 10, cursor: 'pointer', fontWeight: 600, fontSize: 14,
    border: '1px solid #c7d2fe', background: '#eef2ff', color: '#0d4589',
};
function ticketTab(actief) {
    return {
        display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 10,
        cursor: 'pointer', userSelect: 'none',
        border: actief ? '1px solid #0d4589' : '1px solid #cbd5e1',
        background: actief ? '#0d4589' : '#fff',
        color: actief ? '#fff' : '#0d1c33',
    };
}
const tegelGrid = {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8,
};
function tegel(bg, border) {
    return {
        textAlign: 'left', padding: '12px 10px', borderRadius: 10, cursor: 'pointer',
        border: `1px solid ${border}`, background: bg, minHeight: 56,
    };
}
function filterKnop(actief) {
    return {
        padding: '6px 12px', borderRadius: 20, cursor: 'pointer', fontSize: 13,
        border: actief ? '2px solid #2563eb' : '1px solid #ccc',
        background: actief ? '#eff6ff' : '#fff', fontWeight: actief ? 600 : 400,
    };
}
// Ticket met BTW-uitsplitsing, betaalwijze en (bij cash) teruggave.
export function TicketWeergave({ ticket, onNieuw, nieuwLabel = 'Nieuwe verkoop' }) {
    // Druk het ticket automatisch af zodra de verkoop klaar is (bonprinter).
    // Uit te zetten met localStorage 'kassa.autoprint' = 'uit'.
    useEffect(() => {
        if (localStorage.getItem('kassa.autoprint') === 'uit')
            return;
        const t = setTimeout(() => { try {
            window.print();
        }
        catch { /* geen printer */ } }, 300);
        return () => clearTimeout(t);
    }, []);
    const betaalLabel = betaalNaam(ticket.betaalwijze);
    return (_jsxs("div", { style: { maxWidth: 380 }, children: [_jsx("style", { children: `
        @media print {
          @page { size: 80mm auto; margin: 0; }
          html, body { margin: 0 !important; padding: 0 !important; }
          nav { display: none !important; }
          body * { visibility: hidden; }
          .ticket-print, .ticket-print * { visibility: visible; }
          .ticket-print {
            position: absolute; left: 0; top: 0;
            width: 80mm; box-sizing: border-box; padding: 2mm 3mm 20mm 9mm !important;
            border: none !important; border-radius: 0 !important;
            font-family: monospace; color: #000;
          }
        }
      ` }), ticket.offline && (_jsx("div", { style: { background: '#fef3c7', border: '1px solid #f59e0b', color: '#92400e', borderRadius: 8, padding: '8px 12px', marginBottom: 10, fontSize: 13 }, children: "\u26A0 Offline bewaard \u2014 wordt automatisch verstuurd zodra er weer verbinding is." })), _jsxs("div", { className: "ticket-print", style: { border: '1px solid #ddd', borderRadius: 8, padding: 20, fontFamily: 'monospace' }, children: [_jsx("div", { style: { textAlign: 'center', fontWeight: 800, fontSize: 22, letterSpacing: '.03em', marginBottom: 2 }, children: "March\u00E9" }), _jsx("div", { style: { textAlign: 'center', fontSize: 11, color: '#666', letterSpacing: '.1em', marginBottom: 4 }, children: "KASSATICKET" }), _jsx("div", { style: { textAlign: 'center', fontSize: 12, color: '#666' }, children: new Date(ticket.datum).toLocaleString('nl-BE') }), ticket.verkoper && (_jsxs("div", { style: { textAlign: 'center', fontSize: 12, color: '#666' }, children: ["Verkoper: ", ticket.verkoper] })), _jsx("hr", {}), ticket.lijnen.map((l, i) => (_jsxs("div", { children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start', fontSize: 13 }, children: [_jsxs("span", { style: { flex: 1, minWidth: 0, wordBreak: 'break-word' }, children: [l.aantal, " \u00D7 ", l.naam] }), _jsxs("span", { style: { whiteSpace: 'nowrap', flex: 'none' }, children: ["\u20AC ", l.totaal.toFixed(2)] })] }), l.kortingPct != null && l.kortingPct > 0 && l.origineelTotaal != null && (_jsx("div", { style: { display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11, color: '#166534' }, children: _jsxs("span", { children: ["\u00A0\u00A0was ", _jsxs("span", { style: { textDecoration: 'line-through' }, children: ["\u20AC ", l.origineelTotaal.toFixed(2)] }), " \u00B7 korting \u2212", l.kortingPct, "%"] }) }))] }, i))), _jsx("hr", {}), ticket.verkoopKortingPct != null && ticket.verkoopKortingPct > 0 && (_jsxs(_Fragment, { children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13 }, children: [_jsx("span", { children: "Subtotaal" }), _jsxs("span", { style: { whiteSpace: 'nowrap' }, children: ["\u20AC ", (ticket.subtotaal ?? ticket.totaal).toFixed(2)] })] }), _jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13, color: '#166534' }, children: [_jsxs("span", { children: ["Korting \u2212", ticket.verkoopKortingPct, "%"] }), _jsxs("span", { style: { whiteSpace: 'nowrap' }, children: ["\u2212\u20AC ", ((ticket.subtotaal ?? ticket.totaal) - ticket.totaal).toFixed(2)] })] })] })), _jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', gap: 8, fontWeight: 700, fontSize: 16 }, children: [_jsx("span", { children: "TOTAAL" }), _jsxs("span", { style: { whiteSpace: 'nowrap' }, children: ["\u20AC ", ticket.totaal.toFixed(2)] })] }), _jsx("div", { style: { marginTop: 8, fontSize: 12, color: '#555' }, children: ticket.btwOverzicht.map((b) => (_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', gap: 8 }, children: [_jsxs("span", { style: { flex: 1, minWidth: 0 }, children: ["BTW ", b.percentage, "% (maatstaf ", _jsxs("span", { style: { whiteSpace: 'nowrap' }, children: ["\u20AC ", b.maatstaf.toFixed(2)] }), ")"] }), _jsxs("span", { style: { whiteSpace: 'nowrap', flex: 'none' }, children: ["\u20AC ", b.btw.toFixed(2)] })] }, b.percentage))) }), _jsx("hr", {}), _jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13 }, children: [_jsxs("span", { children: ["Betaald (", betaalLabel, ")"] }), _jsxs("span", { style: { whiteSpace: 'nowrap' }, children: ["\u20AC ", ticket.totaal.toFixed(2)] })] }), ticket.ontvangen != null && (_jsxs(_Fragment, { children: [_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13 }, children: [_jsx("span", { children: "Ontvangen" }), _jsxs("span", { style: { whiteSpace: 'nowrap' }, children: ["\u20AC ", ticket.ontvangen.toFixed(2)] })] }), ticket.teruggeven != null && (_jsxs("div", { style: { display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13, fontWeight: 700 }, children: [_jsx("span", { children: "Teruggegeven" }), _jsxs("span", { style: { whiteSpace: 'nowrap' }, children: ["\u20AC ", ticket.teruggeven.toFixed(2)] })] }))] })), _jsx("hr", {}), _jsxs("div", { style: { textAlign: 'center', fontSize: 11, color: '#555', marginTop: 6, lineHeight: 1.5 }, children: [_jsx("div", { children: "Onderbossenaarstraat 1, Maarkedal" }), _jsx("div", { children: "BTW BE-0801311258" })] })] }), _jsxs("div", { style: { display: 'flex', gap: 8, marginTop: 16 }, children: [_jsx("button", { onClick: () => window.print(), style: { flex: 1, padding: 12, cursor: 'pointer' }, children: "Afdrukken" }), _jsx("button", { onClick: onNieuw, style: { flex: 2, padding: 12, cursor: 'pointer', fontWeight: 700, color: '#fff', background: '#2563eb', border: 'none', borderRadius: 6 }, children: nieuwLabel })] })] }));
}
