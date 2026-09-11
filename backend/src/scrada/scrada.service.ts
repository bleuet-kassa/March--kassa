import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Betaalwijze, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// ---------------------------------------------------------------------------
//  Scrada-koppeling. Elke kassaverkoop gaat als POS-ticket ("receipt") naar
//  Scrada: POST /v1/company/{companyID}/pos/receipts. Scrada verwerkt die tot
//  het dagontvangstenboek. Dedup gebeurt op receiptID (= onze verkoop-id), dus
//  opnieuw versturen is veilig (Scrada werkt het ticket bij i.p.v. te dubbelen).
//
//  Configuratie via omgevingsvariabelen op de server (nooit in de code):
//    SCRADA_API_KEY / SCRADA_API_PASSWORD  -> headers X-API-KEY / X-PASSWORD
//                                            (Scrada: Settings > API Keys)
//    SCRADA_COMPANY_ID                     -> uuid van de onderneming in Scrada
//    SCRADA_BASE_URL                       -> https://apitest.scrada.be (test)
//                                            of https://api.scrada.be (live)
//  Ontbreekt er iets -> testmodus (dry-run): payload wordt getoond, niets verstuurd.
// ---------------------------------------------------------------------------

// Scrada POS-receipt (exact het formaat van de API).
type PosReceiptLine = {
  lineID: string;
  quantity: number;          // max. 4 decimalen
  unitType: number;          // 2 = stuk, 202 = kilogram
  itemInclVat: number;       // prijs per eenheid incl. BTW (max. 4 decimalen)
  vatType: number;           // 1 = standaardtarief, 2 = nultarief (0%)
  vatPercentage: number;
  totalInclVat: number;      // = quantity * itemInclVat (max. 2 decimalen)
  itemType: number;          // 1 = product, 2 = waardebon (cadeaubon)
  itemID: string | null;
  itemCode: string | null;
  itemName: string | null;
  groupName: string | null;
};
type PosReceiptPayment = {
  paymentID: string;
  paymentDateTime: string;
  type: 1 | 2;               // 1 = betaling door de klant
  amount: number;
  paymentMethodID: string;
  paymentMethodType: number; // 1 ander, 2 cash, 4 overschrijving, 5 debetkaart, 6 kredietkaart, 7 cadeaubon
  paymentMethodName: string;
};
type PosReceipt = {
  receiptID: string;
  number: string;
  receiptCreatedOn: string;
  receiptFinalizedOn: string;
  locationName: string | null;
  registerName: string | null;
  customer: { customerID: string; name: string; vatNumber: string | null; email: string | null } | null;
  note: string | null;
  totalInclVat: number;
  lines: PosReceiptLine[];
  payments: PosReceiptPayment[];
};

