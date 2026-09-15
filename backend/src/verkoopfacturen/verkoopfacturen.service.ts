import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ScradaService } from '../scrada/scrada.service';
import { ScradaDagboekService } from '../scrada/scrada.dagboek.service';

// ---------------------------------------------------------------------------
//  Verkoopfacturen uit de kassa.
//   - TICKET: klant vraagt aan de kassa een factuur (klant met BTW-nr) -> één
//     factuur per ticket; betaalstatus = betaald (aan de kassa) of openstaand.
//   - MAANDFACTUUR: "op rekening" -> één factuur per bedrijf per maand (alle
//     openstaande tickets als lijnen); betaalstatus openstaand tot gemarkeerd.
//  Naar Scrada: POST /v1/company/{id}/salesInvoice in het aparte verkoopdagboek
//  (ApiInvoiceStatus = concept in Scrada => klaar ter nazicht, verzending via
//  Peppol vanuit Scrada). Omdat die omzet al in het dagontvangstenboek zit,
//  boekt de kassa daarna een CORRECTIE (lijntype 3, negatief per BTW-tarief,
//  met factuurnummer en oorspronkelijke datum) — de procedure van Scrada zelf.
// ---------------------------------------------------------------------------

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;
const BTW_TYPE_BE: Record<string, string> = {
  '0': 'cbff0b5e-96e3-4201-91d0-51304cee2605',
  '6': '7befe0fc-7131-4b15-9fe6-ca4b9280b63c',
  '12': '647ed17b-fb6f-4772-baf5-928de98f4db1',
  '21': '8424d909-78b9-483c-9b1d-4584fb537846',
};
const SLEUTEL = 'factuur.instellingen';

export type FactuurInstellingen = { prefix: string; verkoopdagboek: string; vervaldagen: number };
export type FactuurLijn = {
  datum: string; verkoopId: string; omschrijving: string; lid?: string | null;
  aantal: number; kg: boolean; eenheidsprijsIncl: number; btwPct: number; btwBedrag: number; totaalIncl: number;
};
export type PerBtw = { percentage: number; excl: number; btw: number; incl: number };

