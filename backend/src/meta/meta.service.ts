import { Injectable, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// Levert de keuzelijsten voor het beheerscherm en laat toe nieuwe categorieën
// en leveranciers aan te maken vanuit de productfiche.
@Injectable()
export class MetaService {
  constructor(private prisma: PrismaService) {}

  async alles() {
    const [btwTarieven, afdelingen, categorieen, leveranciers, locaties, onderneming] = await Promise.all([
      this.prisma.btwTarief.findMany({ where: { actief: true }, orderBy: { percentage: 'asc' } }),
      this.prisma.afdeling.findMany({ orderBy: [{ volgorde: 'asc' }, { naam: 'asc' }] }),
      this.prisma.categorie.findMany({ orderBy: { naam: 'asc' } }),
      this.prisma.leverancier.findMany({ orderBy: { naam: 'asc' } }),
      this.prisma.stockLocatie.findMany({ where: { actief: true }, orderBy: { naam: 'asc' } }),
      this.prisma.onderneming.findFirst({ where: { isImporteur: false } }),
    ]);
    return { btwTarieven, afdelingen, categorieen, leveranciers, locaties, onderneming };
  }

  // Afdeling = bovenste niveau van de stock (Wijnkelder, Traiteur, ...).
  async afdeling(naam: string) {
    const bestaand = await this.prisma.afdeling.findFirst({ where: { naam } });
    return bestaand ?? this.prisma.afdeling.create({ data: { naam } });
  }
  // Verplaats een categorie naar een afdeling.
  categorieNaarAfdeling(categorieId: string, afdelingId: string | null) {
    return this.prisma.categorie.update({ where: { id: categorieId }, data: { afdelingId } });
  }

  // Werk de winkel-onderneming bij (naam, BTW-nr, adres — voor op het ticket).
  async updateOnderneming(input: { naam?: string; btwNummer?: string; adres?: string }) {
    const winkel = await this.prisma.onderneming.findFirst({ where: { isImporteur: false } });
    if (!winkel) return null;
    return this.updateOndernemingById(winkel.id, input);
  }

  // Alle ondernemingen (winkel + import) — voor de instellingen.
  ondernemingen() {
    return this.prisma.onderneming.findMany({ orderBy: { isImporteur: 'asc' } });
  }

  // Werk één onderneming bij (voor op de documenten).
  async updateOndernemingById(
    id: string,
    input: { naam?: string; ondernemingsnummer?: string; btwNummer?: string; adres?: string },
  ) {
    try {
      return await this.prisma.onderneming.update({
        where: { id },
        data: {
          ...(input.naam?.trim() ? { naam: input.naam.trim() } : {}),
          ...(input.ondernemingsnummer?.trim() ? { ondernemingsnummer: input.ondernemingsnummer.trim() } : {}),
          btwNummer: input.btwNummer?.trim() || null,
          adres: input.adres?.trim() || null,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BadRequestException('Ondernemingsnummer is al in gebruik.');
      }
      throw e;
    }
  }

  categorie(naam: string, afdelingId?: string | null) {
    return this.prisma.categorie.upsert({
      where: { naam },
      create: { naam, afdelingId: afdelingId ?? null },
      update: afdelingId ? { afdelingId } : {},
    });
  }

  async leverancier(naam: string) {
    const bestaand = await this.prisma.leverancier.findFirst({ where: { naam } });
    return bestaand ?? this.prisma.leverancier.create({ data: { naam } });
  }
}
