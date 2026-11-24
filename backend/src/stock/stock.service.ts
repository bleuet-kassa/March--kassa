import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class StockService {
  constructor(private prisma: PrismaService) {}

  // Voorraad per locatie (winkel, restaurant ...).
  voorraadPerLocatie(locatieId: string) {
    return this.prisma.voorraad.findMany({
      where: { locatieId },
      include: { product: true, locatie: true },
    });
  }

  // Ontvangst: voorraad bijboeken op een locatie (bv. bij levering via een ingelezen factuur).
  // Maakt de voorraadregel aan als die nog niet bestaat, en bewaart de ontvangst (datum
  // vandaag, zonder THT) in de voorraadgeschiedenis. Ontvangen met datum en THT: zie /voorraad.
  async ontvangst(params: { productId: string; locatieId: string; aantal: number; bron?: 'MANUEEL' | 'FACTUUR' }) {
    const { productId, locatieId, aantal } = params;
    const vandaag = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Brussels' }).format(new Date());
    return this.prisma.$transaction(async (tx) => {
      const v = await tx.voorraad.upsert({
        where: { productId_locatieId: { productId, locatieId } },
        create: { productId, locatieId, aantal },
        update: { aantal: { increment: aantal } },
      });
      if (Number(aantal) > 0) {
        await tx.voorraadontvangst.create({ data: { productId, locatieId, aantal: new Prisma.Decimal(Number(aantal)), ontvangenOp: vandaag, tht: null, bron: params.bron ?? 'MANUEEL' } });
      }
      return v;
    });
  }

  // Verplaats voorraad tussen twee locaties (bv. winkel -> restaurant).
  // Alles in één transactie zodat bron en bestemming altijd kloppen.
  async verplaats(params: {
    productId: string;
    vanLocatieId: string;
    naarLocatieId: string;
    aantal: number;
    gebruikerId?: string;
  }) {
    const { productId, vanLocatieId, naarLocatieId, aantal, gebruikerId } = params;
    return this.prisma.$transaction(async (tx) => {
      await tx.voorraad.update({
        where: { productId_locatieId: { productId, locatieId: vanLocatieId } },
        data: { aantal: { decrement: aantal } },
      });
      await tx.voorraad.upsert({
        where: { productId_locatieId: { productId, locatieId: naarLocatieId } },
        create: { productId, locatieId: naarLocatieId, aantal },
        update: { aantal: { increment: aantal } },
      });
      return tx.voorraadverplaatsing.create({
        data: { productId, vanLocatieId, naarLocatieId, aantal, gebruikerId },
      });
    });
  }
}
