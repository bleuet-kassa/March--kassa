import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// De "Scrada-klare" voorstelling van een verkoop: alles wat Scrada nodig heeft
// om een Peppol-e-factuur (B2B) of een kasboek-ticket (particulier) te maken.
export type ScradaFactuur = {
  type: 'peppol_factuur' | 'kasticket';
  ticketRef: string;
  datum: string;
  onderneming: { naam: string; ondernemingsnummer: string; btwNummer: string | null };
  klant: { naam: string; btwNummer: string | null; email: string | null; adres: string | null } | null;
  kanaal: string;
  betaalwijze: string | null;
  lijnen: {
    omschrijving: string;
    aantal: number;
    eenheidsprijsInclBtw: number;
    btwPercentage: number;
    btwBedrag: number;
    totaalInclBtw: number;
  }[];
  btwPerTarief: { percentage: number; maatstaf: number; btw: number }[];
  totaalExclBtw: number;
  totaalBtw: number;
  totaalInclBtw: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

@Injectable()
export class ScradaService {
  constructor(private prisma: PrismaService) {}

  private verkoopMet(id: string) {
    return this.prisma.verkoop.findUnique({
      where: { id },
      include: {
        onderneming: true,
        klant: true,
        lijnen: { include: { product: true } },
      },
    });
  }

  // Bouwt de Scrada-payload uit een verkoop (verstuurt niets).
  async bouwPayload(verkoopId: string): Promise<ScradaFactuur> {
    const v = await this.verkoopMet(verkoopId);
    if (!v) throw new NotFoundException('Verkoop niet gevonden.');

    const perTarief = new Map<string, { percentage: number; maatstaf: number; btw: number }>();
    const lijnen = v.lijnen.map((l) => {
      const pct = Number(l.btwPercentage);
      const totaalIncl = Number(l.eenheidsprijs) * Number(l.aantal);
      const btw = Number(l.btwBedrag);
      const key = pct.toFixed(2);
      const rij = perTarief.get(key) ?? { percentage: pct, maatstaf: 0, btw: 0 };
      rij.maatstaf += totaalIncl - btw;
      rij.btw += btw;
      perTarief.set(key, rij);
      return {
        omschrijving: l.product.naam,
        aantal: Number(l.aantal),
        eenheidsprijsInclBtw: Number(l.eenheidsprijs),
        btwPercentage: pct,
        btwBedrag: r2(btw),
        totaalInclBtw: r2(totaalIncl),
      };
    });

    const btwPerTarief = [...perTarief.values()]
      .sort((a, b) => a.percentage - b.percentage)
      .map((t) => ({ percentage: t.percentage, maatstaf: r2(t.maatstaf), btw: r2(t.btw) }));

    const totaalIncl = Number(v.totaal);
    const totaalBtw = r2(btwPerTarief.reduce((s, t) => s + t.btw, 0));
    const klant = v.klant
      ? { naam: v.klant.naam, btwNummer: v.klant.btwNummer, email: v.klant.email, adres: v.klant.adres }
      : null;

    // B2B met BTW-nummer -> echte Peppol-factuur; anders kasticket (kasboek).
    const type = klant?.btwNummer ? 'peppol_factuur' : 'kasticket';

    return {
      type,
      ticketRef: v.id,
      datum: v.datum.toISOString(),
      onderneming: {
        naam: v.onderneming.naam,
        ondernemingsnummer: v.onderneming.ondernemingsnummer,
        btwNummer: v.onderneming.btwNummer,
      },
      klant,
      kanaal: v.kanaal,
      betaalwijze: v.betaalwijze,
      lijnen,
      btwPerTarief,
      totaalExclBtw: r2(totaalIncl - totaalBtw),
      totaalBtw,
      totaalInclBtw: r2(totaalIncl),
    };
  }

  // Verstuurt één verkoop naar Scrada. Zonder API-sleutel = testmodus (dry-run):
  // de payload wordt teruggegeven, de status blijft ongewijzigd.
  async verstuur(verkoopId: string) {
    const payload = await this.bouwPayload(verkoopId);

    if (!process.env.SCRADA_API_KEY) {
      return { modus: 'test' as const, verstuurd: false, payload };
    }

    try {
      const ref = await this.postNaarScrada(payload);
      await this.prisma.verkoop.update({
        where: { id: verkoopId },
        data: { scradaStatus: 'VERSTUURD', scradaRef: ref },
      });
      return { modus: 'live' as const, verstuurd: true, scradaRef: ref, payload };
    } catch (e) {
      await this.prisma.verkoop.update({
        where: { id: verkoopId },
        data: { scradaStatus: 'FOUT' },
      });
      return {
        modus: 'live' as const,
        verstuurd: false,
        fout: e instanceof Error ? e.message : 'onbekende fout',
        payload,
      };
    }
  }

  // Scrada is enkel voor de WINKEL (niet de import-onderneming). We filteren
  // daarom overal op verkopen van niet-importeur-ondernemingen.
  private readonly enkelWinkel = { onderneming: { isImporteur: false } } as const;

  // Verstuurt alle nog niet-verstuurde WINKEL-verkopen (batch).
  async verstuurOpenstaande(max = 100) {
    const open = await this.prisma.verkoop.findMany({
      where: { scradaStatus: { in: ['NIET_VERSTUURD', 'FOUT'] }, ...this.enkelWinkel },
      orderBy: { datum: 'asc' },
      take: max,
      select: { id: true },
    });
    let verstuurd = 0;
    let mislukt = 0;
    for (const { id } of open) {
      const res = await this.verstuur(id);
      if (res.verstuurd) verstuurd++;
      else if (res.modus === 'live') mislukt++;
    }
    return { modus: process.env.SCRADA_API_KEY ? 'live' : 'test', gevonden: open.length, verstuurd, mislukt };
  }

  async status() {
    const groepen = await this.prisma.verkoop.groupBy({
      by: ['scradaStatus'],
      where: this.enkelWinkel,
      _count: { _all: true },
    });
    const tel: Record<string, number> = { NIET_VERSTUURD: 0, VERSTUURD: 0, FOUT: 0 };
    for (const g of groepen) tel[g.scradaStatus] = g._count._all;
    return { modus: process.env.SCRADA_API_KEY ? 'live' : 'test', ...tel };
  }

  openstaande() {
    return this.prisma.verkoop.findMany({
      where: { scradaStatus: { in: ['NIET_VERSTUURD', 'FOUT'] }, ...this.enkelWinkel },
      orderBy: { datum: 'desc' },
      take: 100,
      include: { klant: true },
    });
  }

  // -------------------------------------------------------------------------
  //  De ENIGE plek met de echte Scrada-HTTP-call. Bevestig endpoint, auth-
  //  header en veld-mapping met jullie Scrada-account (api.scrada.be / Postman).
  //  Instelbaar via .env: SCRADA_BASE_URL, SCRADA_API_KEY, SCRADA_ENDPOINT,
  //  SCRADA_AUTH_HEADER (default "Authorization: Bearer <key>").
  // -------------------------------------------------------------------------
  private async postNaarScrada(payload: ScradaFactuur): Promise<string> {
    const base = process.env.SCRADA_BASE_URL || 'https://api.scrada.be';
    const endpoint = process.env.SCRADA_ENDPOINT || '/v1/sales-invoices';
    const authHeader = process.env.SCRADA_AUTH_HEADER || 'Authorization';
    const authValue =
      authHeader === 'Authorization'
        ? `Bearer ${process.env.SCRADA_API_KEY}`
        : (process.env.SCRADA_API_KEY as string);

    const res = await fetch(base + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [authHeader]: authValue },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const tekst = await res.text().catch(() => '');
      throw new Error(`Scrada gaf HTTP ${res.status}: ${tekst.slice(0, 200)}`);
    }
    const data: any = await res.json().catch(() => ({}));
    return data.id || data.reference || data.invoiceId || 'verstuurd';
  }
}
