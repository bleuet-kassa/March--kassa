import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma, Eenheid } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { genereerBarcode } from '../common/barcode';

// Gegevens om een product aan te maken of te bewerken (vanuit het beheerscherm).
export type ProductInput = {
  naam: string;
  barcode?: string | null;
  interneCode?: string | null;
  verkoopprijs: number;
  inkoopprijs?: number | null;
  isAlcohol?: boolean;
  eenheid?: Eenheid;
  allergenen?: string | null;
  webshopZichtbaar?: boolean;
  fotoUrl?: string | null;
  btwTariefId: string;
  afdelingId?: string | null;
  categorieId?: string | null;
  leverancierId?: string | null;
};

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService) {}

  findAll(zoek?: string) {
    return this.prisma.product.findMany({
      where: {
        actief: true,
        ...(zoek
          ? {
              OR: [
                { naam: { contains: zoek, mode: 'insensitive' } },
                { barcode: { contains: zoek } },
                { interneCode: { contains: zoek, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: { btwTarief: true, afdeling: true, categorie: true, leverancier: true, voorraad: true },
      orderBy: { naam: 'asc' },
    });
  }

  // "Diversen"/vrij-bedrag-knoppen voor de kassa (bv. Diversen 6%, 12%, Cadeaubon).
  speciaal() {
    return this.prisma.product.findMany({
      where: { actief: true, vrijePrijs: true },
      include: { btwTarief: true },
      orderBy: { naam: 'asc' },
    });
  }

  async findOne(id: string) {
    const p = await this.prisma.product.findUnique({
      where: { id },
      include: { btwTarief: true, afdeling: true, categorie: true, leverancier: true, voorraad: { include: { locatie: true } } },
    });
    if (!p) throw new NotFoundException('Product niet gevonden.');
    return p;
  }

  // Zoek een product op barcode — de kern van het scannen aan de kassa.
  async findByBarcode(barcode: string) {
    const product = await this.prisma.product.findUnique({
      where: { barcode },
      include: { btwTarief: true },
    });
    if (!product) {
      throw new NotFoundException(`Geen product met barcode ${barcode}`);
    }
    return product;
  }

  // Genereert een vrije in-store EAN-13 (volgt op de hoogste bestaande 20-code).
  async nieuweBarcode(): Promise<string> {
    const prods = await this.prisma.product.findMany({
      where: { barcode: { startsWith: '20' } },
      select: { barcode: true },
    });
    let max = 0;
    for (const p of prods) {
      const b = p.barcode ?? '';
      if (/^20\d{11}$/.test(b)) {
        const seq = parseInt(b.substring(2, 12), 10);
        if (seq > max) max = seq;
      }
    }
    return genereerBarcode(max + 1);
  }

  async create(input: ProductInput) {
    await this.controleerUniek(input.barcode, input.interneCode, null);
    const barcode = input.barcode?.trim() || (await this.nieuweBarcode());
    const afdelingId = await this.bepaalAfdeling(input);
    return this.prisma.product.create({
      data: {
        naam: input.naam,
        barcode,
        interneCode: input.interneCode || null,
        verkoopprijs: new Prisma.Decimal(input.verkoopprijs),
        inkoopprijs: input.inkoopprijs != null ? new Prisma.Decimal(input.inkoopprijs) : null,
        isAlcohol: input.isAlcohol ?? false,
        eenheid: input.eenheid ?? Eenheid.STUK,
        allergenen: input.allergenen || null,
        webshopZichtbaar: input.webshopZichtbaar ?? false,
        fotoUrl: input.fotoUrl ?? null,
        btwTariefId: input.btwTariefId,
        afdelingId,
        categorieId: input.categorieId || null,
        leverancierId: input.leverancierId || null,
      },
      include: { btwTarief: true, afdeling: true, categorie: true, leverancier: true },
    });
  }

  async update(id: string, input: ProductInput) {
    await this.findOne(id);
    await this.controleerUniek(input.barcode, input.interneCode, id);
    const afdelingId = await this.bepaalAfdeling(input);
    return this.prisma.product.update({
      where: { id },
      data: {
        naam: input.naam,
        barcode: input.barcode?.trim() || null,
        interneCode: input.interneCode || null,
        verkoopprijs: new Prisma.Decimal(input.verkoopprijs),
        inkoopprijs: input.inkoopprijs != null ? new Prisma.Decimal(input.inkoopprijs) : null,
        isAlcohol: input.isAlcohol ?? false,
        eenheid: input.eenheid ?? Eenheid.STUK,
        allergenen: input.allergenen || null,
        webshopZichtbaar: input.webshopZichtbaar ?? false,
        fotoUrl: input.fotoUrl ?? null,
        btwTariefId: input.btwTariefId,
        afdelingId,
        categorieId: input.categorieId || null,
        leverancierId: input.leverancierId || null,
      },
      include: { btwTarief: true, afdeling: true, categorie: true, leverancier: true },
    });
  }

  // Snelle schakelaar voor het webshop-assortiment (dagelijks aan/uit vinken).
  async setWebshop(id: string, zichtbaar: boolean) {
    await this.findOne(id);
    return this.prisma.product.update({
      where: { id },
      data: { webshopZichtbaar: !!zichtbaar },
      include: { btwTarief: true, afdeling: true, categorie: true, leverancier: true },
    });
  }

  // Bepaalt de afdeling van een product: expliciet gekozen, anders afgeleid uit
  // de categorie (zodat een product altijd onder de juiste sectie-tegel valt).
  private async bepaalAfdeling(input: ProductInput): Promise<string | null> {
    if (input.afdelingId) return input.afdelingId;
    if (input.categorieId) {
      const c = await this.prisma.categorie.findUnique({
        where: { id: input.categorieId },
        select: { afdelingId: true },
      });
      return c?.afdelingId ?? null;
    }
    return null;
  }

  // Barcode en interne code moeten uniek zijn (behalve op het product zelf).
  private async controleerUniek(
    barcode?: string | null,
    interneCode?: string | null,
    eigenId?: string | null,
  ) {
    if (barcode?.trim()) {
      const b = await this.prisma.product.findUnique({ where: { barcode: barcode.trim() } });
      if (b && b.id !== eigenId) throw new BadRequestException(`Barcode ${barcode} is al in gebruik.`);
    }
    if (interneCode?.trim()) {
      const c = await this.prisma.product.findUnique({ where: { interneCode: interneCode.trim() } });
      if (c && c.id !== eigenId) throw new BadRequestException(`Interne code ${interneCode} is al in gebruik.`);
    }
  }
}
