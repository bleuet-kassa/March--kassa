import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { volgendCadeaubonnummer, voorgesteldCadeaubonnummer } from '../common/cadeaubonnummer';

export type NieuweBon = {
  nummer?: string;
  bedrag: number;
  datumUitgifte?: string; // ISO; standaard nu
  gebruikerId?: string;
};

@Injectable()
export class CadeaubonnenService {
  constructor(private prisma: PrismaService) {}

  // Voorstel voor het volgende automatische nummer (CB00001, CB00002, ...): dezelfde teller als
  // de kassa, zodat een bon die hier ingegeven wordt nooit botst met een bon van de kassa.
  volgendNummer(): Promise<string> {
    return voorgesteldCadeaubonnummer(this.prisma);
  }

  async nieuw(input: NieuweBon) {
    const bedrag = Number(input.bedrag);
    if (!(bedrag > 0)) throw new BadRequestException('Geef een geldig bedrag.');
    const nummer = input.nummer?.trim() || (await volgendCadeaubonnummer(this.prisma));
    try {
      return await this.prisma.cadeaubon.create({
        data: {
          nummer,
          bedrag: new Prisma.Decimal(bedrag),
          datumUitgifte: input.datumUitgifte ? new Date(input.datumUitgifte) : new Date(),
          gebruikerId: input.gebruikerId ?? null,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BadRequestException(`Cadeaubon-nummer ${nummer} bestaat al.`);
      }
      throw e;
    }
  }

  lijst(zoek?: string) {
    return this.prisma.cadeaubon.findMany({
      where: zoek ? { nummer: { contains: zoek, mode: 'insensitive' } } : {},
      orderBy: { datumUitgifte: 'desc' },
      take: 300,
      include: { gebruiker: { select: { naam: true } } },
    });
  }

  async inwisselen(id: string) {
    const bon = await this.prisma.cadeaubon.findUnique({ where: { id } });
    if (!bon) throw new NotFoundException('Cadeaubon niet gevonden.');
    if (bon.geannuleerd) throw new BadRequestException(`Cadeaubon ${bon.nummer} is vervallen: de verkoop ervan werd geannuleerd.`);
    if (bon.ingewisseld) return bon;
    return this.prisma.cadeaubon.update({
      where: { id },
      data: { ingewisseld: true, ingewisseldOp: new Date() },
    });
  }
}
