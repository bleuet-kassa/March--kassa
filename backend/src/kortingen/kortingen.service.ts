import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class KortingenService {
  constructor(private prisma: PrismaService) {}

  // Met het aantal e-mailadressen per regeling (voor de vraag bij verwijderen).
  regelingen() {
    return this.prisma.kortingsregeling.findMany({
      where: { actief: true },
      orderBy: { naam: 'asc' },
      include: { _count: { select: { begunstigden: true } } },
    });
  }

  // Kortingsgroep verwijderen (enkel een beheerder): de e-mailadressen in het register die erbij
  // horen, gaan mee weg. Verkopen met deze korting blijven ongewijzigd: die bewaren enkel de
  // naam en het percentage, geen verwijzing.
  async verwijderRegeling(id: string) {
    const r = await this.prisma.kortingsregeling.findUnique({ where: { id: String(id ?? '') } });
    if (!r) throw new NotFoundException('Deze kortingsgroep bestaat niet (meer).');
    try {
      const weg = await this.prisma.$transaction(async (tx) => {
        const b = await tx.kortingsBegunstigde.deleteMany({ where: { regelingId: r.id } });
        await tx.kortingsregeling.delete({ where: { id: r.id } });
        return b.count;
      });
      return { ok: true, naam: r.naam, begunstigden: weg };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') throw new NotFoundException('Deze kortingsgroep bestaat niet (meer).');
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2003') throw new BadRequestException('Er werd net een e-mailadres aan deze kortingsgroep gekoppeld. Probeer opnieuw.');
      throw e;
    }
  }

  async nieuweRegeling(input: { naam: string; pct: number }) {
    const pct = Number(input.pct);
    if (!input.naam?.trim() || !(pct > 0 && pct <= 100)) throw new BadRequestException('Naam en een geldig percentage (1-100) zijn vereist.');
    try {
      return await this.prisma.kortingsregeling.create({ data: { naam: input.naam.trim(), pct: new Prisma.Decimal(pct) } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new BadRequestException('Er bestaat al een regeling met die naam.');
      throw e;
    }
  }

  begunstigden(zoek?: string) {
    return this.prisma.kortingsBegunstigde.findMany({
      where: zoek ? { OR: [{ email: { contains: zoek, mode: 'insensitive' } }, { naam: { contains: zoek, mode: 'insensitive' } }] } : {},
      include: { regeling: true },
      orderBy: { email: 'asc' },
      take: 500,
    });
  }

  async nieuweBegunstigde(input: { email: string; naam?: string; regelingId: string }) {
    if (!input.email?.trim() || !input.regelingId) throw new BadRequestException('E-mail en regeling zijn vereist.');
    try {
      return await this.prisma.kortingsBegunstigde.create({
        data: { email: input.email.trim().toLowerCase(), naam: input.naam?.trim() || null, regelingId: input.regelingId },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new BadRequestException('Dit e-mailadres staat al in het register.');
      throw e;
    }
  }

  verwijderBegunstigde(id: string) {
    return this.prisma.kortingsBegunstigde.delete({ where: { id } });
  }

  // Webshop-voorbereiding: welke korting hoort bij een e-mailadres?
  async voorEmail(email: string) {
    if (!email?.trim()) return null;
    const b = await this.prisma.kortingsBegunstigde.findUnique({
      where: { email: email.trim().toLowerCase() },
      include: { regeling: true },
    });
    return b?.regeling?.actief ? b.regeling : null;
  }
}
