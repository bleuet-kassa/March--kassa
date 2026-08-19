import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Beheert de zelf-aanpasbare inhoud van de publieke site: vrije teksten,
// openingsuren en partners.
@Injectable()
export class SiteService {
  constructor(private prisma: PrismaService) {}

  async inhoud() {
    const [teksten, openingsuren, partners] = await Promise.all([
      this.prisma.siteTekst.findMany(),
      this.prisma.openingsuur.findMany({ orderBy: { dag: 'asc' } }),
      this.prisma.partner.findMany({ orderBy: [{ volgorde: 'asc' }, { naam: 'asc' }] }),
    ]);
    const t: Record<string, string> = {};
    for (const r of teksten) t[r.sleutel] = r.waarde;
    return { teksten: t, openingsuren, partners };
  }

  async zetTeksten(teksten: Record<string, string>) {
    const entries = Object.entries(teksten || {});
    await this.prisma.$transaction(
      entries.map(([sleutel, waarde]) =>
        this.prisma.siteTekst.upsert({
          where: { sleutel },
          create: { sleutel, waarde: waarde ?? '' },
          update: { waarde: waarde ?? '' },
        }),
      ),
    );
    return this.inhoud();
  }

  async zetOpeningsuren(rijen: { dag: number; gesloten: boolean; van?: string | null; tot?: string | null }[]) {
    if (!Array.isArray(rijen)) throw new BadRequestException('Ongeldige openingsuren.');
    await this.prisma.$transaction(
      rijen.map((r) =>
        this.prisma.openingsuur.upsert({
          where: { dag: r.dag },
          create: { dag: r.dag, gesloten: !!r.gesloten, van: r.van || null, tot: r.tot || null },
          update: { gesloten: !!r.gesloten, van: r.van || null, tot: r.tot || null },
        }),
      ),
    );
    return this.prisma.openingsuur.findMany({ orderBy: { dag: 'asc' } });
  }

  nieuwePartner(input: { naam: string; website?: string | null; volgorde?: number }) {
    if (!input.naam?.trim()) throw new BadRequestException('Naam is vereist.');
    return this.prisma.partner.create({
      data: { naam: input.naam.trim(), website: input.website || null, volgorde: input.volgorde ?? 0 },
    });
  }

  updatePartner(id: string, input: { naam?: string; website?: string | null; logoUrl?: string | null; volgorde?: number }) {
    return this.prisma.partner.update({
      where: { id },
      data: {
        ...(input.naam !== undefined ? { naam: input.naam.trim() } : {}),
        ...(input.website !== undefined ? { website: input.website || null } : {}),
        ...(input.logoUrl !== undefined ? { logoUrl: input.logoUrl || null } : {}),
        ...(input.volgorde !== undefined ? { volgorde: input.volgorde } : {}),
      },
    });
  }

  verwijderPartner(id: string) {
    return this.prisma.partner.delete({ where: { id } });
  }

  // --- Afbeeldingen (bytes in de DB, geserveerd via /site/afbeelding/:id) ---
  async bewaarAfbeelding(file: { buffer: Buffer; mimetype: string } | undefined) {
    if (!file?.buffer) throw new BadRequestException('Geen bestand ontvangen.');
    if (!file.mimetype?.startsWith('image/')) throw new BadRequestException('Enkel afbeeldingen zijn toegelaten.');
    const a = await this.prisma.siteAfbeelding.create({ data: { mimetype: file.mimetype, data: file.buffer } });
    return { id: a.id, url: `/api/site/afbeelding/${a.id}` };
  }

  afbeelding(id: string) {
    return this.prisma.siteAfbeelding.findUnique({ where: { id } });
  }
}