function brusselDatum(d: Date): string {
  const p = new Intl.DateTimeFormat('nl-BE', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')}`;
}

const VERKOOP_INCLUDE = {
  lijnen: { include: { product: true } },
  klant: true,
  rekeningBedrijf: true,
  rekeningLid: true,
  betalingen: true,
} as const;
type VerkoopVol = Prisma.VerkoopGetPayload<{ include: typeof VERKOOP_INCLUDE }>;

@Injectable()
export class VerkoopfacturenService {
  private readonly log = new Logger(VerkoopfacturenService.name);
  constructor(private prisma: PrismaService, private scrada: ScradaService, private dagboek: ScradaDagboekService) {}

  // --- instellingen -----------------------------------------------------------

  // Nummering: <prefix><jaar><volgnummer 4 cijfers>, bv. 20260001 (zonder prefix).
  private reeksSleutel(jaar: string) { return `factuur.reeks.${jaar}`; }
  private huidigJaar() { return brusselDatum(new Date()).slice(0, 4); }

  async instellingen(): Promise<FactuurInstellingen & { jaar: string; volgend: number; voorbeeld: string }> {
    const basis: FactuurInstellingen = { prefix: '', verkoopdagboek: 'KASSA', vervaldagen: 30 };
    const i = await this.prisma.instelling.findUnique({ where: { sleutel: SLEUTEL } });
    let inst = basis;
    if (i?.waarde) { try { inst = { ...basis, ...JSON.parse(i.waarde) }; } catch { inst = basis; } }
    const jaar = this.huidigJaar();
    const reeks = await this.prisma.instelling.findUnique({ where: { sleutel: this.reeksSleutel(jaar) } });
    const volgend = (Number(reeks?.waarde ?? 0) || 0) + 1;
    return { ...inst, jaar, volgend, voorbeeld: `${inst.prefix}${jaar}${String(volgend).padStart(4, '0')}` };
  }
  // volgendeVolgnummer: het eerstvolgende volgnummer voor dit jaar (bv. 1 -> 20260001).
  async zetInstellingen(input: Partial<FactuurInstellingen> & { volgendeVolgnummer?: number }) {
    const huidig = await this.instellingen();
    const nieuw: FactuurInstellingen = {
      prefix: (input.prefix ?? huidig.prefix).trim(),
      verkoopdagboek: (input.verkoopdagboek ?? huidig.verkoopdagboek).trim(),
      vervaldagen: Math.max(0, Math.round(Number(input.vervaldagen ?? huidig.vervaldagen) || 30)),
    };
    await this.prisma.instelling.upsert({ where: { sleutel: SLEUTEL }, create: { sleutel: SLEUTEL, waarde: JSON.stringify(nieuw) }, update: { waarde: JSON.stringify(nieuw) } });
    if (input.volgendeVolgnummer != null) {
      const n = Math.max(1, Math.round(Number(input.volgendeVolgnummer) || 1));
      const sleutel = this.reeksSleutel(huidig.jaar);
      await this.prisma.instelling.upsert({ where: { sleutel }, create: { sleutel, waarde: String(n - 1) }, update: { waarde: String(n - 1) } });
    }
    return this.instellingen();
  }

  // Doorlopende nummering per boekjaar (teller in Instelling "factuur.reeks.<jaar>").
  private async volgendNummer(jaar: string): Promise<string> {
    const inst = await this.instellingen();
    const sleutel = this.reeksSleutel(jaar);
    return this.prisma.$transaction(async (tx) => {
      const huidig = await tx.instelling.findUnique({ where: { sleutel } });
      const n = (Number(huidig?.waarde ?? 0) || 0) + 1;
      await tx.instelling.upsert({ where: { sleutel }, create: { sleutel, waarde: String(n) }, update: { waarde: String(n) } });
      return `${inst.prefix}${jaar}${String(n).padStart(4, '0')}`;
    });
  }

  // --- opbouw -------------------------------------------------------------------

  private lijnenVan(verkopen: VerkoopVol[]): FactuurLijn[] {
    const uit: FactuurLijn[] = [];
    for (const v of verkopen) {
      const datum = brusselDatum(v.datum);
      for (const l of v.lijnen) {
        const aantal = Number(l.aantal);
        const totaalIncl = l.lijnTotaal != null ? Number(l.lijnTotaal) : r2(Number(l.eenheidsprijs) * aantal);
        uit.push({
          datum, verkoopId: v.id, omschrijving: l.product.naam, lid: v.rekeningLid?.naam ?? null,
          aantal: r4(aantal), kg: l.product.eenheid === 'KG',
          eenheidsprijsIncl: aantal !== 0 ? r4(totaalIncl / aantal) : Number(l.eenheidsprijs),
          btwPct: Number(l.btwPercentage), btwBedrag: r2(Number(l.btwBedrag)), totaalIncl: r2(totaalIncl),
        });
      }
    }
    return uit;
  }
  private perBtwVan(lijnen: FactuurLijn[]): PerBtw[] {
    const m = new Map<number, PerBtw>();
    for (const l of lijnen) {
      const p = m.get(l.btwPct) ?? { percentage: l.btwPct, excl: 0, btw: 0, incl: 0 };
      p.incl += l.totaalIncl; p.btw += l.btwBedrag;
      m.set(l.btwPct, p);
    }
    return [...m.values()].sort((a, b) => a.percentage - b.percentage)
      .map((p) => ({ percentage: p.percentage, incl: r2(p.incl), btw: r2(p.btw), excl: r2(p.incl - p.btw) }));
  }
  private klantVan(v: VerkoopVol) {
    const b = v.rekeningBedrijf;
    if (b) return { naam: b.naam, btw: b.btwNummer ?? null, email: b.email ?? null, adres: b.adres ?? null, klantId: v.klantId ?? null, bedrijfId: b.id };
    if (v.klant) return { naam: v.klant.naam, btw: v.klant.btwNummer ?? null, email: v.klant.email ?? null, adres: v.klant.adres ?? null, klantId: v.klant.id, bedrijfId: null };
    return null;
  }

  // Factuur voor één ticket (klant aan de kassa gekozen). Al gefactureerd -> bestaande.
  async maakVoorVerkoop(verkoopId: string) {
    const v = await this.prisma.verkoop.findUnique({ where: { id: verkoopId }, include: VERKOOP_INCLUDE });
    if (!v) throw new NotFoundException('Verkoop niet gevonden.');
    if (v.factuurId) return this.prisma.verkoopfactuur.findUnique({ where: { id: v.factuurId } });
    if (v.geannuleerd) throw new BadRequestException('Een geannuleerde verkoop kan niet gefactureerd worden.');
    const klant = this.klantVan(v);
    if (!klant) throw new BadRequestException('Geen klant (met BTW-nummer) gekoppeld aan deze verkoop.');
    const lijnen = this.lijnenVan([v]);
    const perBtw = this.perBtwVan(lijnen);
    const jaar = brusselDatum(new Date()).slice(0, 4);
    const inst = await this.instellingen();
    // Betaald = effectief aan de kassa betaald (ook gesplitst). "Overschrijving"
    // (betaalt later) of "op rekening" = openstaand tot de beheerder het markeert.
    const NU_BETAALD = new Set(['CASH', 'BANCONTACT', 'KAART', 'QR', 'CADEAUBON', 'ONLINE']);
    const wijzen = v.betalingen.length ? v.betalingen.map((b) => String(b.betaalwijze)) : v.betaalwijze ? [String(v.betaalwijze)] : [];
    const betaald = wijzen.length > 0 && wijzen.every((w) => NU_BETAALD.has(w));
    const betaalwijze = wijzen.join('+') || null;
    const nummer = await this.volgendNummer(jaar);
    const f = await this.prisma.verkoopfactuur.create({
      data: {
        nummer, boekjaar: jaar, bron: 'TICKET',
        vervaldatum: new Date(Date.now() + inst.vervaldagen * 86400000),
        klantNaam: klant.naam, klantBtw: klant.btw, klantEmail: klant.email, klantAdres: klant.adres,
        klantId: klant.klantId, rekeningBedrijfId: klant.bedrijfId,
        totaalExcl: new Prisma.Decimal(r2(perBtw.reduce((s, p) => s + p.excl, 0))),
        totaalBtw: new Prisma.Decimal(r2(perBtw.reduce((s, p) => s + p.btw, 0))),
        totaalIncl: new Prisma.Decimal(r2(perBtw.reduce((s, p) => s + p.incl, 0))),
        perBtw: perBtw as unknown as Prisma.InputJsonValue,
        lijnen: lijnen as unknown as Prisma.InputJsonValue,
        betaalstatus: betaald ? 'BETAALD' : 'OPENSTAAND',
        betaaldOp: betaald ? v.datum : null,
        betaalwijze: betaald ? (betaalwijze as string) : null,
        verkopen: { connect: { id: v.id } },
      },
    });
    await this.prisma.verkoop.update({ where: { id: v.id }, data: { factuurGewenst: true, gefactureerd: true, gefactureerdOp: new Date() } });
    return f;
  }

  // Maandfactuur: alle openstaande "op rekening"-tickets van een bedrijf in één factuur.
  async maakMaandfactuur(bedrijfId: string) {
    const verkopen = await this.prisma.verkoop.findMany({
      where: { rekeningBedrijfId: bedrijfId, gefactureerd: false, geannuleerd: false, factuurId: null },
      include: VERKOOP_INCLUDE,
      orderBy: { datum: 'asc' },
    });
    if (!verkopen.length) throw new BadRequestException('Geen openstaande verkopen op rekening voor dit bedrijf.');
    const klant = this.klantVan(verkopen[0]);
    if (!klant) throw new BadRequestException('Bedrijf niet gevonden.');
    const lijnen = this.lijnenVan(verkopen);
    const perBtw = this.perBtwVan(lijnen);
    const laatste = verkopen[verkopen.length - 1].datum;
    const jaar = brusselDatum(new Date()).slice(0, 4);
    const inst = await this.instellingen();
    const nummer = await this.volgendNummer(jaar);
    const f = await this.prisma.verkoopfactuur.create({
      data: {
        nummer, boekjaar: jaar, bron: 'MAANDFACTUUR', periode: brusselDatum(laatste).slice(0, 7),
        vervaldatum: new Date(Date.now() + inst.vervaldagen * 86400000),
        klantNaam: klant.naam, klantBtw: klant.btw, klantEmail: klant.email, klantAdres: klant.adres,
        rekeningBedrijfId: bedrijfId,
        totaalExcl: new Prisma.Decimal(r2(perBtw.reduce((s, p) => s + p.excl, 0))),
        totaalBtw: new Prisma.Decimal(r2(perBtw.reduce((s, p) => s + p.btw, 0))),
        totaalIncl: new Prisma.Decimal(r2(perBtw.reduce((s, p) => s + p.incl, 0))),
        perBtw: perBtw as unknown as Prisma.InputJsonValue,
        lijnen: lijnen as unknown as Prisma.InputJsonValue,
        betaalstatus: 'OPENSTAAND',
        verkopen: { connect: verkopen.map((v) => ({ id: v.id })) },
      },
    });
    await this.prisma.verkoop.updateMany({ where: { id: { in: verkopen.map((v) => v.id) } }, data: { gefactureerd: true, gefactureerdOp: new Date() } });
    return { factuur: f, aantal: verkopen.length, totaal: Number(f.totaalIncl) };
  }

  // Tickets waarvoor aan de kassa een factuur gevraagd werd en die nog geen factuur hebben.
  async maakTicketFacturen() {
    const open = await this.prisma.verkoop.findMany({ where: { factuurGewenst: true, factuurId: null, geannuleerd: false }, select: { id: true } });
    let n = 0;
    for (const { id } of open) { try { await this.maakVoorVerkoop(id); n++; } catch (e) { this.log.warn(`Ticketfactuur ${id}: ${e instanceof Error ? e.message : e}`); } }
    return n;
  }

  // --- lijst / status ---------------------------------------------------------------

  async lijst() {
    // Tickets met "factuur gewenst" die (bv. door een fout) nog geen factuur kregen, alsnog aanmaken.
    await this.maakTicketFacturen();
    const rows = await this.prisma.verkoopfactuur.findMany({ orderBy: { datum: 'desc' }, take: 200, include: { _count: { select: { verkopen: true } } } });
    return rows.map((f) => ({
      id: f.id, nummer: f.nummer, datum: f.datum, vervaldatum: f.vervaldatum, bron: f.bron, periode: f.periode,
      klantNaam: f.klantNaam, klantBtw: f.klantBtw, totaalExcl: Number(f.totaalExcl), totaalBtw: Number(f.totaalBtw), totaalIncl: Number(f.totaalIncl),
      betaalstatus: f.betaalstatus, betaaldOp: f.betaaldOp, betaalwijze: f.betaalwijze,
      scradaStatus: f.scradaStatus, scradaRef: f.scradaRef, scradaVerstuurdOp: f.scradaVerstuurdOp, scradaFout: f.scradaFout,
      correctieStatus: f.correctieStatus, correctieFout: f.correctieFout, aantalTickets: f._count.verkopen,
    }));
  }
  async detail(id: string) {
    const f = await this.prisma.verkoopfactuur.findUnique({ where: { id }, include: { verkopen: { select: { id: true, datum: true, totaal: true } } } });
    if (!f) throw new NotFoundException('Factuur niet gevonden.');
    const inst = await this.instellingen();
    return { ...f, totaalExcl: Number(f.totaalExcl), totaalBtw: Number(f.totaalBtw), totaalIncl: Number(f.totaalIncl), scrada: this.bouwScrada(f, inst) };
  }
  async markeerBetaald(id: string, betaalwijze?: string, betaald = true) {
    const f = await this.prisma.verkoopfactuur.findUnique({ where: { id } });
    if (!f) throw new NotFoundException('Factuur niet gevonden.');
    return this.prisma.verkoopfactuur.update({
      where: { id },
      data: betaald ? { betaalstatus: 'BETAALD', betaaldOp: new Date(), betaalwijze: betaalwijze ?? f.betaalwijze ?? 'OVERSCHRIJVING' } : { betaalstatus: 'OPENSTAAND', betaaldOp: null, betaalwijze: null },
    });
  }
  async overzicht() {
    const [open, gefactureerdOnbetaald, teVersturen, tickets] = await Promise.all([
      this.prisma.verkoopfactuur.count({ where: { betaalstatus: 'OPENSTAAND' } }),
      this.prisma.verkoopfactuur.aggregate({ _sum: { totaalIncl: true }, where: { betaalstatus: 'OPENSTAAND' } }),
      this.prisma.verkoopfactuur.count({ where: { scradaStatus: { in: ['NIET_VERSTUURD', 'FOUT'] } } }),
      this.prisma.verkoop.count({ where: { factuurGewenst: true, factuurId: null, geannuleerd: false } }),
    ]);
    return { openstaand: open, openstaandBedrag: Number(gefactureerdOnbetaald._sum.totaalIncl ?? 0), teVersturen, ticketsZonderFactuur: tickets };
  }

  // --- Scrada: factuur (concept) --------------------------------------------------------

  private bouwScrada(f: { nummer: string; boekjaar: string; datum: Date; vervaldatum: Date | null; klantNaam: string; klantBtw: string | null; klantEmail: string | null; klantAdres: string | null; totaalExcl: Prisma.Decimal | number; totaalBtw: Prisma.Decimal | number; totaalIncl: Prisma.Decimal | number; perBtw: unknown; lijnen: unknown; bron: string; periode: string | null; id: string; betaalstatus: string; betaalwijze: string | null }, inst: FactuurInstellingen) {
    const lijnen = (f.lijnen as FactuurLijn[]) ?? [];
    const perBtw = (f.perBtw as PerBtw[]) ?? [];
    return {
      bookYear: f.boekjaar,
      journal: inst.verkoopdagboek,
      number: f.nummer,
      externalReference: f.id,
      isInclVat: true,
      invoiceDate: brusselDatum(f.datum),
      invoiceExpiryDate: f.vervaldatum ? brusselDatum(f.vervaldatum) : undefined,
      alreadySendToCustomer: false, // Scrada verstuurt (na nazicht) via Peppol
      customer: {
        name: f.klantNaam,
        vatNumber: f.klantBtw ?? undefined,
        email: f.klantEmail ?? undefined,
        invoiceEmail: f.klantEmail ?? undefined,
        address: f.klantAdres ? { street: f.klantAdres, countryCode: 'BE' } : undefined,
      },
      // Informatief voor het nazicht in Scrada: betaald aan de kassa (en hoe) of nog te betalen.
      note: (f.bron === 'MAANDFACTUUR'
        ? `Maandfactuur kassa Marché — aankopen op rekening ${f.periode ?? ''}`.trim()
        : 'Factuur kassa Marché — kasticket')
        + (f.betaalstatus === 'BETAALD' ? ` · betaald aan de kassa (${f.betaalwijze ?? 'betaald'})` : ' · nog te betalen'),
      totalExclVat: r2(Number(f.totaalExcl)),
      totalVat: r2(Number(f.totaalBtw)),
      totalInclVat: r2(Number(f.totaalIncl)),
      lines: lijnen.map((l, i) => ({
        lineNumber: i + 1,
        itemName: `${l.datum} ${l.lid ? l.lid + ' — ' : ''}${l.omschrijving}`,
        quantity: l.aantal,
        unitType: l.kg ? 202 : 2,
        itemInclVat: l.eenheidsprijsIncl,
        vatType: l.btwPct === 0 ? 2 : 1,
        vatPercentage: l.btwPct,
        totalInclVat: l.totaalIncl,
      })),
      vatTotals: perBtw.map((p) => ({ vatType: p.percentage === 0 ? 2 : 1, vatPercentage: p.percentage, totalExclVat: p.excl, totalVat: p.btw, totalInclVat: p.incl })),
    };
  }

  async verstuurNaarScrada(id: string) {
    const f = await this.prisma.verkoopfactuur.findUnique({ where: { id } });
    if (!f) throw new NotFoundException('Factuur niet gevonden.');
    if (f.scradaStatus === 'VERSTUURD') return { verstuurd: false, melding: 'Deze factuur staat al in Scrada.', ref: f.scradaRef, correctie: await this.verstuurCorrectie(id) };
    const inst = await this.instellingen();
    const payload = this.bouwScrada(f, inst);
    const c = this.scrada.config();
    if (!c) return { verstuurd: false, modus: 'test', payload };
    try {
      const res = await fetch(`${c.base}/v1/company/${c.company}/salesInvoice`, { method: 'POST', headers: this.scrada.headers(c), body: JSON.stringify(payload) });
      const tekst = await res.text().catch(() => '');
      if (!res.ok) throw new Error(`Scrada gaf HTTP ${res.status}${tekst ? ': ' + tekst.slice(0, 300) : ''}`);
      let ref: string | null = null;
      try { const d = JSON.parse(tekst); ref = typeof d === 'string' ? d : (d?.id ?? d?.invoiceID ?? null); } catch { ref = null; }
      await this.prisma.verkoopfactuur.update({ where: { id }, data: { scradaStatus: 'VERSTUURD', scradaRef: ref ?? 'verstuurd', scradaVerstuurdOp: new Date(), scradaFout: null } });
      const correctie = await this.verstuurCorrectie(id);
      return { verstuurd: true, ref, correctie };
    } catch (e) {
      const fout = e instanceof Error ? e.message : 'onbekende fout';
      await this.prisma.verkoopfactuur.update({ where: { id }, data: { scradaStatus: 'FOUT', scradaFout: fout.slice(0, 500) } });
      return { verstuurd: false, fout };
    }
  }

  // --- Scrada: correctie in het dagontvangstenboek --------------------------------------
  // Per oorspronkelijke datum een correctiegroep (lijntype 3): negatief per BTW-tarief,
  // met factuurnummer en "correctie voor datum". Enkel zodra die dag zelf in Scrada
  // staat (anders WACHT_OP_DAG en later opnieuw).
  async verstuurCorrectie(id: string) {
    const f = await this.prisma.verkoopfactuur.findUnique({ where: { id }, include: { verkopen: { select: { id: true, datum: true, betaalwijze: true, betalingen: true } } } });
    if (!f) throw new NotFoundException('Factuur niet gevonden.');
    if (f.correctieStatus === 'VERSTUURD' || f.correctieStatus === 'NIET_NODIG') return { status: f.correctieStatus };
    if (f.scradaStatus !== 'VERSTUURD') return { status: f.correctieStatus, melding: 'Eerst de factuur zelf naar Scrada.' };
    const c = this.scrada.config();
    const dag = await this.dagboek.instellingen();
    if (!c || !dag.journalID) return { status: f.correctieStatus, melding: 'Scrada/dagboek niet gekoppeld.' };

    const lijnen = (f.lijnen as FactuurLijn[]) ?? [];
    const perDatum = new Map<string, FactuurLijn[]>();
    for (const l of lijnen) perDatum.set(l.datum, [...(perDatum.get(l.datum) ?? []), l]);

    // Staan al die dagen in Scrada? (de dagafsluiting van elk betrokken ticket)
    for (const [datum, ls] of perDatum) {
      const vid = ls[0].verkoopId;
      const afsl = await this.prisma.dagafsluiting.findFirst({ where: { verkopen: { some: { id: vid } } }, select: { scradaStatus: true } });
      if (!afsl || afsl.scradaStatus !== 'VERSTUURD') {
        await this.prisma.verkoopfactuur.update({ where: { id }, data: { correctieStatus: 'WACHT_OP_DAG', correctieFout: `Dag ${datum} staat nog niet in het dagontvangstenboek.` } });
        return { status: 'WACHT_OP_DAG', melding: `Dag ${datum} staat nog niet in Scrada; de correctie volgt zodra die dag verstuurd is.` };
      }
    }

    const vandaag = brusselDatum(new Date());
    const refs: string[] = [];
    try {
      for (const [datum, ls] of perDatum) {
        const perPct = new Map<number, number>();
        for (const l of ls) perPct.set(l.btwPct, r2((perPct.get(l.btwPct) ?? 0) + l.totaalIncl));
        const lines = [...perPct.entries()].map(([pct, incl]) => {
          const sleutel = String(Math.round(pct));
          const categoryID = dag.vatMap[sleutel];
          if (!categoryID) throw new Error(`Geen Scrada BTW-categorie gekoppeld voor ${sleutel}% (Boekhouding → koppeling).`);
          return { lineType: 3, categoryID, vatTypeID: BTW_TYPE_BE[sleutel], vatPerc: pct, amount: r2(-incl), remark: `Factuur ${f.nummer} — ${f.klantNaam}`, correctionForInvoice: f.nummer, correctionForDate: datum, externalReference: `factuur:${f.id}:${datum}` };
        });
        // Betaalmethoden (negatief), zodat het kasboek/de betaalmethode in Scrada mee gecorrigeerd wordt.
        let paymentMethods: { paymentMethodID: string; amount: number; externalReference: string }[] = [];
        if (dag.betalingen) {
          const totaal = r2(ls.reduce((s, l) => s + l.totaalIncl, 0));
          const sleutel = f.bron === 'MAANDFACTUUR' ? 'OP_REKENING' : (f.verkopen.find((v) => v.id === ls[0].verkoopId)?.betaalwijze ?? 'OP_REKENING');
          const pm = dag.pmMap[sleutel] ?? dag.pmMap['OP_REKENING'];
          if (!pm) throw new Error(`Geen Scrada-betaalmethode gekoppeld voor ${sleutel} (Boekhouding → koppeling).`);
          paymentMethods = [{ paymentMethodID: pm, amount: r2(-totaal), externalReference: `factuur:${f.id}:${datum}` }];
        }
        const res = await fetch(`${c.base}/v1/company/${c.company}/journal/${dag.journalID}/lines`, {
          method: 'PUT', headers: this.scrada.headers(c), body: JSON.stringify({ date: vandaag, lines, paymentMethods }),
        });
        const tekst = await res.text().catch(() => '');
        if (!res.ok) throw new Error(`Scrada gaf HTTP ${res.status}${tekst ? ': ' + tekst.slice(0, 300) : ''}`);
        try { const d = JSON.parse(tekst) as { journalLines?: string[] }; const ids = d.journalLines ?? []; if (ids.length) refs.push(ids[ids.length - 1]); } catch { /* geen id */ }
      }
      await this.prisma.verkoopfactuur.update({ where: { id }, data: { correctieStatus: 'VERSTUURD', correctieRef: refs.join(',') || 'verstuurd', correctieFout: null } });
      return { status: 'VERSTUURD', refs };
    } catch (e) {
      const fout = e instanceof Error ? e.message : 'onbekende fout';
      await this.prisma.verkoopfactuur.update({ where: { id }, data: { correctieStatus: 'FOUT', correctieFout: fout.slice(0, 500) } });
      return { status: 'FOUT', fout };
    }
  }

  // Alles wat klaarstaat: ticketfacturen aanmaken, facturen (vanaf de startdatum)
  // naar Scrada, en wachtende correcties. Wordt aangeroepen na het versturen van
  // de dagen (dezelfde bevestiging van de beheerder).
  async verstuurOpenstaande() {
    const aangemaakt = await this.maakTicketFacturen();
    const vanaf = await this.scrada.vanaf();
    const modus = this.scrada.config() ? 'live' : 'test';
    if (!vanaf) return { modus, aangemaakt, geweigerd: true, melding: 'Stel eerst de startdatum in.', verstuurd: 0, mislukt: 0, correcties: 0 };
    const open = await this.prisma.verkoopfactuur.findMany({ where: { datum: { gte: vanaf }, scradaStatus: { in: ['NIET_VERSTUURD', 'FOUT'] } }, orderBy: { datum: 'asc' }, select: { id: true } });
    let verstuurd = 0, mislukt = 0, correcties = 0; let fout: string | undefined;
    if (modus === 'live') {
      for (const { id } of open) {
        const r = await this.verstuurNaarScrada(id);
        if (r.verstuurd) verstuurd++; else if (r.fout) { mislukt++; fout = r.fout; }
      }
      const wacht = await this.prisma.verkoopfactuur.findMany({ where: { scradaStatus: 'VERSTUURD', correctieStatus: { in: ['NIET_VERSTUURD', 'WACHT_OP_DAG', 'FOUT'] } }, select: { id: true } });
      for (const { id } of wacht) { const r = await this.verstuurCorrectie(id); if (r.status === 'VERSTUURD') correcties++; }
    }
    return { modus, aangemaakt, gevonden: open.length, verstuurd, mislukt, correcties, fout };
  }
}
