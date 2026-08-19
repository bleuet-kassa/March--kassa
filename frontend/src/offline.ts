// Offline-buffer voor de kassa: de kassa moet blijven werken als het internet
// even wegvalt. We cachen de producten lokaal (scannen werkt offline) en zetten
// verkopen die niet verstuurd raken in een lokale wachtrij, die automatisch
// gesynchroniseerd wordt zodra de verbinding terug is. Elke verkoop draagt een
// idempotencyKey, zodat de server ze nooit dubbel boekt.

import { afrekenen, getProductenBeheer, type ProductVol, type Betaalwijze } from './api/client';

const PROD_KEY = 'kassa.producten.cache';
const QUEUE_KEY = 'kassa.offline.queue';

export type WachtPayload = {
  lijnen: { productId: string; aantal: number; kortingPct?: number; bedrag?: number }[];
  betaalwijze?: Betaalwijze; // weglaten bij "op rekening"
  ontvangen?: number;
  gebruikerId?: string;
  kortingReden?: string;
  verkoopKortingPct?: number;
  rekeningBedrijfId?: string;
  rekeningLidId?: string;
  idempotencyKey: string;
};

export type WachtVerkoop = {
  idempotencyKey: string;
  payload: WachtPayload;
  tijd: number;
};

// --- Productcache (voor offline scannen én de tegel-kassa) ---
export function cacheProducten(list: ProductVol[]) {
  // Enkel echte lijsten bewaren — nooit een foutobject (bv. van een 401).
  if (Array.isArray(list)) localStorage.setItem(PROD_KEY, JSON.stringify(list));
}
export function getCachedProducten(): ProductVol[] {
  try {
    const v = JSON.parse(localStorage.getItem(PROD_KEY) || '[]');
    return Array.isArray(v) ? (v as ProductVol[]) : [];
  } catch {
    return [];
  }
}
export function getCachedProduct(barcode: string): ProductVol | undefined {
  return getCachedProducten().find((p) => p.barcode === barcode);
}
// Ververst de cache vanaf de server (stil falen als er geen verbinding is).
export async function ververCache(): Promise<void> {
  try {
    const list = await getProductenBeheer();
    if (Array.isArray(list)) cacheProducten(list); // negeer een foutantwoord
  } catch {
    /* offline — we werken verder met de bestaande cache */
  }
}

// --- Wachtrij van niet-verstuurde verkopen ---
export function getQueue(): WachtVerkoop[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]') as WachtVerkoop[];
  } catch {
    return [];
  }
}
function setQueue(q: WachtVerkoop[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  window.dispatchEvent(new Event('offline-queue-changed'));
}
export function enqueue(v: WachtVerkoop) {
  setQueue([...getQueue(), v]);
}
export function queueCount(): number {
  return getQueue().length;
}

// Een netwerkfout (server onbereikbaar) is in de browser een TypeError bij
// fetch; een echte serverfout komt als gewone Error (met boodschap).
function isNetwerkfout(e: unknown): boolean {
  return !navigator.onLine || e instanceof TypeError;
}

let bezig = false;
// Probeert de wachtrij te versturen. Netwerkfout -> stoppen en later opnieuw.
// Serverfout op één verkoop -> die verkoop uit de rij halen (anders blijft ze
// de rij blokkeren) en verder met de rest.
export async function syncQueue(): Promise<number> {
  if (bezig) return queueCount();
  bezig = true;
  try {
    for (const item of getQueue()) {
      try {
        await afrekenen(item.payload); // idempotent op de server
        setQueue(getQueue().filter((x) => x.idempotencyKey !== item.idempotencyKey));
      } catch (e) {
        if (isNetwerkfout(e)) break; // nog offline → later opnieuw
        // serverfout: verwijder de vastzittende verkoop uit de rij
        setQueue(getQueue().filter((x) => x.idempotencyKey !== item.idempotencyKey));
      }
    }
  } finally {
    bezig = false;
  }
  return queueCount();
}

export { isNetwerkfout };
