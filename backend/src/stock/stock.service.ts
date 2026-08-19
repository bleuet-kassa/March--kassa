import { Injectable } from '@nestjs/common';
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

  // Ontvangst: voorraad bijboeken op een locatie (bv. bij levering).
  // Maakt de voorraadregel aan als die nog niet bestaat.
  async ontvangst(params: { productId: string; locatieId: string; aantal: number }) {
    const { productId, locatieId, aantal } = params;
    return this.prisma.voorraad.upsert({
      where: { productId_locatieId: { productId, locatieId } },
      create: { productId, locatieId, aantal },
      update: { aantal: { increment: aantal } },
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
