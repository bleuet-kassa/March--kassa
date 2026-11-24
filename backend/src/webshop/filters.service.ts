import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const MAX_FILTERS = 40;
const naamVan = (waarde: unknown) => {
  const naam = String(waarde ?? '').trim().replace(/\s+/g, ' ');
  if (naam.length < 2 || naam.length > 30) throw new BadRequestException('Geef een naam van 2 tot 30 tekens.');
  return naam;
};

// Zoekfilters van de webshop: de zaak maakt ze zelf aan (bv. "Vegetarisch", "Feestmenu") en
// duidt aan welke artikels eronder vallen. Klanten filteren erop naast zoeken op tekst.
@Injectable()
export class FiltersService {
  constructor(private prisma: PrismaService) {}

  // Publiek: enkel filters met minstens één artikel dat online staat.
  publiek(waarOnline: Prisma.ProductWhereInput) {
    return this.prisma.webshopfilter.findMany({
      where: { producten: { some: { product: waarOnline } } },
      select: { id: true, naam: true },
      orderBy: [{ volgorde: 'asc' }, { naam: 'asc' }],
    });
  }

  async beheer() {
    const rijen = await this.prisma.webshopfilter.findMany({
      include: { producten: { select: { productId: true } } },
      orderBy: [{ volgorde: 'asc' }, { naam: 'asc' }],
    });
    return rijen.map((f) => ({ id: f.id, naam: f.naam, volgorde: f.volgorde, productIds: f.producten.map((p) => p.productId) }));
  }

  // "vegetarisch" naast "Vegetarisch" zou de klant verwarren: namen vergelijken zonder hoofdletters.
  private async naamVrij(naam: string, behalveId?: string) {
    const dubbel = await this.prisma.webshopfilter.findFirst({
      where: { naam: { equals: naam, mode: 'insensitive' }, ...(behalveId ? { id: { not: behalveId } } : {}) },
      select: { id: true },
    });
    if (dubbel) throw new BadRequestException('Er bestaat al een filter met die naam.');
  }

  async maak(input: { naam?: unknown }) {
    const naam = naamVan(input?.naam);
    await this.naamVrij(naam);
    if ((await this.prisma.webshopfilter.count()) >= MAX_FILTERS) throw new BadRequestException(`Maximaal ${MAX_FILTERS} filters.`);
    const laatste = await this.prisma.webshopfilter.aggregate({ _max: { volgorde: true } });
    try {
      return await this.prisma.webshopfilter.create({ data: { naam, volgorde: (laatste._max.volgorde ?? 0) + 1 } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new BadRequestException('Er bestaat al een filter met die naam.');
      throw e;
    }
  }

  async wijzig(id: string, input: { naam?: unknown; omhoog?: unknown; omlaag?: unknown }) {
    const f = await this.prisma.webshopfilter.findUnique({ where: { id } });
    if (!f) throw new NotFoundException('Filter niet gevonden.');
    if (input?.naam !== undefined) {
      const naam = naamVan(input.naam);
      await this.naamVrij(naam, id);
      try { await this.prisma.webshopfilter.update({ where: { id }, data: { naam } }); }
      catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new BadRequestException('Er bestaat al een filter met die naam.');
        throw e;
      }
    }
    // Verschuiven in de volgorde: van plaats wisselen met de buur.
    if (input?.omhoog || input?.omlaag) {
      const alle = await this.prisma.webshopfilter.findMany({ orderBy: [{ volgorde: 'asc' }, { naam: 'asc' }] });
      const i = alle.findIndex((x) => x.id === id);
      const j = input.omhoog ? i - 1 : i + 1;
      if (j >= 0 && j < alle.length) {
        [alle[i], alle[j]] = [alle[j], alle[i]];
        await this.prisma.$transaction(alle.map((x, k) => this.prisma.webshopfilter.update({ where: { id: x.id }, data: { volgorde: k + 1 } })));
      }
    }
    return this.beheer();
  }

  async verwijder(id: string) {
    await this.prisma.webshopfilter.deleteMany({ where: { id } });
    return { ok: true };
  }

  async zetProduct(id: string, productId: string, aan: unknown) {
    if (typeof aan !== 'boolean') throw new BadRequestException('Ongeldige waarde.');
    const [f, p] = await Promise.all([
      this.prisma.webshopfilter.findUnique({ where: { id } }),
      this.prisma.product.findUnique({ where: { id: productId }, select: { id: true } }),
    ]);
    if (!f || !p) throw new NotFoundException('Filter of artikel niet gevonden.');
    if (aan) await this.prisma.productFilter.upsert({ where: { productId_filterId: { productId, filterId: id } }, create: { productId, filterId: id }, update: {} });
    else await this.prisma.productFilter.deleteMany({ where: { productId, filterId: id } });
    return { ok: true };
  }
}
