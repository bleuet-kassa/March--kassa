import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { authSecret } from './token';

// Versleuteling van gevoelige velden in de database (bv. de pincode van een tankkaart).
// AES-256-GCM met een sleutel uit GEHEIM_SLEUTEL (Render-omgeving), anders afgeleid van
// AUTH_SECRET. Formaat: v1:<iv>:<tag>:<data> (base64url).
function sleutel(): Buffer {
  const bron = process.env.GEHEIM_SLEUTEL || `${authSecret()}::gevoelige-velden`;
  return createHash('sha256').update(bron).digest();
}

export function versleutel(tekst: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', sleutel(), iv);
  const data = Buffer.concat([c.update(tekst, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), data.toString('base64url')].join(':');
}

export function ontsleutel(waarde: string): string {
  const [v, iv, tag, data] = waarde.split(':');
  if (v !== 'v1' || !iv || !tag || !data) throw new Error('Onbekend formaat.');
  const d = createDecipheriv('aes-256-gcm', sleutel(), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8');
}
