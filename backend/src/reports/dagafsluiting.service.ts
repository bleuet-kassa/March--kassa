import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// Verkoop met lijnen + product-categorie + klant (voor het dagontvangsten-rapport).
type VerkoopVol = Prisma.VerkoopGetPayload<{
  include: { lijnen: { include: { product: { include: { categorie: true } } } }; klant: true };
}>;

const LIJN_INCLUDE = { lijnen: { include: { product: { include: { categorie: true } } } }, klant: true } as const;

const r2 = (n: number) => Math.round(n * 100) / 100;

@Injectable()
export class DagafsluitingService {
  constructor(private prisma: PrismaService) {}

  private async winkelLocatie() {
    const locatie = await this.prisma.stockLocatie.findFirst({
      where: { type: 'WINKEL', actief: true },
    });
    if (!locatie) throw new NotFoundException('Geen actieve winkellocatie.');
    return locatie;
  }
  private winkelOnderneming() {
    return this.prisma.onderneming.findFirst({ where: { isImporteur: false } });
  }

  private openVerkopen(locatieId: string) {
    return this.prisma.verkoop.findMany({
      where: { locatieId, kanaal: 'KASSA', afgesloten: false, geannuleerd: false },
      include: LIJN_INCLUDE,
      orderBy: { datum: 'asc' },
    });
  }

  // BTW per lijn: eenheidsprijs is incl. BTW; btwBedrag is de BTW van de lijn.
  private lijnBedragen(v: VerkoopVol) {
    let incl = 0;
    let btw = 0;
    const perTarief = new Map<string, { percentage: number; maatstaf: number; btw: number }>();
    for (const l of v.lijnen) {
      const pct = Number(l.btwPercentage);
      const lijnIncl = Number(l.eenheidsprijs) * Number(l.aantal);
      const lijnBtw = Number(l.btwBedrag);
      incl += lijnIncl;
      btw += lijnBtw;
      const key = pct.toFixed(2);
      const rij = perTarief.get(key) ?? { percentage: pct, maatstaf: 0, btw: 0 };
      rij.maatstaf += lijnIncl - lijnBtw;
      rij.btw += lijnBtw;
      perTarief.set(key, rij);
    }
    return { incl, btw, perTarief };
  }

