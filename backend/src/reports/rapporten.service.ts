import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { boekdatumVan, kassadag } from '../common/kassadag';
import { AANDUIDINGEN_IN_DAGAFSLUITING_VANAF, FACTUREN_IN_DAGAFSLUITING_VANAF } from './dagafsluiting.service';

const r2 = (n: number) => Math.round(n * 100) / 100;

// Managementrapporten (enkel voor beheerders): maandoverzicht om jaren te
// vergelijken, en per productcategorie omzet + aandeel + marge.
@Injectable()
export class RapportenService {
  constructor(private prisma: PrismaService) {}

  // Bedrijfsaankopen die niet in de dagontvangsten van hun aankoopdag (zullen) staan, met
  // de dag waarop ze in de dagafsluiting (zullen) tellen; telDag null = telt (nog) niet.
  private async uitgesteldeBedrijfsaankopen() {
    const rijen = await this.prisma.verkoop.findMany({
      where: {
        kanaal: 'KASSA', geannuleerd: false, onderneming: { isImporteur: false },
        OR: [
          { buitenDagontvangsten: true },
          { afgesloten: false, betaalwijze: null, betalingen: { none: {} }, OR: [{ rekeningBedrijfId: { not: null } }, { klant: { btwNummer: { not: null } } }] },
        ],
      },
      select: {
        id: true, datum: true, totaal: true, gefactureerd: true, gefactureerdOp: true, gefactureerdDagafsluitingId: true,
        factuur: { select: { datum: true, bron: true, createdAt: true, dagafsluitingId: true } },
      },
    });
    const afsluitingIds = [...new Set(rijen.flatMap((v) => [v.factuur?.dagafsluitingId, v.gefactureerdDagafsluitingId]).filter((id): id is string => !!id))];
    const afsluitingen = await this.prisma.dagafsluiting.findMany({ where: { id: { in: afsluitingIds } }, select: { id: true, boekdatum: true, vanaf: true, tot: true } });
    const boekdag = new Map(afsluitingen.map((a) => [a.id, boekdatumVan(a)]));
    const telDag = (v: (typeof rijen)[number]) => {
      const f = v.factuur;
      if (f?.dagafsluitingId) return boekdag.get(f.dagafsluitingId) ?? null;
      if (f) return f.bron === 'MAANDFACTUUR' && f.createdAt >= FACTUREN_IN_DAGAFSLUITING_VANAF ? kassadag(f.datum) : null;
      if (!v.gefactureerd) return null;
      if (v.gefactureerdDagafsluitingId) return boekdag.get(v.gefactureerdDagafsluitingId) ?? null;
      return v.gefactureerdOp && v.gefactureerdOp >= AANDUIDINGEN_IN_DAGAFSLUITING_VANAF ? kassadag(v.gefactureerdOp) : null;
    };
    return rijen.map((v) => ({ id: v.id, datum: v.datum, totaal: Number(v.totaal), telDag: telDag(v) }));
  }

  // Verkopen die in een periode tellen: alles op de verkoopdatum (ook op rekening, zonder
  // eigen gebruik), behalve de uitgestelde bedrijfsaankopen: die op hun eigen teldag.
  private async verkopenInPeriode(van?: string, tot?: string): Promise<Prisma.VerkoopWhereInput> {
    const datumFilter: Prisma.DateTimeFilter = {};
    if (van) datumFilter.gte = new Date(van);
    if (tot) datumFilter.lte = new Date(tot);
    const uitgesteld = await this.uitgesteldeBedrijfsaankopen();
    const inPeriode = (dag: string) => (!van || dag >= van.slice(0, 10)) && (!tot || dag <= tot.slice(0, 10));
    return {
      kanaal: 'KASSA',
      onderneming: { isImporteur: false },
      geannuleerd: false,
      // Zonder betaalwijze expliciet meenemen: `not` alleen laat lege waarden weg.
      AND: [
        { OR: [{ betaalwijze: null }, { betaalwijze: { not: 'EIGEN_REKENING' } }] },
        {
          OR: [
            { id: { notIn: uitgesteld.map((v) => v.id) }, ...(van || tot ? { datum: datumFilter } : {}) },
            { id: { in: uitgesteld.filter((v) => v.telDag && inPeriode(v.telDag)).map((v) => v.id) } },
          ],
        },
      ],
    };
  }

