// Kleine helper om de centrale server aan te spreken.
const BASE = '/api';
export async function getSpeciaalProducten() {
    return (await fetch(`${BASE}/producten/speciaal`)).json();
}
export async function getProductByBarcode(barcode) {
    const res = await fetch(`${BASE}/producten/barcode/${encodeURIComponent(barcode)}`);
    if (!res.ok)
        throw new Error('Product niet gevonden');
    return res.json();
}
export async function getProducten() {
    const res = await fetch(`${BASE}/producten`);
    return res.json();
}
export async function afrekenen(input) {
    const res = await fetch(`${BASE}/verkopen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
    });
    if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message ?? 'Afrekenen mislukt');
    }
    return res.json();
}
export async function getVerkopen(datum) {
    const q = datum ? `?datum=${encodeURIComponent(datum)}` : '';
    return (await fetch(`${BASE}/verkopen${q}`)).json();
}
export async function getTicket(id) {
    return (await fetch(`${BASE}/verkopen/${id}/ticket`)).json();
}
// Een verkoop annuleren/schrappen (admin): telt niet meer mee in de dagafsluiting,
// de voorraad wordt teruggeboekt.
export async function annuleerVerkoop(id, reden) {
    return jsonOrThrow(await fetch(`${BASE}/verkopen/${id}/annuleer`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reden }),
    }));
}
// De betaalwijze van een bestaande verkoop wijzigen (admin).
export async function wijzigVerkoopBetaalwijze(id, betaalwijze) {
    return jsonOrThrow(await fetch(`${BASE}/verkopen/${id}/betaalwijze`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ betaalwijze }),
    }));
}
// Actieve verkopers (voor de verkoper-keuze per ticket aan de kassa).
export async function getGebruikers() {
    return (await fetch(`${BASE}/auth/gebruikers`)).json();
}
// Volledig personeelsbeheer (incl. niet-actieve accounts).
export async function getPersoneel() {
    return (await fetch(`${BASE}/auth/personeel`)).json();
}
export async function nieuwPersoneelslid(input) {
    return jsonOrThrow(await fetch(`${BASE}/auth/personeel`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    }));
}
export async function updatePersoneelslid(id, input) {
    return jsonOrThrow(await fetch(`${BASE}/auth/personeel/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    }));
}
export async function login(email, wachtwoord) {
    const res = await fetch(`${BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, wachtwoord }),
    });
    if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message ?? 'Inloggen mislukt');
    }
    return res.json();
}
export async function getDagoverzicht() {
    return (await fetch(`${BASE}/dagafsluiting/overzicht`)).json();
}
export async function dagAfsluiten(gebruikerId) {
    return jsonOrThrow(await fetch(`${BASE}/dagafsluiting`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gebruikerId }),
    }));
}
export async function getAfsluitingen() {
    return (await fetch(`${BASE}/dagafsluiting`)).json();
}
export async function getDagRapport(id) {
    return (await fetch(`${BASE}/dagafsluiting/${id}`)).json();
}
export function dagafsluitingCsvUrl(id) {
    return `${BASE}/dagafsluiting/${id}/csv`;
}
export async function updateOnderneming(input) {
    return jsonOrThrow(await fetch(`${BASE}/meta/onderneming`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
    }));
}
export async function getOndernemingen() {
    return (await fetch(`${BASE}/meta/ondernemingen`)).json();
}
export async function updateOndernemingById(id, input) {
    return jsonOrThrow(await fetch(`${BASE}/meta/onderneming/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
    }));
}
export async function getMaandoverzicht() {
    return (await fetch(`${BASE}/rapporten/maandoverzicht`)).json();
}
export async function getCategorieRapport(van, tot) {
    const q = new URLSearchParams();
    if (van)
        q.set('van', van);
    if (tot)
        q.set('tot', tot);
    return (await fetch(`${BASE}/rapporten/categorie?${q.toString()}`)).json();
}
export async function getKassaVsFacturen(van, tot) {
    const q = new URLSearchParams();
    if (van)
        q.set('van', van);
    if (tot)
        q.set('tot', tot);
    return (await fetch(`${BASE}/rapporten/kassa-facturen?${q.toString()}`)).json();
}
export async function getCadeaubonnen(zoek = '') {
    return (await fetch(`${BASE}/cadeaubonnen?zoek=${encodeURIComponent(zoek)}`)).json();
}
export async function getNieuwBonNummer() {
    return (await (await fetch(`${BASE}/cadeaubonnen/nieuw-nummer`)).json()).nummer;
}
export async function createCadeaubon(input) {
    return jsonOrThrow(await fetch(`${BASE}/cadeaubonnen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
    }));
}
export async function bonInwisselen(id) {
    return jsonOrThrow(await fetch(`${BASE}/cadeaubonnen/${id}/inwisselen`, { method: 'POST' }));
}
async function jsonOrThrow(res) {
    if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message ?? 'Bewerking mislukt');
    }
    return res.json();
}
export async function getMeta() {
    return (await fetch(`${BASE}/meta`)).json();
}
export async function getProductenBeheer(zoek = '') {
    const res = await fetch(`${BASE}/producten?zoek=${encodeURIComponent(zoek)}`);
    return res.json();
}
export async function getProduct(id) {
    return (await fetch(`${BASE}/producten/${id}`)).json();
}
export async function nieuweBarcode() {
    return (await (await fetch(`${BASE}/producten/nieuwe-barcode`)).json()).barcode;
}
export async function createProduct(input) {
    return jsonOrThrow(await fetch(`${BASE}/producten`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
    }));
}
export async function updateProduct(id, input) {
    return jsonOrThrow(await fetch(`${BASE}/producten/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
    }));
}
// Snel een product in/uit de webshop zetten (webshop-assortiment).
export async function setProductWebshop(id, zichtbaar) {
    return jsonOrThrow(await fetch(`${BASE}/producten/${id}/webshop`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zichtbaar }),
    }));
}
export async function getWebshopProducten(afdelingId) {
    const q = afdelingId ? `?afdelingId=${encodeURIComponent(afdelingId)}` : '';
    return (await fetch(`${BASE}/webshop/producten${q}`)).json();
}
export async function getWebshopAfdelingen() {
    return (await fetch(`${BASE}/webshop/afdelingen`)).json();
}
export async function plaatsBestelling(input) {
    return jsonOrThrow(await fetch(`${BASE}/webshop/bestelling`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    }));
}
// Testmodus: de online betaling simuleren (in LIVE gebeurt dit via Axepta).
export async function betalingAfronden(id, gelukt) {
    return jsonOrThrow(await fetch(`${BASE}/webshop/betaling/${id}/afronden`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gelukt }),
    }));
}
export async function getBestellingen() {
    return (await fetch(`${BASE}/webshop/bestellingen`)).json();
}
export async function updateBestellingStatus(id, status) {
    return jsonOrThrow(await fetch(`${BASE}/webshop/bestellingen/${id}/status`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
    }));
}
export async function createCategorie(naam, afdelingId) {
    return jsonOrThrow(await fetch(`${BASE}/meta/categorie`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ naam, afdelingId: afdelingId ?? null }),
    }));
}
export async function createAfdeling(naam) {
    return jsonOrThrow(await fetch(`${BASE}/meta/afdeling`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ naam }),
    }));
}
export async function categorieNaarAfdeling(categorieId, afdelingId) {
    return jsonOrThrow(await fetch(`${BASE}/meta/categorie/afdeling`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categorieId, afdelingId }),
    }));
}
export async function createLeverancier(naam) {
    return jsonOrThrow(await fetch(`${BASE}/meta/leverancier`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ naam }),
    }));
}
export async function voorraadOntvangst(productId, locatieId, aantal) {
    await jsonOrThrow(await fetch(`${BASE}/stock/ontvangst`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, locatieId, aantal }),
    }));
}
export async function factuurInlezen(file) {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`${BASE}/facturen/inlezen`, { method: 'POST', body: fd });
    if (!res.ok) {
        const b = await res.json().catch(() => null);
        throw new Error(b?.message ?? 'Inlezen mislukt');
    }
    return res.json();
}
export async function factuurVerwerken(regels, locatieId) {
    return jsonOrThrow(await fetch(`${BASE}/facturen/verwerken`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ regels, locatieId }),
    }));
}
export async function getScradaStatus() {
    return (await fetch(`${BASE}/scrada/status`)).json();
}
export async function getScradaOpenstaande() {
    return (await fetch(`${BASE}/scrada/openstaande`)).json();
}
export async function getScradaPreview(id) {
    return (await fetch(`${BASE}/scrada/preview/${id}`)).json();
}
export async function scradaVerstuurEen(id) {
    return jsonOrThrow(await fetch(`${BASE}/scrada/verstuur/${id}`, { method: 'POST' }));
}
export async function scradaVerstuurAlles() {
    return jsonOrThrow(await fetch(`${BASE}/scrada/verstuur`, { method: 'POST' }));
}
export async function getWeegEtiket(productId, gewicht) {
    return jsonOrThrow(await fetch(`${BASE}/weeg/etiket`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId, gewicht }),
    }));
}
export async function getKortingsregelingen() {
    return (await fetch(`${BASE}/kortingen/regelingen`)).json();
}
export async function nieuweKortingsregeling(input) {
    return jsonOrThrow(await fetch(`${BASE}/kortingen/regelingen`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
    }));
}
export async function getBegunstigden(zoek) {
    const q = zoek ? `?zoek=${encodeURIComponent(zoek)}` : '';
    return (await fetch(`${BASE}/kortingen/begunstigden${q}`)).json();
}
export async function nieuweBegunstigde(input) {
    return jsonOrThrow(await fetch(`${BASE}/kortingen/begunstigden`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
    }));
}
export async function verwijderBegunstigde(id) {
    return jsonOrThrow(await fetch(`${BASE}/kortingen/begunstigden/${id}`, { method: 'DELETE' }));
}
export async function kortingVoorEmail(email) {
    return (await fetch(`${BASE}/kortingen/voor-email?email=${encodeURIComponent(email)}`)).json();
}
export async function getSiteInhoud() {
    return (await fetch(`${BASE}/site/inhoud`)).json();
}
export async function zetSiteTeksten(teksten) {
    return jsonOrThrow(await fetch(`${BASE}/site/teksten`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(teksten),
    }));
}
export async function zetOpeningsuren(openingsuren) {
    return jsonOrThrow(await fetch(`${BASE}/site/openingsuren`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ openingsuren }),
    }));
}
export async function nieuwePartner(input) {
    return jsonOrThrow(await fetch(`${BASE}/site/partners`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    }));
}
export async function updatePartner(id, input) {
    return jsonOrThrow(await fetch(`${BASE}/site/partners/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    }));
}
export async function verwijderPartner(id) {
    return jsonOrThrow(await fetch(`${BASE}/site/partners/${id}`, { method: 'DELETE' }));
}
// Afbeelding uploaden -> { id, url }. url is te gebruiken als <img src>.
export async function uploadSiteAfbeelding(bestand) {
    const fd = new FormData();
    fd.append('bestand', bestand);
    return jsonOrThrow(await fetch(`${BASE}/site/afbeelding`, { method: 'POST', body: fd }));
}
export async function getRekeningenKassa() {
    return (await fetch(`${BASE}/rekeningen/kassa`)).json();
}
export async function getRekeningOverzicht() {
    return (await fetch(`${BASE}/rekeningen/overzicht`)).json();
}
export async function nieuwRekeningBedrijf(input) {
    return jsonOrThrow(await fetch(`${BASE}/rekeningen/bedrijven`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }));
}
export async function updateRekeningBedrijf(id, input) {
    return jsonOrThrow(await fetch(`${BASE}/rekeningen/bedrijven/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }));
}
export async function nieuwRekeningLid(input) {
    return jsonOrThrow(await fetch(`${BASE}/rekeningen/leden`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }));
}
export async function updateRekeningLid(id, input) {
    return jsonOrThrow(await fetch(`${BASE}/rekeningen/leden/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }));
}
export async function getBedrijfVerkopen(id) {
    return (await fetch(`${BASE}/rekeningen/bedrijven/${id}/verkopen`)).json();
}
export async function factureerBedrijf(id) {
    return jsonOrThrow(await fetch(`${BASE}/rekeningen/bedrijven/${id}/factureer`, { method: 'POST' }));
}
