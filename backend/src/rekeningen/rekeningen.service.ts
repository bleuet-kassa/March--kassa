import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// Lopende rekeningen (B2B "op rekening"): bedrijven met personeelsleden. Verkopen
// worden op een bedrijf + lid geboekt en op het einde van de maand gefactureerd.
@Injectable()
export class RekeningenService {
  constructor(private prisma: PrismaService) {}

  // Actieve bedrijven + leden (voor de keuze aan de kassa).
  voorKassa() {
    return this.prisma.rekeningBedrijf.findMany({
      where: { actief: true },
      include: { leden: { where: { actief: true }, orderBy: { naam: 'asc' } } },
      orderBy: { naam: 'asc' },
    });
  }

  // --- Beheer van bedrijven ---
  bedrijven() {
    return this.prisma.rekeningBedrijf.findMany({ include: { leden: true }, orderBy: { naam: 'asc' } });
  }
  async nieuwBedrijf(input: { naam: string; btwNummer?: string; adres?: string; email?: string }) {
    if (!input.naam?.trim()) throw new BadRequestException('Naam is vereist.');
    return this.prisma.rekeningBedrijf.create({
      data: { naam: input.naam.trim(), btwNummer: input.btwNummer || null, adres: input.adres || null, email: input.email || null },
    });
  }
  updateBedrijf(id: string, input: { naam?: string; btwNummer?: string | null; adres?: string | null; email?: string | null; actief?: boolean }) {
    return this.prisma.rekeningBedrijf.update({
      where: { id },
      data: {
        ...(input.naam !== undefined ? { naam: input.naam.trim() } : {}),
        ...(input.btwNummer !== undefined ? { btwNummer: input.btwNummer || null } : {}),
        ...(input.adres !== undefined ? { adres: input.adres || null } : {}),
        ...(input.email !== undefined ? { email: input.email || null } : {}),
        ...(input.actief !== undefined ? { actief: input.actief } : {}),
      },
    });
  }

  // --- Beheer van personeelsleden ---
  async nieuwLid(input: { bedrijfId: string; naam: string; budget?: number }) {
    if (!input.bedrijfId || !input.naam?.trim()) throw new BadRequestException('Bedrijf en naam zijn vereist.');
    return this.prisma.rekeningLid.create({
      data: { bedrijfId: input.bedrijfId, naam: input.naam.trim(), budget: input.budget != null ? new Prisma.Decimal(input.budget) : null },
    });
  }
  updateLid(id: string, input: { naam?: string; budget?: number | null; actief?: boolean }) {
    return this.prisma.rekeningLid.update({
      where: { id },
      data: {
        ...(input.naam !== undefined ? { naam: input.naam.trim() } : {}),
        ...(input.budget !== undefined ? { budget: input.budget != null ? new Prisma.Decimal(input.budget) : null } : {}),
        ...(input.actief !== undefined ? { actief: input.actief } : {}),
      },
    });
  }

  // Overzicht: per bedrijf het openstaande (nog niet gefactureerde) bedrag,
  // uitgesplitst per personeelslid (met eventueel budget).
  async overzicht() {
    const bedrijven = await this.prisma.rekeningBedrijf.findMany({
      include: { leden: { orderBy: { naam: 'asc' } } },
      orderBy: { naam: 'asc' },
    });
    const open = await this.prisma.verkoop.findMany({
      where: { rekeningBedrijfId: { not: null }, gefactureerd: false },
      select: { rekeningBedrijfId: true, rekeningLidId: true, totaal: true },
    });
    const perBedrijf = new Map<string, number>();
    const perLid = new Map<string, number>();
    for (const v of open) {
      const t = Number(v.totaal);
      if (v.rekeningBedrijfId) perBedrijf.set(v.rekeningBedrijfId, (perBedrijf.get(v.rekeningBedrijfId) ?? 0) + t);
      if (v.rekeningLidId) perLid.set(v.rekeningLidId, (perLid.get(v.rekeningLidId) ?? 0) + t);
    }
    return bedrijven.map((b) => ({
      id: b.id, naam: b.naam, btwNummer: b.btwNummer, adres: b.adres, email: b.email, actief: b.actief,
      openstaand: Math.round((perBedrijf.get(b.id) ?? 0) * 100) / 100,
      leden: b.leden.map((l) => ({
        id: l.id, naam: l.naam, actief: l.actief,
        budget: l.budget != null ? Number(l.budget) : null,
        verbruikt: Math.round((perLid.get(l.id) ?? 0) * 100) / 100,
      })),
    }));
  }

  // Alle verkopen van een bedrijf (standaard enkel de openstaande).
  async verkopen(bedrijfId: string, alleen = true) {
    const rows = await this.prisma.verkoop.findMany({
      where: { rekeningBedrijfId: bedrijfId, ...(alleen ? { gefactureerd: false } : {}) },
      include: { rekeningLid: true, lijnen: { include: { product: true } } },
      orderBy: { datum: 'desc' },
      take: 500,
    });
    return rows.map((v) => ({
      id: v.id, datum: v.datum, totaal: Number(v.totaal), gefactureerd: v.gefactureerd,
      lid: v.rekeningLid?.naam ?? null,
      artikels: v.lijnen.map((l) => `${Number(l.aantal)}× ${l.product.naam}`),
    }));
  }

  // Sluit de openstaande verkopen van een bedrijf af als "gefactureerd".
  async factureer(bedrijfId: string) {
    const open = await this.prisma.verkoop.findMany({
      where: { rekeningBedrijfId: bedrijfId, gefactureerd: false },
      select: { id: true, totaal: true },
    });
    const totaal = open.reduce((s, v) => s + Number(v.totaal), 0);
    await this.prisma.verkoop.updateMany({
      where: { rekeningBedrijfId: bedrijfId, gefactureerd: false },
      data: { gefactureerd: true, gefactureerdOp: new Date() },
    });
    return { aantal: open.length, totaal: Math.round(totaal * 100) / 100 };
  }

  // Verschuift een (nog niet gefactureerde) verkoop naar een andere rekening
  // (bedrijf + personeelslid). Handig voor correcties.
  async verplaatsVerkoop(verkoopId: string, bedrijfId: string, lidId: string) {
    const v = await this.prisma.verkoop.findUnique({ where: { id: verkoopId } });
    if (!v) throw new NotFoundException('Verkoop niet gevonden.');
    if (v.gefactureerd) throw new BadRequestException('Deze verkoop is al gefactureerd en kan niet meer verschoven worden.');
    const lid = await this.prisma.rekeningLid.findUnique({ where: { id: lidId } });
    if (!lid || lid.bedrijfId !== bedrijfId) throw new BadRequestException('Het personeelslid hoort niet bij het gekozen bedrijf.');
    await this.prisma.verkoop.update({
      where: { id: verkoopId },
      data: { rekeningBedrijfId: bedrijfId, rekeningLidId: lidId },
    });
    return { ok: true as const };
  }
}