  // Bouwt het volledige dagontvangsten-rapport uit een set verkopen.
  // Splitst wettelijk: particuliere ontvangsten (dagontvangstenboek) vs.
  // uitgereikte B2B-facturen (facturenboek) — die laatste apart, niet dubbel.
  private bouwRapport(
    verkopen: VerkoopVol[],
    meta: {
      volgnummer: number | null;
      vanaf: Date | null;
      tot: Date;
      verkoper: string | null;
      onderneming: { naam: string; ondernemingsnummer: string; btwNummer: string | null; adres: string | null } | null;
      locatie: string;
    },
  ) {
    const perBetaalwijze: Record<string, number> = {};
    const perBtw = new Map<string, { percentage: number; maatstaf: number; btw: number }>();
    const perCat = new Map<string, number>(); // categorie -> omzet incl. BTW (voor op het ticket; GEEN marge)
    let ontvExcl = 0, ontvBtw = 0, ontvIncl = 0, ontvAantal = 0;
    // "Eigen rekening" (eigen gebruik): apart bijgehouden, telt NIET als ontvangst/omzet.
    let eigenAantal = 0, eigenIncl = 0;

    const facturen: { ref: string; datum: string; klant: string; btwNummer: string | null; excl: number; btw: number; incl: number }[] = [];
    const facExcl = 0, facBtw = 0, facIncl = 0;

    // Eén dagontvangsten-ticket: alle winkelverkopen samen, met de BTW gewoon
    // uitgesplitst per tarief (6% / 21%) en de omzet per categorie.
    for (const v of verkopen) {
      const { incl, btw, perTarief } = this.lijnBedragen(v);
      // Eigen gebruik ("Eigen rekening"): apart, niet in de ontvangsten/omzet/BTW.
      if (v.betaalwijze === 'EIGEN_REKENING') {
        eigenAantal++; eigenIncl += incl;
        continue;
      }
      ontvAantal++;
      ontvIncl += incl; ontvBtw += btw; ontvExcl += incl - btw;
      const bw = v.betaalwijze ?? 'ONBEKEND';
      perBetaalwijze[bw] = r2((perBetaalwijze[bw] ?? 0) + incl);
      for (const t of perTarief.values()) {
        const k = t.percentage.toFixed(2);
        const rij = perBtw.get(k) ?? { percentage: t.percentage, maatstaf: 0, btw: 0 };
        rij.maatstaf += t.maatstaf; rij.btw += t.btw;
        perBtw.set(k, rij);
      }
      for (const l of v.lijnen) {
        const cat = l.product.categorie?.naam ?? 'Overig';
        perCat.set(cat, (perCat.get(cat) ?? 0) + Number(l.eenheidsprijs) * Number(l.aantal));
      }
    }

    const perBtwTarief = [...perBtw.values()]
      .sort((a, b) => a.percentage - b.percentage)
      .map((t) => ({ percentage: t.percentage, maatstaf: r2(t.maatstaf), btw: r2(t.btw) }));
    const perCategorie = [...perCat.entries()]
      .map(([categorie, omzetIncl]) => ({ categorie, omzetIncl: r2(omzetIncl) }))
      .sort((a, b) => b.omzetIncl - a.omzetIncl);

    return {
      volgnummer: meta.volgnummer,
      onderneming: meta.onderneming,
      locatie: meta.locatie,
      verkoper: meta.verkoper,
      vanaf: meta.vanaf,
      tot: meta.tot,
      dagontvangsten: {
        aantal: ontvAantal,
        perBetaalwijze,
        perBtwTarief,
        perCategorie,
        totaalExcl: r2(ontvExcl),
        totaalBtw: r2(ontvBtw),
        totaalIncl: r2(ontvIncl),
      },
      // Eigen gebruik: apart vermeld, telt niet mee in de dagontvangsten hierboven.
      eigenGebruik: { aantal: eigenAantal, incl: r2(eigenIncl) },
      facturen,
      facturenTotaal: { aantal: facturen.length, excl: r2(facExcl), btw: r2(facBtw), incl: r2(facIncl) },
      algemeenTotaalIncl: r2(ontvIncl + facIncl),
    };
  }

  // Voorbeeld van het dagontvangsten-rapport (nog niet afgesloten).
  async overzicht() {
    const [locatie, onderneming] = await Promise.all([this.winkelLocatie(), this.winkelOnderneming()]);
    const verkopen = await this.openVerkopen(locatie.id);
    return this.bouwRapport(verkopen, {
      volgnummer: null,
      vanaf: verkopen[0]?.datum ?? null,
      tot: new Date(),
      verkoper: null,
      onderneming: onderneming ? { naam: onderneming.naam, ondernemingsnummer: onderneming.ondernemingsnummer, btwNummer: onderneming.btwNummer, adres: onderneming.adres } : null,
      locatie: locatie.naam,
    });
  }

