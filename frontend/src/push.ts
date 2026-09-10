import { getVapidPublicKey, abonneerPush, verwijderPushAbonnement } from './api/client';

// Pushmeldingen op de telefoon van de beheerder (Web Push). De service worker
// (/sw.js) toont de melding en opent bij een tik de bevestigpagina.

export function pushOndersteund(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// Staat de kassa als app op het beginscherm? (Op iPhone is dat vereist voor push.)
export function staatOpBeginscherm(): boolean {
  return (window.matchMedia?.('(display-mode: standalone)').matches ?? false) || (navigator as { standalone?: boolean }).standalone === true;
}

// VAPID-sleutel (base64url) -> bytes, zoals de PushManager ze verwacht.
function sleutelNaarBytes(b64url: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (b64url.length % 4)) % 4);
  const b64 = (b64url + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export async function registreerServiceWorker() {
  return navigator.serviceWorker.register('/sw.js', { scope: '/' });
}

export async function huidigAbonnement(): Promise<PushSubscription | null> {
  if (!pushOndersteund()) return null;
  const reg = await navigator.serviceWorker.getRegistration('/');
  return reg ? reg.pushManager.getSubscription() : null;
}

// Meldingen inschakelen op dit toestel: toestemming vragen, abonneren en het
// abonnement op de server bewaren (gekoppeld aan de ingelogde beheerder).
export async function schakelMeldingenIn(): Promise<'ok' | 'geweigerd' | 'niet-ondersteund'> {
  if (!pushOndersteund()) return 'niet-ondersteund';
  const toestemming = await Notification.requestPermission();
  if (toestemming !== 'granted') return 'geweigerd';
  const reg = await registreerServiceWorker();
  await navigator.serviceWorker.ready;
  const { publicKey } = await getVapidPublicKey();
  const sub = (await reg.pushManager.getSubscription())
    ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: sleutelNaarBytes(publicKey) }));
  await abonneerPush(sub.toJSON(), navigator.userAgent);
  return 'ok';
}

export async function schakelMeldingenUit(): Promise<void> {
  const sub = await huidigAbonnement();
  if (!sub) return;
  await verwijderPushAbonnement(sub.endpoint).catch(() => undefined);
  await sub.unsubscribe();
}
