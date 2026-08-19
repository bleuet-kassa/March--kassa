import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const r2 = (n: number) => Math.round(n * 100) / 100;

// Managementrapporten (enkel voor beheerders): maandoverzicht om jaren te
// vergelijken, en per productcategorie omzet + aandeel + marge.
@Injectable()
export class RapportenService {
  constructor(private prisma: PrismaService) {}

  // Omzet (incl. BTW) per maand van de winkel, om jaren naast elkaar te leggen.
  async maandoverzicht() {
    const rijen = await this.prisma.$queryRaw<
      { jaar: number; maand: number; aantal: number; omzetincl: number }[]
    >(Prisma.sql`
      SELECT EXTRACT(YEAR FROM v."datum")::int AS jaar,
             EXTRACT(MONTH FROM v."datum")::int AS maand,
             COUNT(*)::int AS aantal,
             COALESCE(SUM(v."totaal"),0)::float8 AS omzetincl
      FROM "Verkoop" v
      JOIN "Onderneming" o ON o.id = v."ondernemingId"
      WHERE v."kanaal" = 'KASSA' AND o."isImporteur" = false
        AND v."geannuleerd" = false
        AND (v."betaalwijze" IS DISTINCT FROM 'EIGEN_REKENING')
      GROUP BY 1, 2
      ORDER BY 1, 2
    `);
    return rijen.map((r) => ({ jaar: r.jaar, maand: r.maand, aantal: r.aantal, omzetIncl: r2(r.omzetincl) }));
  }

  // Per categorie: omzet (excl. BTW), inkoop, marge (€ en %) en aandeel in de
  // totale omzet. Optioneel gefilterd op periode (van/tot, ISO-datums).
  async perCategorie(van?: string, tot?: string) {
    const datumFilter: Prisma.DateTimeFilter = {};
    if (van) datumFilter.gte = new Date(van);
    if (tot) datumFilter.lte = new Date(tot);

    const lijnen = await this.prisma.verkoopLijn.findMany({
      where: {
        verkoop: {
          kanaal: 'KASSA',
          onderneming: { isImporteur: false },
          geannuleerd: false,
          betaalwijze: { not: 'EIGEN_REKENING' },
          ...(van || tot ? { datum: datumFilter } : {}),
        },
      },
      include: { product: { include: { categorie: true } } },
    });

    const perCat = new Map<string, { categorie: string; omzetExcl: number; inkoop: number }>();
    for (const l of lijnen) {
      const cat = l.product.categorie?.naam ?? 'Zonder categorie';
      const aantal = Number(l.aantal);
      const omzetExcl = Number(l.eenheidsprijs) * aantal - Number(l.btwBedrag);
      const inkoopStuk = l.inkoopprijs != null ? Number(l.inkoopprijs) : Number(l.product.inkoopprijs ?? 0);
      const inkoop = inkoopStuk * aantal;
      const rij = perCat.get(cat) ?? { categorie: cat, omzetExcl: 0, inkoop: 0 };
      rij.omzetExcl += omzetExcl;
      rij.inkoop += inkoop;
      perCat.set(cat, rij);
    }

    const totaalOmzet = [...perCat.values()].reduce((s, c) => s + c.omzetExcl, 0);
    const categorieen = [...perCat.values()]
      .map((c) => {
        const marge = c.omzetExcl - c.inkoop;
        return {
          categorie: c.categorie,
          omzetExcl: r2(c.omzetExcl),
          inkoop: r2(c.inkoop),
          marge: r2(marge),
          margePct: c.omzetExcl > 0 ? r2((marge / c.omzetExcl) * 100) : 0,
          aandeelPct: totaalOmzet > 0 ? r2((c.omzetExcl / totaalOmzet) * 100) : 0,
        };
      })
      .sort((a, b) => b.omzetExcl - a.omzetExcl);

    const totInkoop = r2([...perCat.values()].reduce((s, c) => s + c.inkoop, 0));
    return {
      totaal: {
        omzetExcl: r2(totaalOmzet),
        inkoop: totInkoop,
        marge: r2(totaalOmzet - totInkoop),
        margePct: totaalOmzet > 0 ? r2(((totaalOmzet - totInkoop) / totaalOmzet) * 100) : 0,
      },
      categorieen,
    };
  }

  // Digitaal apart overzicht: kassaverkopen (particulier) vs. facturen (B2B).
  async kassaVsFacturen(van?: string, tot?: string) {
    const datumFilter: Prisma.DateTimeFilter = {};
    if (van) datumFilter.gte = new Date(van);
    if (tot) datumFilter.lte = new Date(tot);
    const verkopen = await this.prisma.verkoop.findMany({
      where: {
        kanaal: 'KASSA',
        onderneming: { isImporteur: false },
        geannuleerd: false,
        betaalwijze: { not: 'EIGEN_REKENING' },
        ...(van || tot ? { datum: datumFilter } : {}),
      },
      include: { klant: true },
    });
    const kas = { aantal: 0, omzetIncl: 0 };
    const fac = { aantal: 0, omzetIncl: 0 };
    for (const v of verkopen) {
      const doel = v.klant?.btwNummer ? fac : kas;
      doel.aantal++;
      doel.omzetIncl += Number(v.totaal);
    }
    return {
      kasticket: { aantal: kas.aantal, omzetIncl: r2(kas.omzetIncl) },
      facturen: { aantal: fac.aantal, omzetIncl: r2(fac.omzetIncl) },
    };
  }
}