  // Sluit de dag af: bewaart het rapport onwijzigbaar (met volgnummer) en
  // koppelt de verkopen eraan. Geeft het volledige ticket terug om af te drukken.
  async afsluiten(gebruikerId?: string) {
    const [locatie, onderneming] = await Promise.all([this.winkelLocatie(), this.winkelOnderneming()]);
    const verkoperNaam = gebruikerId
      ? (await this.prisma.gebruiker.findUnique({ where: { id: gebruikerId } }))?.naam ?? null
      : null;

    return this.prisma.$transaction(async (tx) => {
      const verkopen = (await tx.verkoop.findMany({
        where: { locatieId: locatie.id, kanaal: 'KASSA', afgesloten: false, geannuleerd: false },
        include: LIJN_INCLUDE,
        orderBy: { datum: 'asc' },
      })) as VerkoopVol[];

      const nu = new Date();
      const vanaf = verkopen[0]?.datum ?? nu;
      const volgnummer = (await tx.dagafsluiting.count()) + 1;

      const rapport = this.bouwRapport(verkopen, {
        volgnummer,
        vanaf,
        tot: nu,
        verkoper: verkoperNaam,
        onderneming: onderneming ? { naam: onderneming.naam, ondernemingsnummer: onderneming.ondernemingsnummer, btwNummer: onderneming.btwNummer, adres: onderneming.adres } : null,
        locatie: locatie.naam,
      });

      // Dagtotaal = de echte ontvangsten; eigen gebruik ("Eigen rekening") telt niet mee.
      const totaalIncl = verkopen
        .filter((v) => v.betaalwijze !== 'EIGEN_REKENING')
        .reduce((s, v) => s + Number(v.totaal), 0);
      const afsluiting = await tx.dagafsluiting.create({
        data: {
          volgnummer,
          locatieId: locatie.id,
          ondernemingId: onderneming?.id ?? null,
          gebruikerId: gebruikerId ?? null,
          vanaf,
          tot: nu,
          aantalVerkopen: verkopen.length,
          totaal: new Prisma.Decimal(r2(totaalIncl)),
          perBetaalwijze: rapport.dagontvangsten.perBetaalwijze as Prisma.InputJsonValue,
          perBtwTarief: rapport.dagontvangsten.perBtwTarief as Prisma.InputJsonValue,
        },
      });

      if (verkopen.length) {
        await tx.verkoop.updateMany({
          where: { id: { in: verkopen.map((v) => v.id) } },
          data: { afgesloten: true, dagafsluitingId: afsluiting.id },
        });
      }

      return { id: afsluiting.id, ...rapport };
    });
  }

  // Herbouwt het rapport van een bewaarde afsluiting (om opnieuw te bekijken/printen).
  async rapport(id: string) {
    const a = await this.prisma.dagafsluiting.findUnique({
      where: { id },
      include: { onderneming: true, locatie: true, gebruiker: true },
    });
    if (!a) throw new NotFoundException('Afsluiting niet gevonden.');
    const verkopen = (await this.prisma.verkoop.findMany({
      where: { dagafsluitingId: id },
      include: LIJN_INCLUDE,
      orderBy: { datum: 'asc' },
    })) as VerkoopVol[];
    return {
      id: a.id,
      ...this.bouwRapport(verkopen, {
        volgnummer: a.volgnummer,
        vanaf: a.vanaf,
        tot: a.tot,
        verkoper: a.gebruiker?.naam ?? null,
        onderneming: a.onderneming
          ? { naam: a.onderneming.naam, ondernemingsnummer: a.onderneming.ondernemingsnummer, btwNummer: a.onderneming.btwNummer, adres: a.onderneming.adres }
          : null,
        locatie: a.locatie.naam,
      }),
    };
  }

  // CSV-export van één afsluiting (manuele controle / handmatige invoer boekhouder).
  async csv(id: string): Promise<string> {
    const verkopen = (await this.prisma.verkoop.findMany({
      where: { dagafsluitingId: id },
      include: LIJN_INCLUDE,
      orderBy: { datum: 'asc' },
    })) as VerkoopVol[];
    const kop = ['Datum', 'Ticket/Factuur', 'Type', 'Klant', 'BTW-nr', 'Betaalwijze', 'Excl. BTW', 'BTW', 'Incl. BTW'];
    const rijen = verkopen.map((v) => {
      const { incl, btw } = this.lijnBedragen(v);
      const factuur = !!v.klant?.btwNummer;
      return [
        v.datum.toISOString(),
        v.scradaRef || v.id,
        factuur ? 'Factuur (B2B)' : 'Kasticket',
        v.klant?.naam ?? 'Particulier',
        v.klant?.btwNummer ?? '',
        v.betaalwijze ?? '',
        r2(incl - btw).toFixed(2),
        r2(btw).toFixed(2),
        r2(incl).toFixed(2),
      ];
    });
    return [kop, ...rijen].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  }

  geschiedenis() {
    return this.prisma.dagafsluiting.findMany({
      orderBy: { tot: 'desc' },
      take: 60,
      select: { id: true, volgnummer: true, tot: true, totaal: true, aantalVerkopen: true },
    });
  }
}
