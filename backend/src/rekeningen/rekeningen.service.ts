import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// Lopende rekeningen (B2B "op rekening"): bedrijven met personeelsleden. Verkopen
// worden op een bedrijf + lid geboekt en op het einde van de maand gefactureerd.
@Injectable()
export class RekeningenService {
  constructor(private prisma: PrismaService) {}

  // Begin van de huidige kalendermaand (voor het maandbudget per personeelslid).
  private maandStart() {
    const nu = new Date();
    return new Date(nu.getFullYear(), nu.getMonth(), 1);
  }

  // Verbruik per personeelslid in de huidige kalendermaand (alle niet-geannuleerde
  // verkopen op rekening, gefactureerd of niet) — de basis voor het maandbudget.
  private async verbruikDezeMaand() {
    const rijen = await this.prisma.verkoop.groupBy({
      by: ['rekeningLidId'],
      where: { rekeningLidId: { not: null }, geannuleerd: false, datum: { gte: this.maandStart() } },
      _sum: { totaal: true },
    });
    const per = new Map<string, number>();
    for (const r of rijen) if (r.rekeningLidId) per.set(r.rekeningLidId, Math.round(Number(r._sum.totaal ?? 0) * 100) / 100);
    return per;
  }

  // Actieve bedrijven + leden (voor de keuze aan de kassa), met per lid het
  // maandbudget en wat er deze maand al verbruikt is.
  async voorKassa() {
    const [bedrijven, maand] = await Promise.all([
      this.prisma.rekeningBedrijf.findMany({
        where: { actief: true },
        include: { leden: { where: { actief: true }, orderBy: { naam: 'asc' } } },
        orderBy: { naam: 'asc' },
      }),
      this.verbruikDezeMaand(),
    ]);
    return bedrijven.map((b) => ({
      id: b.id, naam: b.naam, btwNummer: b.btwNummer, adres: b.adres, email: b.email, actief: b.actief,
      leden: b.leden.map((l) => ({
        id: l.id, naam: l.naam, actief: l.actief,
        budget: l.budget != null ? Number(l.budget) : null,
        verbruiktMaand: maand.get(l.id) ?? 0,
      })),
    }));
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
    const [open, maand] = await Promise.all([
      this.prisma.verkoop.findMany({
        where: { rekeningBedrijfId: { not: null }, gefactureerd: false },
        select: { rekeningBedrijfId: true, rekeningLidId: true, totaal: true },
      }),
      this.verbruikDezeMaand(),
    ]);
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
        verbruikt: Math.round((perLid.get(l.id) ?? 0) * 100) / 100, // openstaand (nog niet gefactureerd)
        verbruiktMaand: maand.get(l.id) ?? 0, // deze kalendermaand (basis voor het maandbudget)
      })),
    }));
  }

  // Verkopen van een bedrijf. Standaard enkel de openstaande (nog niet
  // gefactureerde); met alleenOpen=false ook het verleden (gefactureerd), en
  // optioneel binnen een periode ("tot" is exclusief: geef de dag erna door) en
  // per personeelslid. Met lijndetail, zodat je achteraf alles kan nakijken.
  async verkopen(bedrijfId: string, opties: { alleenOpen?: boolean; van?: Date; tot?: Date; lidId?: string } = {}) {
    const alleenOpen = opties.alleenOpen ?? true;
    const datum: { gte?: Date; lt?: Date } = {};
    if (opties.van) datum.gte = opties.van;
    if (opties.tot) datum.lt = opties.tot;
    const rows = await this.prisma.verkoop.findMany({
      where: {
        rekeningBedrijfId: bedrijfId,
        ...(alleenOpen ? { gefactureerd: false } : {}),
        ...(opties.lidId ? { rekeningLidId: opties.lidId } : {}),
        ...(opties.van || opties.tot ? { datum } : {}),
      },
      include: { rekeningLid: true, lijnen: { include: { product: true } } },
      orderBy: { datum: 'desc' },
      take: 1000,
    });
    return rows.map((v) => ({
      id: v.id, datum: v.datum, totaal: Number(v.totaal), gefactureerd: v.gefactureerd, geannuleerd: v.geannuleerd,
      lid: v.rekeningLid?.naam ?? null, lidId: v.rekeningLidId ?? null,
      artikels: v.lijnen.map((l) => `${Number(l.aantal)}× ${l.product.naam}`),
      lijnen: v.lijnen.map((l) => ({
        naam: l.product.naam,
        aantal: Number(l.aantal),
        eenheidsprijs: Number(l.eenheidsprijs),
        totaal: l.lijnTotaal != null ? Number(l.lijnTotaal) : Math.round(Number(l.eenheidsprijs) * Number(l.aantal) * 100) / 100,
      })),
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
