import { createHmac, timingSafeEqual } from 'crypto';

// Zelfstandige JWT (HS256) zonder externe libs. Ondertekend met AUTH_SECRET.
const HEADER = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');

export function authSecret(): string {
  return process.env.AUTH_SECRET || 'dev-secret-marche-change-me';
}

function handtekening(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url');
}

export type TokenPayload = { sub: string; naam: string; rol: string; exp: number };

export function signToken(payload: { sub: string; naam: string; rol: string }, secret: string, geldigheidSec = 43200): string {
  const body = { ...payload, exp: Math.floor(Date.now() / 1000) + geldigheidSec };
  const p = Buffer.from(JSON.stringify(body)).toString('base64url');
  const data = `${HEADER}.${p}`;
  return `${data}.${handtekening(data, secret)}`;
}

export function verifyToken(token: string | undefined, secret: string): TokenPayload | null {
  const delen = (token || '').split('.');
  if (delen.length !== 3) return null;
  const [h, p, s] = delen;
  const verwacht = handtekening(`${h}.${p}`, secret);
  const a = Buffer.from(s);
  const b = Buffer.from(verwacht);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const body = JSON.parse(Buffer.from(p, 'base64url').toString()) as TokenPayload;
    if (body.exp && body.exp < Math.floor(Date.now() / 1000)) return null;
    return body;
  } catch {
    return null;
  }
}
