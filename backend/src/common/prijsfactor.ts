import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

// Vaste prijsfactor per artikel (klantregel 2026-11-24): verkoopprijs incl. btw = aankoopprijs
// (zonder btw) × factor, bv. 1,85 — de factor bevat marge én btw. Afgerond naar boven op 5 cent.
export const MAX_FACTOR = 20;

export function prijsUitFactor(aankoop: number, factor: number): number {
  const cent = Math.round(aankoop * factor * 100 * 1000) / 1000; // drijvende-kommaruis weg
  return (Math.ceil(cent / 5 - 1e-9) * 5) / 100;
}

// Leest een factor uit een formulier: leeg = geen factor; anders 0 < factor <= 20 (3 decimalen).
export function leesFactor(waarde: unknown): number | null {
  if (waarde === null || waarde === undefined || String(waarde).trim() === '') return null;
  const n = Number(String(waarde).replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0 || n > MAX_FACTOR) throw new BadRequestException(`Geef een factor tussen 0 en ${MAX_FACTOR} (bv. 1,85).`);
  return Math.round(n * 1000) / 1000;
}

type Db = { product: Prisma.TransactionClient['product'] };

// Een nieuwe aankoopprijs komt binnen (ontvangst of factuur). Regel: de aankoopprijs zakt nooit
// vanzelf (de hoogste blijft staan) en met een factor stijgt de verkoopprijs mee, maar zakt nooit
// vanzelf. Zonder factor: de verkoopprijs blijft, tenzij er een hogere voorgesteld wordt.
export async function verwerkAankoopprijs(db: Db, productId: string, aankoop: number, voorgesteldeVerkoopprijs?: number | null) {
  const p = await db.product.findUnique({ where: { id: productId }, select: { inkoopprijs: true, verkoopprijs: true, factor: true } });
  if (!p) return null;
  const oudeInkoop = p.inkoopprijs != null ? Number(p.inkoopprijs) : null;
  const oudeVerkoop = Number(p.verkoopprijs);
  const inkoop = oudeInkoop != null && oudeInkoop >= aankoop ? oudeInkoop : Math.round(aankoop * 100) / 100;
  let verkoop = oudeVerkoop;
  if (p.factor != null) verkoop = Math.max(oudeVerkoop, prijsUitFactor(inkoop, Number(p.factor)));
  else if (voorgesteldeVerkoopprijs != null && voorgesteldeVerkoopprijs > oudeVerkoop) verkoop = Math.round(voorgesteldeVerkoopprijs * 100) / 100;
  const gewijzigd = inkoop !== oudeInkoop || verkoop !== oudeVerkoop;
  if (gewijzigd) await db.product.update({ where: { id: productId }, data: { inkoopprijs: new Prisma.Decimal(inkoop), verkoopprijs: new Prisma.Decimal(verkoop) } });
  return { inkoopprijs: inkoop, verkoopprijs: verkoop, oudeInkoop, oudeVerkoop, gewijzigd };
}