  // Omzet (incl. BTW) per maand van de winkel, om jaren naast elkaar te leggen. Telt
  // zoals de dagontvangsten: per Brusselse kassadag, en aankopen op rekening van
  // bedrijven in de maand van de factuur of de aanduiding (nog niet gefactureerd = nog niet).
  async maandoverzicht() {
    const rijen = await this.prisma.$queryRaw<
      { jaar: number; maand: number; aantal: number; omzetincl: number }[]
    >(Prisma.sql`
      SELECT EXTRACT(YEAR FROM v."datum" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Brussels')::int AS jaar,
             EXTRACT(MONTH FROM v."datum" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Brussels')::int AS maand,
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
    const perMaand = new Map(rijen.map((r) => [`${r.jaar}-${r.maand}`, { jaar: r.jaar, maand: r.maand, aantal: r.aantal, omzet: r.omzetincl }]));
    const verschuif = (dag: string, aantal: number, bedrag: number) => {
      const [jaar, maand] = dag.split('-').map(Number);
      const m = perMaand.get(`${jaar}-${maand}`) ?? { jaar, maand, aantal: 0, omzet: 0 };
      m.aantal += aantal; m.omzet += bedrag;
      perMaand.set(`${jaar}-${maand}`, m);
    };
    for (const v of await this.uitgesteldeBedrijfsaankopen()) {
      verschuif(kassadag(v.datum), -1, -v.totaal);
      if (v.telDag) verschuif(v.telDag, 1, v.totaal);
    }
    return [...perMaand.values()]
      .filter((m) => m.aantal !== 0 || Math.abs(m.omzet) >= 0.005)
      .sort((a, b) => a.jaar - b.jaar || a.maand - b.maand)
      .map((m) => ({ jaar: m.jaar, maand: m.maand, aantal: m.aantal, omzetIncl: r2(m.omzet) }));
  }

  // Per categorie: omzet (excl. BTW), inkoop, marge (€ en %) en aandeel in de
  // totale omzet. Optioneel gefilterd op periode (van/tot, ISO-datums).
  async perCategorie(van?: string, tot?: string) {
    const lijnen = await this.prisma.verkoopLijn.findMany({
      where: { verkoop: await this.verkopenInPeriode(van, tot) },
      include: { product: { include: { categorie: true } } },
    });

    const perCat = new Map<string, { categorie: string; omzetExcl: number; inkoop: number }>();
    for (const l of lijnen) {
      const cat = l.product.categorie?.naam ?? 'Zonder categorie';
      const aantal = Number(l.aantal);
      // Het exact aangerekende lijntotaal (zoals de dagontvangsten); enkel oudere lijnen herberekenen.
      const omzetExcl = (l.lijnTotaal != null ? Number(l.lijnTotaal) : Number(l.eenheidsprijs) * aantal) - Number(l.btwBedrag);
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
    const verkopen = await this.prisma.verkoop.findMany({
      where: await this.verkopenInPeriode(van, tot),
      include: { klant: true },
    });
    const kas = { aantal: 0, omzetIncl: 0 };
    const fac = { aantal: 0, omzetIncl: 0 };
    for (const v of verkopen) {
      const doel = v.klant?.btwNummer || v.rekeningBedrijfId ? fac : kas;
      doel.aantal++;
      doel.omzetIncl += Number(v.totaal);
    }
    return {
      kasticket: { aantal: kas.aantal, omzetIncl: r2(kas.omzetIncl) },
      facturen: { aantal: fac.aantal, omzetIncl: r2(fac.omzetIncl) },
    };
  }
}