// Leesbare samenvatting voor het scherm Boekhouding (+ het exacte Scrada-ticket).
export type ScradaFactuur = {
  type: 'peppol_factuur' | 'kasticket';
  ticketRef: string;
  datum: string;
  onderneming: { naam: string; ondernemingsnummer: string; btwNummer: string | null };
  klant: { naam: string; btwNummer: string | null; email: string | null; adres: string | null } | null;
  kanaal: string;
  betaalwijze: string | null;
  lijnen: { omschrijving: string; aantal: number; eenheidsprijsInclBtw: number; btwPercentage: number; btwBedrag: number; totaalInclBtw: number }[];
  btwPerTarief: { percentage: number; maatstaf: number; btw: number }[];
  totaalExclBtw: number;
  totaalBtw: number;
  totaalInclBtw: number;
  scrada: PosReceipt;
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;

// Tijdstip (Europe/Brussels) van de dagelijkse automatische synchronisatie.
export const SYNC_UUR = '23:59';

// Nette naam + Scrada-type per betaalwijze.
const BETAALWIJZE: Record<string, { naam: string; type: number }> = {
  CASH: { naam: 'Cash', type: 2 },
  BANCONTACT: { naam: 'Bancontact', type: 5 },
  KAART: { naam: 'Kaart', type: 5 },
  OVERSCHRIJVING: { naam: 'Overschrijving', type: 4 },
  ONLINE: { naam: 'Online', type: 6 },
  QR: { naam: 'QR-code', type: 1 },
  CADEAUBON: { naam: 'Cadeaubon', type: 7 },
  EIGEN_REKENING: { naam: 'Eigen rekening', type: 1 },
};

const VERKOOP_INCLUDE = {
  onderneming: true,
  klant: true,
  lijnen: { include: { product: true } },
  betalingen: true,
  rekeningBedrijf: true,
  rekeningLid: true,
  locatie: true,
} as const;
type VerkoopScrada = Prisma.VerkoopGetPayload<{ include: typeof VERKOOP_INCLUDE }>;

@Injectable()
export class ScradaService {
  constructor(private prisma: PrismaService) {}

  // --- configuratie ---------------------------------------------------------

  // Configuratie + HTTP-headers (ook gebruikt door de dagontvangsten-service).
  config() {
    const key = process.env.SCRADA_API_KEY;
    const wachtwoord = process.env.SCRADA_API_PASSWORD;
    const company = process.env.SCRADA_COMPANY_ID;
    const base = (process.env.SCRADA_BASE_URL || 'https://api.scrada.be').replace(/\/$/, '');
    if (!key || !wachtwoord || !company) return null;
    return { key, wachtwoord, company, base };
  }
  private get live() { return this.config() !== null; }

  // Welke instellingen aanwezig zijn (voor het scherm; nooit de waarden zelf).
  private geconfigureerd() {
    return {
      sleutel: !!process.env.SCRADA_API_KEY,
      wachtwoord: !!process.env.SCRADA_API_PASSWORD,
      bedrijf: !!process.env.SCRADA_COMPANY_ID,
      basis: (process.env.SCRADA_BASE_URL || 'https://api.scrada.be').replace(/\/$/, ''),
      test: /apitest\./.test(process.env.SCRADA_BASE_URL || ''),
    };
  }

  // --- data -----------------------------------------------------------------

  // Scrada is enkel voor de WINKEL (niet de import-onderneming). "Eigen rekening"
  // (eigen gebruik) en geannuleerde tickets zijn geen ontvangsten en gaan niet mee.
  private readonly basisFilter: Prisma.VerkoopWhereInput = {
    onderneming: { isImporteur: false },
    geannuleerd: false,
    OR: [{ betaalwijze: null }, { betaalwijze: { not: Betaalwijze.EIGEN_REKENING } }],
  };

  // Startdatum: verkopen van vóór deze datum gaan NOOIT naar Scrada (die zitten
  // al in de boekhouding via de dagontvangsten van vroeger — anders dubbel
  // geboekt). Bewaard in de tabel Instelling, sleutel "scrada.vanaf" (YYYY-MM-DD).
  async vanaf(): Promise<Date | null> {
    const i = await this.prisma.instelling.findUnique({ where: { sleutel: 'scrada.vanaf' } });
    if (!i?.waarde || !/^\d{4}-\d{2}-\d{2}$/.test(i.waarde)) return null;
    return new Date(i.waarde + 'T00:00:00');
  }
  async zetVanaf(datum: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) throw new BadRequestException('Geef een datum als JJJJ-MM-DD.');
    await this.prisma.instelling.upsert({
      where: { sleutel: 'scrada.vanaf' },
      create: { sleutel: 'scrada.vanaf', waarde: datum },
      update: { waarde: datum },
    });
    return { ok: true, vanaf: datum };
  }
  // Het volledige filter: basis + startdatum (zonder startdatum: niets komt in aanmerking
  // voor "alles versturen"; één ticket expliciet versturen blijft mogelijk om te testen).
  private async teVersturen(): Promise<Prisma.VerkoopWhereInput> {
    const v = await this.vanaf();
    return { ...this.basisFilter, ...(v ? { datum: { gte: v } } : {}) };
  }

  // Na het testen (testomgeving) en vóór live: zet de verzendstatus van de
  // verkopen vanaf de startdatum terug op "niet verstuurd", zodat ze naar de
  // echte Scrada gaan. Oudere verkopen blijven onaangeroerd.
  async resetStatus() {
    const v = await this.vanaf();
    if (!v) throw new BadRequestException('Stel eerst de startdatum in.');
    const r = await this.prisma.verkoop.updateMany({
      where: { ...this.basisFilter, datum: { gte: v }, scradaStatus: { in: ['VERSTUURD', 'FOUT'] } },
      data: { scradaStatus: 'NIET_VERSTUURD', scradaRef: null },
    });
    return { ok: true, aantal: r.count };
  }

  private verkoopMet(id: string) {
    return this.prisma.verkoop.findUnique({ where: { id }, include: VERKOOP_INCLUDE });
  }

  // Bouwt het Scrada POS-ticket + een leesbare samenvatting (verstuurt niets).
  private bouw(v: VerkoopScrada): ScradaFactuur {
    const perTarief = new Map<string, { percentage: number; maatstaf: number; btw: number }>();
    const datum = v.datum.toISOString();

    const lines: PosReceiptLine[] = [];
    const lijnen = v.lijnen.map((l) => {
      const pct = Number(l.btwPercentage);
      const aantal = Number(l.aantal);
      const totaalIncl = l.lijnTotaal != null ? Number(l.lijnTotaal) : r2(Number(l.eenheidsprijs) * aantal);
      const btw = Number(l.btwBedrag);
      const key = pct.toFixed(2);
      const rij = perTarief.get(key) ?? { percentage: pct, maatstaf: 0, btw: 0 };
      rij.maatstaf += totaalIncl - btw;
      rij.btw += btw;
      perTarief.set(key, rij);
      const isKg = l.product.eenheid === 'KG';
      lines.push({
        lineID: l.id,
        quantity: r4(aantal),
        unitType: isKg ? 202 : 2,
        // per-eenheid-prijs zó dat quantity * itemInclVat exact het aangerekende lijntotaal is
        itemInclVat: aantal !== 0 ? r4(totaalIncl / aantal) : Number(l.eenheidsprijs),
        vatType: pct === 0 ? 2 : 1,
        vatPercentage: pct,
        totalInclVat: r2(totaalIncl),
        itemType: l.product.interneCode === 'CADEAU' ? 2 : 1,
        itemID: l.productId,
        itemCode: l.product.barcode ?? l.product.interneCode ?? null,
        itemName: l.product.naam,
        groupName: null,
      });
      return {
        omschrijving: l.product.naam,
        aantal,
        eenheidsprijsInclBtw: Number(l.eenheidsprijs),
        btwPercentage: pct,
        btwBedrag: r2(btw),
        totaalInclBtw: r2(totaalIncl),
      };
    });

    // Betalingen: gesplitste betaling (Betaling-rijen) of één betaling met de
    // betaalwijze; "op rekening" heeft geen betaling maar wel een klant (bedrijf).
    const payments: PosReceiptPayment[] = [];
    const deel = v.betalingen.length
      ? v.betalingen.map((b) => ({ id: b.id, bw: b.betaalwijze as string, bedrag: Number(b.bedrag) }))
      : v.betaalwijze ? [{ id: v.id + '-1', bw: v.betaalwijze as string, bedrag: Number(v.totaal) }] : [];
    for (const d of deel) {
      const info = BETAALWIJZE[d.bw] ?? { naam: d.bw, type: 1 };
      payments.push({
        paymentID: d.id, paymentDateTime: datum, type: 1, amount: r2(d.bedrag),
        paymentMethodID: d.bw, paymentMethodType: info.type, paymentMethodName: info.naam,
      });
    }

    const bedrijf = v.rekeningBedrijf;
    const klant = bedrijf
      ? { naam: bedrijf.naam, btwNummer: bedrijf.btwNummer ?? null, email: bedrijf.email ?? null, adres: bedrijf.adres ?? null }
      : v.klant
        ? { naam: v.klant.naam, btwNummer: v.klant.btwNummer, email: v.klant.email, adres: v.klant.adres }
        : null;

    const btwPerTarief = [...perTarief.values()]
      .sort((a, b) => a.percentage - b.percentage)
      .map((t) => ({ percentage: t.percentage, maatstaf: r2(t.maatstaf), btw: r2(t.btw) }));
    const totaalIncl = Number(v.totaal);
    const totaalBtw = r2(btwPerTarief.reduce((s, t) => s + t.btw, 0));

    const scrada: PosReceipt = {
      receiptID: v.id,
      number: v.id.slice(-8).toUpperCase(),
      receiptCreatedOn: datum,
      receiptFinalizedOn: datum,
      locationName: v.locatie?.naam ?? null,
      registerName: v.kanaal === 'WEBSHOP' ? 'Webshop' : 'Kassa',
      customer: bedrijf
        ? { customerID: bedrijf.id, name: bedrijf.naam, vatNumber: bedrijf.btwNummer ?? null, email: bedrijf.email ?? null }
        : v.klant
          ? { customerID: v.klant.id, name: v.klant.naam, vatNumber: v.klant.btwNummer, email: v.klant.email }
          : null,
      note: bedrijf ? `Op rekening${v.rekeningLid ? ` — ${v.rekeningLid.naam}` : ''}` : null,
      totalInclVat: r2(totaalIncl),
      lines,
      payments,
    };

    return {
      type: klant?.btwNummer ? 'peppol_factuur' : 'kasticket',
      ticketRef: v.id,
      datum,
      onderneming: { naam: v.onderneming.naam, ondernemingsnummer: v.onderneming.ondernemingsnummer, btwNummer: v.onderneming.btwNummer },
      klant,
      kanaal: v.kanaal,
      betaalwijze: v.betaalwijze,
      lijnen,
      btwPerTarief,
      totaalExclBtw: r2(totaalIncl - totaalBtw),
      totaalBtw,
      totaalInclBtw: r2(totaalIncl),
      scrada,
    };
  }

  async bouwPayload(verkoopId: string): Promise<ScradaFactuur> {
    const v = await this.verkoopMet(verkoopId);
    if (!v) throw new NotFoundException('Verkoop niet gevonden.');
    return this.bouw(v);
  }

  // --- versturen --------------------------------------------------------------

  // Eén verkoop versturen. Zonder configuratie = testmodus (dry-run).
  async verstuur(verkoopId: string) {
    const v = await this.verkoopMet(verkoopId);
    if (!v) throw new NotFoundException('Verkoop niet gevonden.');
    const payload = this.bouw(v);
    if (!this.live) return { modus: 'test' as const, verstuurd: false, payload };
    try {
      const [ref] = await this.postReceipts([payload.scrada]);
      await this.prisma.verkoop.update({ where: { id: verkoopId }, data: { scradaStatus: 'VERSTUURD', scradaRef: ref ?? 'verstuurd' } });
      return { modus: 'live' as const, verstuurd: true, scradaRef: ref, payload };
    } catch (e) {
      await this.prisma.verkoop.update({ where: { id: verkoopId }, data: { scradaStatus: 'FOUT' } });
      return { modus: 'live' as const, verstuurd: false, fout: e instanceof Error ? e.message : 'onbekende fout', payload };
    }
  }

  // Alle nog niet-verstuurde verkopen VANAF de startdatum, in batches (dedup op
  // receiptID = veilig). Zonder startdatum wordt geweigerd: anders zou het hele
  // verleden meegaan en dubbel in de boekhouding komen.
  async verstuurOpenstaande(max = 500) {
    if (!(await this.vanaf())) {
      return { modus: this.live ? ('live' as const) : ('test' as const), geweigerd: true, gevonden: 0, verstuurd: 0, mislukt: 0, melding: 'Stel eerst de startdatum in (enkel verkopen vanaf die datum gaan naar Scrada).' };
    }
    const open = await this.prisma.verkoop.findMany({
      where: { scradaStatus: { in: ['NIET_VERSTUURD', 'FOUT'] }, ...(await this.teVersturen()) },
      orderBy: { datum: 'asc' },
      take: max,
      include: VERKOOP_INCLUDE,
    });
    if (!this.live) return { modus: 'test' as const, gevonden: open.length, verstuurd: 0, mislukt: 0 };
    let verstuurd = 0;
    let mislukt = 0;
    let fout: string | undefined;
    for (let i = 0; i < open.length; i += 50) {
      const batch = open.slice(i, i + 50);
      try {
        const refs = await this.postReceipts(batch.map((v) => this.bouw(v).scrada));
        await this.prisma.$transaction(batch.map((v, j) =>
          this.prisma.verkoop.update({ where: { id: v.id }, data: { scradaStatus: 'VERSTUURD', scradaRef: refs[j] ?? 'verstuurd' } }),
        ));
        verstuurd += batch.length;
      } catch (e) {
        fout = e instanceof Error ? e.message : 'onbekende fout';
        await this.prisma.verkoop.updateMany({ where: { id: { in: batch.map((v) => v.id) } }, data: { scradaStatus: 'FOUT' } });
        mislukt += batch.length;
      }
    }
    return { modus: 'live' as const, gevonden: open.length, verstuurd, mislukt, fout };
  }

  async status() {
    const v = await this.vanaf();
    const filter = await this.teVersturen();
    const [groepen, overgeslagen, laatste] = await Promise.all([
      this.prisma.verkoop.groupBy({ by: ['scradaStatus'], where: filter, _count: { _all: true } }),
      // verkopen van vóór de startdatum die nooit verstuurd worden (informatief)
      v ? this.prisma.verkoop.count({ where: { ...this.basisFilter, datum: { lt: v }, scradaStatus: { in: ['NIET_VERSTUURD', 'FOUT'] } } }) : Promise.resolve(0),
      this.prisma.instelling.findUnique({ where: { sleutel: 'scrada.laatsteSync' } }),
    ]);
    const tel: Record<string, number> = { NIET_VERSTUURD: 0, VERSTUURD: 0, FOUT: 0 };
    for (const g of groepen) tel[g.scradaStatus] = g._count._all;
    let laatsteSync: Record<string, unknown> | null = null;
    try { laatsteSync = laatste?.waarde ? JSON.parse(laatste.waarde) : null; } catch { laatsteSync = null; }
    return {
      modus: this.live ? 'live' : 'test',
      geconfigureerd: this.geconfigureerd(),
      vanaf: v ? v.toISOString().slice(0, 10) : null,
      overgeslagen,
      autoSync: SYNC_UUR, // dagelijkse automatische synchronisatie (Europe/Brussels)
      laatsteSync,
      ...tel,
    };
  }

  async openstaande() {
    return this.prisma.verkoop.findMany({
      where: { scradaStatus: { in: ['NIET_VERSTUURD', 'FOUT'] }, ...(await this.teVersturen()) },
      orderBy: { datum: 'desc' },
      take: 100,
      include: { klant: true },
    });
  }

  // Verbinding testen: haalt de onderneming op in Scrada (GET /v1/company/{id}).
  async verbinding() {
    const c = this.config();
    if (!c) return { ok: false, modus: 'test', geconfigureerd: this.geconfigureerd(), melding: 'Nog niet geconfigureerd (API-sleutel, wachtwoord en/of bedrijfs-ID ontbreken).' };
    try {
      const res = await fetch(`${c.base}/v1/company/${c.company}`, { headers: this.headers(c) });
      const tekst = await res.text().catch(() => '');
      if (!res.ok) return { ok: false, modus: 'live', geconfigureerd: this.geconfigureerd(), status: res.status, melding: res.status === 401 ? 'Scrada weigert de API-sleutel en/of het wachtwoord (401).' : `Scrada gaf HTTP ${res.status}: ${tekst.slice(0, 200)}` };
      let naam: string | null = null;
      try { const d = JSON.parse(tekst); naam = d?.name ?? d?.companyName ?? null; } catch { /* geen JSON */ }
      return { ok: true, modus: 'live', geconfigureerd: this.geconfigureerd(), status: res.status, bedrijf: naam };
    } catch (e) {
      return { ok: false, modus: 'live', geconfigureerd: this.geconfigureerd(), melding: e instanceof Error ? e.message : 'onbekende fout' };
    }
  }

  // --- HTTP -------------------------------------------------------------------

  headers(c: { key: string; wachtwoord: string }) {
    return { 'Content-Type': 'application/json', 'X-API-KEY': c.key, 'X-PASSWORD': c.wachtwoord, Language: 'nl' };
  }

  // De enige echte Scrada-call: POS-tickets in batch. Antwoord = interne ids
  // (zelfde volgorde als de input).
  private async postReceipts(receipts: PosReceipt[]): Promise<string[]> {
    const c = this.config();
    if (!c) throw new Error('Scrada is niet geconfigureerd.');
    const res = await fetch(`${c.base}/v1/company/${c.company}/pos/receipts`, {
      method: 'POST',
      headers: this.headers(c),
      body: JSON.stringify(receipts),
    });
    if (!res.ok) {
      const tekst = await res.text().catch(() => '');
      throw new Error(`Scrada gaf HTTP ${res.status}: ${tekst.slice(0, 300)}`);
    }
    const data: unknown = await res.json().catch(() => []);
    return Array.isArray(data) ? data.map((x) => String(x)) : [];
  }
}
