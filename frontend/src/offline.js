// Offline-buffer voor de kassa: de kassa moet blijven werken als het internet
// even wegvalt. We cachen de producten lokaal (scannen werkt offline) en zetten
// verkopen die niet verstuurd raken in een lokale wachtrij, die automatisch
// gesynchroniseerd wordt zodra de verbinding terug is. Elke verkoop draagt een
// idempotencyKey, zodat de server ze nooit dubbel boekt.
import { afrekenen, getProductenBeheer } from './api/client';
const PROD_KEY = 'kassa.producten.cache';
const QUEUE_KEY = 'kassa.offline.queue';
// --- Productcache (voor offline scannen én de tegel-kassa) ---
export function cacheProducten(list) {
    // Enkel echte lijsten bewaren — nooit een foutobject (bv. van een 401).
    if (Array.isArray(list))
        localStorage.setItem(PROD_KEY, JSON.stringify(list));
}
export function getCachedProducten() {
    try {
        const v = JSON.parse(localStorage.getItem(PROD_KEY) || '[]');
        return Array.isArray(v) ? v : [];
    }
    catch {
        return [];
    }
}
export function getCachedProduct(barcode) {
    return getCachedProducten().find((p) => p.barcode === barcode);
}
// Ververst de cache vanaf de server (stil falen als er geen verbinding is).
export async function ververCache() {
    try {
        const list = await getProductenBeheer();
        if (Array.isArray(list))
            cacheProducten(list); // negeer een foutantwoord
    }
    catch {
        /* offline — we werken verder met de bestaande cache */
    }
}
// --- Wachtrij van niet-verstuurde verkopen ---
export function getQueue() {
    try {
        return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
    }
    catch {
        return [];
    }
}
function setQueue(q) {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
    window.dispatchEvent(new Event('offline-queue-changed'));
}
export function enqueue(v) {
    setQueue([...getQueue(), v]);
}
export function queueCount() {
    return getQueue().length;
}
// Een netwerkfout (server onbereikbaar) is in de browser een TypeError bij
// fetch; een echte serverfout komt als gewone Error (met boodschap).
function isNetwerkfout(e) {
    return !navigator.onLine || e instanceof TypeError;
}
let bezig = false;
// Probeert de wachtrij te versturen. Netwerkfout -> stoppen en later opnieuw.
// Serverfout op één verkoop -> die verkoop uit de rij halen (anders blijft ze
// de rij blokkeren) en verder met de rest.
export async function syncQueue() {
    if (bezig)
        return queueCount();
    bezig = true;
    try {
        for (const item of getQueue()) {
            try {
                await afrekenen(item.payload); // idempotent op de server
                setQueue(getQueue().filter((x) => x.idempotencyKey !== item.idempotencyKey));
            }
            catch (e) {
                if (isNetwerkfout(e))
                    break; // nog offline → later opnieuw
                // serverfout: verwijder de vastzittende verkoop uit de rij
                setQueue(getQueue().filter((x) => x.idempotencyKey !== item.idempotencyKey));
            }
        }
    }
    finally {
        bezig = false;
    }
    return queueCount();
}
export { isNetwerkfout };
