import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Dagafsluiting } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ScradaService } from './scrada.service';

// ---------------------------------------------------------------------------
//  Scrada-DAGONTVANGSTENBOEK: per afgesloten kassadag (Dagafsluiting) één
//  dagboeking via PUT /v1/company/{companyID}/journal/{journalID}/lines:
//    - lijnen per BTW-tarief (bedrag incl. BTW, vast Belgisch BTW-type-ID,
//      gekoppeld aan een BTW-categorie van het dagboek in Scrada)
//    - betaalmethoden (som = som van de lijnen), gekoppeld aan de
//      betaalmethoden van het dagboek in Scrada
//  Dit is precies wat op ons dagontvangsten-ticket staat, en vereist geen
//  "Bonnen"-module in Scrada. De koppeling (welk dagboek, welke categorie/
//  betaalmethode bij welk tarief/betaalwijze) staat in Instelling "scrada.dagboek".
// ---------------------------------------------------------------------------

// Vaste Belgische BTW-type-ID's van Scrada (uit hun API-documentatie).
const BTW_TYPE_BE: Record<string, string> = {
  '0': 'cbff0b5e-96e3-4201-91d0-51304cee2605',
  '6': '7befe0fc-7131-4b15-9fe6-ca4b9280b63c',
  '12': '647ed17b-fb6f-4772-baf5-928de98f4db1',
  '21': '8424d909-78b9-483c-9b1d-4584fb537846',
};

export type DagboekInstellingen = {
  journalID: string | null;          // het dagontvangstenboek in Scrada
  journalNaam: string | null;
  vatMap: Record<string, string>;    // ons BTW-tarief ("6", "21", ...) -> Scrada BTW-categorie-ID
  pmMap: Record<string, string>;     // onze betaalwijze ("CASH", ...) -> Scrada betaalmethode-ID
  betalingen: boolean;               // betaalmethoden meesturen (uit als het dagboek geen kasboek heeft)
};

type Lijn = { lineType: 1; categoryID: string; vatTypeID: string; vatPerc: number; amount: number; remark: string; externalReference: string };
type Betaling = { paymentMethodID: string; amount: number; externalReference: string };
export type Dagboeking = { date: string; lines: Lijn[]; paymentMethods?: Betaling[] };

const r2 = (n: number) => Math.round(n * 100) / 100;
const SLEUTEL = 'scrada.dagboek';

