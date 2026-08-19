import type { Gebruiker } from './api/client';

// Bewaart de ingelogde verkoper + het servertoken lokaal.
const KEY = 'kassa.verkoper';
const TOKEN_KEY = 'kassa.token';

export function getVerkoper(): Gebruiker | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Gebruiker) : null;
  } catch {
    return null;
  }
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

// Slaat de sessie op na het inloggen (verkoper + token).
export function setSessie(g: Gebruiker & { token: string }) {
  localStorage.setItem(TOKEN_KEY, g.token);
  localStorage.setItem(KEY, JSON.stringify({ id: g.id, naam: g.naam, rol: g.rol }));
}

export function logout() {
  localStorage.removeItem(KEY);
  localStorage.removeItem(TOKEN_KEY);
}

// Fetch-interceptor: stuurt het token mee bij elk /api-verzoek en bij een
// verlopen/ongeldige sessie terug naar het inlogscherm (enkel in de kassa-app).
if (typeof window !== 'undefined' && !(window as any).__marcheFetch) {
  (window as any).__marcheFetch = true;
  const orig = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
    const isApi = typeof url === 'string' && url.startsWith('/api');
    if (isApi) {
      const token = getToken();
      if (token) {
        const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
        if (!headers.has('Authorization')) headers.set('Authorization', 'Bearer ' + token);
        init = { ...(init ?? {}), headers };
      }
    }
    const res = await orig(input as any, init);
    if (isApi && res.status === 401 && !url.includes('/auth/login')) {
      if (location.pathname.startsWith('/kassa')) {
        logout();
        location.href = '/kassa';
      }
    }
    return res;
  };
}