// Datum (JJJJ-MM-DD) van een tijdstip volgens de klok in Brussel.
function brusselDatum(d: Date): string {
  const p = new Intl.DateTimeFormat('nl-BE', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${g('year')}-${g('month')}-${g('day')}`;
}

@Injectable()
export class ScradaDagboekService {
  private readonly log = new Logger(ScradaDagboekService.name);
  constructor(private prisma: PrismaService, private scrada: ScradaService) {}

  // --- instellingen -----------------------------------------------------------

  async instellingen(): Promise<DagboekInstellingen> {
    const i = await this.prisma.instelling.findUnique({ where: { sleutel: SLEUTEL } });
    const basis: DagboekInstellingen = { journalID: null, journalNaam: null, vatMap: {}, pmMap: {}, betalingen: true };
    if (!i?.waarde) return basis;
    try { return { ...basis, ...JSON.parse(i.waarde) }; } catch { return basis; }
  }

  async zetInstellingen(input: Partial<DagboekInstellingen>) {
    const huidig = await this.instellingen();
    const nieuw: DagboekInstellingen = {
      journalID: input.journalID !== undefined ? (input.journalID || null) : huidig.journalID,
      journalNaam: input.journalNaam !== undefined ? (input.journalNaam || null) : huidig.journalNaam,
      vatMap: input.vatMap ?? huidig.vatMap,
      pmMap: input.pmMap ?? huidig.pmMap,
      betalingen: input.betalingen ?? huidig.betalingen,
    };
    await this.prisma.instelling.upsert({
      where: { sleutel: SLEUTEL },
      create: { sleutel: SLEUTEL, waarde: JSON.stringify(nieuw) },
      update: { waarde: JSON.stringify(nieuw) },
    });
    return nieuw;
  }

  // --- lijsten uit Scrada (om de koppeling te kiezen) ------------------------

  private async get<T>(pad: string): Promise<T> {
    const c = this.scrada.config();
    if (!c) throw new BadRequestException('Scrada is niet geconfigureerd (API-sleutel, wachtwoord, bedrijfs-ID).');
    const res = await fetch(`${c.base}/v1/company/${c.company}${pad}`, { headers: this.scrada.headers(c) });
    const tekst = await res.text().catch(() => '');
    if (!res.ok) throw new BadRequestException(`Scrada gaf HTTP ${res.status}${tekst ? ': ' + tekst.slice(0, 200) : ''}`);
    try { return JSON.parse(tekst) as T; } catch { throw new BadRequestException('Onleesbaar antwoord van Scrada.'); }
  }

  // Zet een Scrada-antwoord (lijst of {items/__items/...}) om naar een array.
  private lijst(data: unknown): Record<string, unknown>[] {
    if (Array.isArray(data)) return data as Record<string, unknown>[];
    if (data && typeof data === 'object') {
      for (const k of ['items', '__items', 'data', 'results', 'value']) {
        const v = (data as Record<string, unknown>)[k];
        if (Array.isArray(v)) return v as Record<string, unknown>[];
      }
    }
    return [];
  }

  async dagboeken() {
    const data = await this.get<unknown>('/journal');
    return this.lijst(data).map((j) => ({
      id: String(j.id ?? ''), naam: String(j.name ?? ''), actief: j.active !== false,
      startDatum: (j.startDate as string | null) ?? null, laatsteDatum: (j.lastLineDate as string | null) ?? null,
    }));
  }
  async categorieen(journalID: string) {
    const data = await this.get<unknown>(`/journal/${journalID}/vatCategory`);
    return this.lijst(data).map((c) => ({ id: String(c.id ?? ''), naam: String(c.nameNL ?? c.nameEN ?? ''), vatTypeID: (c.vatTypeID as string | null) ?? null }));
  }
  async betaalmethoden(journalID: string) {
    const data = await this.get<unknown>(`/journal/${journalID}/paymentMethod`);
    return this.lijst(data).map((p) => ({ id: String(p.id ?? ''), naam: String(p.nameNL ?? p.nameEN ?? ''), cash: p.isCash === true }));
  }

  // --- dagen ------------------------------------------------------------------

  // Dagafsluitingen met hun Scrada-status; "inAanmerking" = vanaf de startdatum.
  async dagen() {
    const vanaf = await this.scrada.vanaf();
    const rows = await this.prisma.dagafsluiting.findMany({ orderBy: { tot: 'desc' }, take: 90 });
    return rows.map((a) => ({
      id: a.id, volgnummer: a.volgnummer, datum: brusselDatum(a.tot), tot: a.tot, totaal: Number(a.totaal), aantalVerkopen: a.aantalVerkopen,
      scradaStatus: a.scradaStatus, scradaRef: a.scradaRef, scradaVerstuurdOp: a.scradaVerstuurdOp, scradaFout: a.scradaFout,
      inAanmerking: !!vanaf && a.tot >= vanaf,
    }));
  }

  // Bouwt de dagboeking uit de bewaarde (onveranderlijke) cijfers van een afsluiting.
  async bouwBoeking(a: Dagafsluiting): Promise<{ boeking: Dagboeking; ontbreekt: string[] }> {
    const inst = await this.instellingen();
    const ontbreekt: string[] = [];
    if (!inst.journalID) ontbreekt.push('dagboek');
    const tarieven = ((a.perBtwTarief as unknown) as { percentage: number; maatstaf: number; btw: number }[]) ?? [];
    const perBw = ((a.perBetaalwijze as unknown) as Record<string, number>) ?? {};
    const ref = `dagafsluiting:${a.id}`;
    const omschrijving = `Kassa — dagafsluiting${a.volgnummer ? ` #${a.volgnummer}` : ''}`;

    const lines: Lijn[] = [];
    for (const t of tarieven) {
      const bedrag = r2(Number(t.maatstaf) + Number(t.btw));
      if (Math.abs(bedrag) < 0.005) continue;
      const pct = Number(t.percentage);
      const sleutel = String(Math.round(pct));
      const categoryID = inst.vatMap[sleutel];
      const vatTypeID = BTW_TYPE_BE[sleutel];
      if (!categoryID) ontbreekt.push(`BTW-categorie voor ${sleutel}%`);
      if (!vatTypeID) ontbreekt.push(`onbekend BTW-tarief ${pct}%`);
      lines.push({ lineType: 1, categoryID: categoryID ?? '', vatTypeID: vatTypeID ?? '', vatPerc: pct, amount: bedrag, remark: omschrijving, externalReference: ref });
    }

    let paymentMethods: Betaling[] | undefined;
    if (inst.betalingen) {
      paymentMethods = [];
      for (const [bw, bedrag] of Object.entries(perBw)) {
        const b = r2(Number(bedrag));
        if (Math.abs(b) < 0.005) continue;
        const id = inst.pmMap[bw];
        if (!id) ontbreekt.push(`betaalmethode voor ${bw}`);
        const bestaand = paymentMethods.find((p) => p.paymentMethodID === (id ?? bw));
        if (bestaand) bestaand.amount = r2(bestaand.amount + b); // zelfde Scrada-methode: samenvoegen
        else paymentMethods.push({ paymentMethodID: id ?? bw, amount: b, externalReference: ref });
      }
      // Som betalingen moet exact = som lijnen (centverschillen door afronding wegwerken).
      const somL = r2(lines.reduce((s, l) => s + l.amount, 0));
      const somP = r2(paymentMethods.reduce((s, p) => s + p.amount, 0));
      const diff = r2(somL - somP);
      if (paymentMethods.length && Math.abs(diff) >= 0.005 && Math.abs(diff) <= 0.05) {
        paymentMethods[paymentMethods.length - 1].amount = r2(paymentMethods[paymentMethods.length - 1].amount + diff);
      } else if (paymentMethods.length && Math.abs(diff) > 0.05) {
        ontbreekt.push(`betalingen (€ ${somP.toFixed(2)}) ≠ lijnen (€ ${somL.toFixed(2)})`);
      }
    }
    return { boeking: { date: brusselDatum(a.tot), lines, paymentMethods }, ontbreekt };
  }

  async preview(id: string) {
    const a = await this.prisma.dagafsluiting.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('Dagafsluiting niet gevonden.');
    const { boeking, ontbreekt } = await this.bouwBoeking(a);
    return { id: a.id, volgnummer: a.volgnummer, datum: boeking.date, totaal: Number(a.totaal), boeking, ontbreekt, status: a.scradaStatus, ref: a.scradaRef, fout: a.scradaFout };
  }

  // --- versturen --------------------------------------------------------------

  private async put(journalID: string, boeking: Dagboeking): Promise<string | null> {
    const c = this.scrada.config();
    if (!c) throw new Error('Scrada is niet geconfigureerd.');
    const res = await fetch(`${c.base}/v1/company/${c.company}/journal/${journalID}/lines`, {
      method: 'PUT', headers: this.scrada.headers(c), body: JSON.stringify(boeking),
    });
    const tekst = await res.text().catch(() => '');
    if (!res.ok) throw new Error(`Scrada gaf HTTP ${res.status}${tekst ? ': ' + tekst.slice(0, 300) : ''}`);
    try {
      const d = JSON.parse(tekst) as { journalLines?: string[]; message?: { message?: string } | null };
      const ids = d.journalLines ?? [];
      return ids.length ? ids[ids.length - 1] : null;
    } catch { return null; }
  }

  // Eén afgesloten dag versturen (expliciet, ook als test).
  async verstuurDag(id: string) {
    const a = await this.prisma.dagafsluiting.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('Dagafsluiting niet gevonden.');
    if (a.scradaStatus === 'VERSTUURD') return { verstuurd: false, melding: 'Deze dag is al verstuurd naar Scrada.', ref: a.scradaRef };
    const inst = await this.instellingen();
    const { boeking, ontbreekt } = await this.bouwBoeking(a);
    if (ontbreekt.length) throw new BadRequestException(`Koppeling onvolledig: ${ontbreekt.join(', ')}.`);
    if (!boeking.lines.length) {
      await this.prisma.dagafsluiting.update({ where: { id }, data: { scradaStatus: 'VERSTUURD', scradaRef: 'leeg', scradaVerstuurdOp: new Date(), scradaFout: null } });
      return { verstuurd: true, melding: 'Geen ontvangsten op deze dag (niets te boeken).', ref: 'leeg' };
    }
    if (!this.scrada.config()) return { verstuurd: false, modus: 'test', boeking };
    try {
      const ref = await this.put(inst.journalID as string, boeking);
      await this.prisma.dagafsluiting.update({ where: { id }, data: { scradaStatus: 'VERSTUURD', scradaRef: ref ?? 'verstuurd', scradaVerstuurdOp: new Date(), scradaFout: null } });
      return { verstuurd: true, ref, boeking };
    } catch (e) {
      const fout = e instanceof Error ? e.message : 'onbekende fout';
      await this.prisma.dagafsluiting.update({ where: { id }, data: { scradaStatus: 'FOUT', scradaFout: fout.slice(0, 500) } });
      return { verstuurd: false, fout, boeking };
    }
  }

  // Alle nog niet-verstuurde afgesloten dagen VANAF de startdatum, oudste eerst.
  // Stopt bij de eerste fout (zodat de volgorde in het dagboek klopt).
  async verstuurOpenstaandeDagen() {
    const vanaf = await this.scrada.vanaf();
    const modus = this.scrada.config() ? 'live' : 'test';
    if (!vanaf) return { modus, geweigerd: true, gevonden: 0, verstuurd: 0, mislukt: 0, melding: 'Stel eerst de startdatum in.' };
    const inst = await this.instellingen();
    if (!inst.journalID) return { modus, geweigerd: true, gevonden: 0, verstuurd: 0, mislukt: 0, melding: 'Kies eerst het dagontvangstenboek in Scrada (Boekhouding → koppeling).' };
    const open = await this.prisma.dagafsluiting.findMany({
      where: { tot: { gte: vanaf }, scradaStatus: { in: ['NIET_VERSTUURD', 'FOUT'] } },
      orderBy: { tot: 'asc' },
    });
    if (modus === 'test') return { modus, gevonden: open.length, verstuurd: 0, mislukt: 0 };
    let verstuurd = 0, mislukt = 0; let fout: string | undefined;
    for (const a of open) {
      try {
        const r = await this.verstuurDag(a.id);
        if (r.verstuurd) verstuurd++;
        else { mislukt++; fout = r.fout ?? r.melding; break; }
      } catch (e) {
        mislukt++; fout = e instanceof Error ? e.message : 'onbekende fout';
        await this.prisma.dagafsluiting.update({ where: { id: a.id }, data: { scradaStatus: 'FOUT', scradaFout: fout.slice(0, 500) } }).catch(() => undefined);
        break;
      }
    }
    if (fout) this.log.warn(`Dagontvangsten naar Scrada: ${verstuurd} verstuurd, gestopt bij fout: ${fout}`);
    return { modus, gevonden: open.length, verstuurd, mislukt, fout };
  }

  // Na testen (testomgeving), vóór live: dagen vanaf de startdatum terug op "niet verstuurd".
  async resetStatus() {
    const vanaf = await this.scrada.vanaf();
    if (!vanaf) throw new BadRequestException('Stel eerst de startdatum in.');
    const r = await this.prisma.dagafsluiting.updateMany({
      where: { tot: { gte: vanaf }, scradaStatus: { in: ['VERSTUURD', 'FOUT'] } },
      data: { scradaStatus: 'NIET_VERSTUURD', scradaRef: null, scradaVerstuurdOp: null, scradaFout: null },
    });
    return { ok: true, aantal: r.count };
  }
}
