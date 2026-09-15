import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ScradaService } from '../scrada/scrada.service';
import { ScradaDagboekService } from '../scrada/scrada.dagboek.service';
import { MailService } from '../mail/mail.service';

// ---------------------------------------------------------------------------
//  Verkoopfacturen uit de kassa.
//   - TICKET: klant betaalt aan de kassa en vraagt een factuur -> één factuur
//     per ticket, meteen betaald.
//   - MAANDFACTUUR: "op rekening" (bedrijf mét personeelslid, of eender welke
//     klant op naam) -> de aankopen blijven open staan op naam en worden
//     gebundeld tot één factuur per klant: maandelijks (knop "Factureren") of
//     vroeger, zodra de klant aan de kassa (een deel) betaalt.
//     Klant met BTW-nummer = bedrijf -> factuur naar Scrada (concept);
//     zonder BTW-nummer = particulier -> rekening enkel in de kassa (reeks R…).
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

// iban/mailTekst: voor de rekening die particulieren per e-mail krijgen (niet via Scrada).
export type FactuurInstellingen = { prefix: string; verkoopdagboek: string; vervaldagen: number; iban: string; mailTekst: string };
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
  constructor(private prisma: PrismaService, private scrada: ScradaService, private dagboek: ScradaDagboekService, private mail: MailService) {}

  // --- instellingen -----------------------------------------------------------

  // Nummering: <prefix><jaar><volgnummer 4 cijfers>, bv. 20260001 (zonder prefix).
  private reeksSleutel(jaar: string) { return `factuur.reeks.${jaar}`; }
  private huidigJaar() { return brusselDatum(new Date()).slice(0, 4); }

  async instellingen(): Promise<FactuurInstellingen & { jaar: string; volgend: number; voorbeeld: string }> {
    const basis: FactuurInstellingen = { prefix: '', verkoopdagboek: 'KASSA', vervaldagen: 30, iban: '', mailTekst: '' };
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
      iban: (input.iban ?? huidig.iban ?? '').trim(),
      mailTekst: (input.mailTekst ?? huidig.mailTekst ?? '').trim(),
    };
    await this.prisma.instelling.upsert({ where: { sleutel: SLEUTEL }, create: { sleutel: SLEUTEL, waarde: JSON.stringify(nieuw) }, update: { waarde: JSON.stringify(nieuw) } });
    if (input.volgendeVolgnummer != null) {
      const n = Math.max(1, Math.round(Number(input.volgendeVolgnummer) || 1));
      const sleutel = this.reeksSleutel(huidig.jaar);
      await this.prisma.instelling.upsert({ where: { sleutel }, create: { sleutel, waarde: String(n - 1) }, update: { waarde: String(n - 1) } });
    }
    return this.instellingen();
  }

  // Doorlopende nummering per boekjaar. Twee reeksen:
  //  - Scrada-facturen (klant met BTW-nr): <prefix><jaar>0001 (teller "factuur.reeks.<jaar>")
  //  - rekeningen zonder BTW-nr (particulier, niet naar Scrada): R<jaar>0001
  //    (teller "factuur.reeksR.<jaar>") — zo krijgt de Scrada-reeks geen gaten.
  private async volgendNummer(jaar: string, reeks: 'SCRADA' | 'REKENING' = 'SCRADA'): Promise<string> {
    const inst = await this.instellingen();
    const sleutel = reeks === 'SCRADA' ? this.reeksSleutel(jaar) : `factuur.reeksR.${jaar}`;
    return this.prisma.$transaction(async (tx) => {
      const huidig = await tx.instelling.findUnique({ where: { sleutel } });
      const n = (Number(huidig?.waarde ?? 0) || 0) + 1;
      await tx.instelling.upsert({ where: { sleutel }, create: { sleutel, waarde: String(n) }, update: { waarde: String(n) } });
      return `${reeks === 'SCRADA' ? inst.prefix : 'R'}${jaar}${String(n).padStart(4, '0')}`;
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
    if (b) return { naam: b.naam, btw: b.btwNummer ?? null, email: b.email ?? null, adres: b.adres ?? null, telefoon: null as string | null, klantId: v.klantId ?? null, bedrijfId: b.id };
    if (v.klant) return { naam: v.klant.naam, btw: v.klant.btwNummer ?? null, email: v.klant.email ?? null, adres: v.klant.adres ?? null, telefoon: v.klant.telefoon ?? null, klantId: v.klant.id, bedrijfId: null };
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
    // Zonder BTW-nummer (particulier): rekening in de kassa, niet naar Scrada; aparte reeks R…
    const naarScrada = !!klant.btw;
    const nummer = await this.volgendNummer(jaar, naarScrada ? 'SCRADA' : 'REKENING');
    const f = await this.prisma.verkoopfactuur.create({
      data: {
        nummer, boekjaar: jaar, bron: 'TICKET',
        scradaStatus: naarScrada ? 'NIET_VERSTUURD' : 'NIET_NODIG',
        correctieStatus: naarScrada ? 'NIET_VERSTUURD' : 'NIET_NODIG',
        vervaldatum: new Date(Date.now() + inst.vervaldagen * 86400000),
        klantNaam: klant.naam, klantBtw: klant.btw, klantEmail: klant.email, klantAdres: klant.adres, klantTelefoon: klant.telefoon,
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

  // --- open aankopen op rekening (nog niet gefactureerd) ------------------------------
  // Een verkoop staat "open op rekening" als ze niet betaald werd (geen betaalwijze)
  // en op naam staat: een bedrijf (met personeelslid) of een klant.
  private openVerkoopWhere(doel?: { bedrijfId?: string; klantId?: string }): Prisma.VerkoopWhereInput {
    const basis: Prisma.VerkoopWhereInput = { gefactureerd: false, geannuleerd: false, factuurId: null };
    if (doel?.bedrijfId) return { ...basis, rekeningBedrijfId: doel.bedrijfId };
    if (doel?.klantId) return { ...basis, klantId: doel.klantId, rekeningBedrijfId: null, betaalwijze: null };
    return { ...basis, OR: [{ rekeningBedrijfId: { not: null } }, { klantId: { not: null }, betaalwijze: null }] };
  }
  private sleutelVanVerkoop(v: { rekeningBedrijfId: string | null; klantId: string | null }) {
    return v.rekeningBedrijfId ? `b:${v.rekeningBedrijfId}` : `k:${v.klantId}`;
  }
  private doelVanSleutel(sleutel: string): { bedrijfId?: string; klantId?: string } {
    if (sleutel.startsWith('b:')) return { bedrijfId: sleutel.slice(2) };
    if (sleutel.startsWith('k:')) return { klantId: sleutel.slice(2) };
    throw new BadRequestException('Onbekende rekening.');
  }

  // Te factureren: per klant/bedrijf de open aankopen die nog in geen factuur zitten.
  async teFactureren() {
    const verkopen = await this.prisma.verkoop.findMany({ where: this.openVerkoopWhere(), include: VERKOOP_INCLUDE, orderBy: { datum: 'asc' } });
    type Groep = { sleutel: string; naam: string; btwNummer: string | null; telefoon: string | null; aantal: number; totaal: number; oudste: Date; laatste: Date; naarScrada: boolean };
    const groepen = new Map<string, Groep>();
    for (const v of verkopen) {
      const klant = this.klantVan(v);
      if (!klant) continue;
      const sleutel = this.sleutelVanVerkoop(v);
      const g = groepen.get(sleutel) ?? { sleutel, naam: klant.naam, btwNummer: klant.btw, telefoon: klant.telefoon, aantal: 0, totaal: 0, oudste: v.datum, laatste: v.datum, naarScrada: !!klant.btw };
      g.aantal++; g.totaal = r2(g.totaal + Number(v.totaal));
      if (v.datum < g.oudste) g.oudste = v.datum;
      if (v.datum > g.laatste) g.laatste = v.datum;
      groepen.set(sleutel, g);
    }
    return [...groepen.values()].sort((a, b) => a.naam.localeCompare(b.naam, 'nl'));
  }

  // Maandfactuur voor een bedrijf (Klant factuur -> Factureren).
  async maakMaandfactuur(bedrijfId: string) { return this.maakBundel({ bedrijfId }); }
  // Maandfactuur/rekening voor een klant of bedrijf via de sleutel (b:… / k:…).
  async maakBundelVoorSleutel(sleutel: string) { return this.maakBundel(this.doelVanSleutel(sleutel)); }
  // Alle open rekeningen in één keer factureren (einde van de maand).
  async factureerAlles() {
    const groepen = await this.teFactureren();
    const uit: { sleutel: string; naam: string; nummer?: string; totaal?: number; fout?: string }[] = [];
    for (const g of groepen) {
      try { const r = await this.maakBundelVoorSleutel(g.sleutel); uit.push({ sleutel: g.sleutel, naam: g.naam, nummer: r.factuur.nummer, totaal: r.totaal }); }
      catch (e) { uit.push({ sleutel: g.sleutel, naam: g.naam, fout: e instanceof Error ? e.message : 'fout' }); }
    }
    return { aantal: uit.filter((u) => u.nummer).length, resultaten: uit };
  }

  // Bundel: alle open "op rekening"-aankopen van één bedrijf of klant in één factuur.
  private async maakBundel(doel: { bedrijfId?: string; klantId?: string }) {
    const verkopen = await this.prisma.verkoop.findMany({ where: this.openVerkoopWhere(doel), include: VERKOOP_INCLUDE, orderBy: { datum: 'asc' } });
    if (!verkopen.length) throw new BadRequestException('Geen openstaande aankopen op rekening voor deze klant.');
    const klant = this.klantVan(verkopen[0]);
    if (!klant) throw new BadRequestException('Klant niet gevonden.');
    const lijnen = this.lijnenVan(verkopen);
    const perBtw = this.perBtwVan(lijnen);
    const laatste = verkopen[verkopen.length - 1].datum;
    const jaar = brusselDatum(new Date()).slice(0, 4);
    const inst = await this.instellingen();
    // Met BTW-nummer = bedrijf -> factuur naar Scrada; zonder = particulier -> rekening enkel in de kassa.
    const naarScrada = !!klant.btw;
    const nummer = await this.volgendNummer(jaar, naarScrada ? 'SCRADA' : 'REKENING');
    const f = await this.prisma.verkoopfactuur.create({
      data: {
        nummer, boekjaar: jaar, bron: 'MAANDFACTUUR', periode: brusselDatum(laatste).slice(0, 7),
        scradaStatus: naarScrada ? 'NIET_VERSTUURD' : 'NIET_NODIG',
        correctieStatus: naarScrada ? 'NIET_VERSTUURD' : 'NIET_NODIG',
        vervaldatum: new Date(Date.now() + inst.vervaldagen * 86400000),
        klantNaam: klant.naam, klantBtw: klant.btw, klantEmail: klant.email, klantAdres: klant.adres, klantTelefoon: klant.telefoon,
        rekeningBedrijfId: doel.bedrijfId ?? null,
        klantId: doel.bedrijfId ? null : (doel.klantId ?? null),
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

  // Betaalde tickets waarvoor aan de kassa een factuur gevraagd werd en die nog geen
  // factuur hebben (aankopen op rekening horen hier niet bij: die worden gebundeld).
  async maakTicketFacturen() {
    const open = await this.prisma.verkoop.findMany({ where: { factuurGewenst: true, factuurId: null, geannuleerd: false, betaalwijze: { not: null } }, select: { id: true } });
    let n = 0;
    for (const { id } of open) { try { await this.maakVoorVerkoop(id); n++; } catch (e) { this.log.warn(`Ticketfactuur ${id}: ${e instanceof Error ? e.message : e}`); } }
    return n;
  }

  // Bewaarde klanten om aan de kassa te kiezen (factuur / op rekening), met wat er
  // nog open staat. rekeningTeLaat: particulier (geen BTW-nummer) met een
  // openstaande rekening ouder dan één maand -> de kassa toont de naam in het rood.
  async klanten() {
    // Bedrijven (B2B) én particulieren die al eens op naam/rekening kochten.
    const rows = await this.prisma.klant.findMany({ where: { OR: [{ type: 'B2B' }, { facturen: { some: {} } }, { verkopen: { some: { betaalwijze: null, rekeningBedrijfId: null } } }] }, orderBy: { naam: 'asc' }, take: 500 });
    const open = new Map<string, { bedrag: number; sinds: Date }>();
    const tel = (klantId: string | null, bedrag: number, datum: Date) => {
      if (!klantId || bedrag <= 0.005) return;
      const o = open.get(klantId) ?? { bedrag: 0, sinds: datum };
      o.bedrag = r2(o.bedrag + bedrag);
      if (datum < o.sinds) o.sinds = datum;
      open.set(klantId, o);
    };
    const [verkopen, facturen] = await Promise.all([
      this.prisma.verkoop.findMany({ where: { ...this.openVerkoopWhere(), rekeningBedrijfId: null }, select: { klantId: true, totaal: true, datum: true } }),
      this.prisma.verkoopfactuur.findMany({ where: { betaalstatus: 'OPENSTAAND', klantId: { not: null } }, select: { klantId: true, totaalIncl: true, betaaldBedrag: true, datum: true } }),
    ]);
    for (const v of verkopen) tel(v.klantId, Number(v.totaal), v.datum);
    for (const f of facturen) tel(f.klantId, r2(Number(f.totaalIncl) - Number(f.betaaldBedrag)), f.datum);
    const grens = new Date(); grens.setMonth(grens.getMonth() - 1);
    return rows.map((k) => {
      const o = open.get(k.id);
      return {
        id: k.id, naam: k.naam, btwNummer: k.btwNummer, email: k.email, adres: k.adres, telefoon: k.telefoon,
        openBedrag: o?.bedrag ?? 0, openSinds: o?.sinds ?? null,
        rekeningTeLaat: !!o && !k.btwNummer && o.sinds < grens,
      };
    });
  }

  // Klantgegevens bijwerken vanuit de kassa (e-mail voor de maandelijkse rekening, telefoon, adres).
  async zetKlantGegevens(id: string, input: { email?: string | null; telefoon?: string | null; adres?: string | null }) {
    const k = await this.prisma.klant.findUnique({ where: { id } });
    if (!k) throw new NotFoundException('Klant niet gevonden.');
    const email = input.email !== undefined ? (input.email?.trim() || null) : k.email;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestException('Geen geldig e-mailadres.');
    const bij = await this.prisma.klant.update({
      where: { id },
      data: {
        email,
        telefoon: input.telefoon !== undefined ? (input.telefoon?.trim() || null) : k.telefoon,
        adres: input.adres !== undefined ? (input.adres?.trim() || null) : k.adres,
      },
    });
    return { id: bij.id, naam: bij.naam, btwNummer: bij.btwNummer, email: bij.email, adres: bij.adres, telefoon: bij.telefoon };
  }

  // --- rekening per e-mail (particulieren: niet via Scrada/Peppol) --------------------------
  mailStatus() { return this.mail.status(); }

  private rekeningHtml(f: { nummer: string; datum: Date; vervaldatum: Date | null; periode: string | null; klantNaam: string; klantAdres: string | null; lijnen: unknown; perBtw: unknown; totaalIncl: Prisma.Decimal | number; betaaldBedrag: Prisma.Decimal | number; betaalstatus: string }, inst: FactuurInstellingen, winkel: { naam: string; btwNummer: string | null; adres: string | null } | null) {
    const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
    const eur = (n: number) => '€ ' + n.toFixed(2).replace('.', ',');
    const dNl = (d: Date | string) => new Date(d).toLocaleDateString('nl-BE', { timeZone: 'Europe/Brussels' });
    const lijnen = (f.lijnen as FactuurLijn[]) ?? [];
    const perBtw = (f.perBtw as PerBtw[]) ?? [];
    const rest = r2(Number(f.totaalIncl) - Number(f.betaaldBedrag));
    const rijen = lijnen.map((l) => `<tr><td style="padding:4px 8px;border-bottom:1px solid #eee;white-space:nowrap">${dNl(l.datum)}</td><td style="padding:4px 8px;border-bottom:1px solid #eee">${esc(l.omschrijving)}${l.lid ? ` <span style="color:#6b7280">(${esc(l.lid)})</span>` : ''}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right;white-space:nowrap">${l.kg ? l.aantal.toFixed(3).replace('.', ',') + ' kg' : l.aantal}</td><td style="padding:4px 8px;border-bottom:1px solid #eee;text-align:right;white-space:nowrap">${eur(l.totaalIncl)}</td></tr>`).join('');
    const btwRijen = perBtw.map((p) => `<tr><td colspan="3" style="padding:2px 8px;text-align:right;color:#6b7280">BTW ${p.percentage} % (op ${eur(p.excl)})</td><td style="padding:2px 8px;text-align:right;color:#6b7280">${eur(p.btw)}</td></tr>`).join('');
    const betaalBlok = f.betaalstatus === 'BETAALD'
      ? `<p style="color:#166534;font-weight:bold">Deze rekening is volledig betaald. Bedankt!</p>`
      : `<p><strong>Te betalen: ${eur(rest)}</strong>${Number(f.betaaldBedrag) > 0 ? ` (reeds betaald: ${eur(Number(f.betaaldBedrag))})` : ''}${f.vervaldatum ? `, graag vóór ${dNl(f.vervaldatum)}` : ''}.</p>
         <p>U kunt betalen aan de kassa (Bancontact, cash, cadeaubon)${inst.iban ? ` of per overschrijving op <strong>${esc(inst.iban)}</strong> met mededeling <strong>${esc(f.nummer)}</strong>` : ''}.</p>`;
    const tekst = inst.mailTekst ? `<p>${esc(inst.mailTekst).replace(/\n/g, '<br>')}</p>` : '';
    return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111;max-width:640px">
      <h2 style="margin:0 0 4px">${esc(winkel?.naam ?? 'Marché')}</h2>
      <div style="color:#6b7280;font-size:12px;margin-bottom:16px">${esc(winkel?.adres ?? '')}${winkel?.btwNummer ? ` · ${esc(winkel.btwNummer)}` : ''}</div>
      <h3 style="margin:0 0 8px">Rekening ${esc(f.nummer)}${f.periode ? ` — ${esc(f.periode)}` : ''}</h3>
      <div style="margin-bottom:12px">${esc(f.klantNaam)}${f.klantAdres ? `<br>${esc(f.klantAdres)}` : ''}<br><span style="color:#6b7280">Datum: ${dNl(f.datum)}</span></div>
      <p>Beste ${esc(f.klantNaam)},</p>
      <p>Hierbij het overzicht van uw aankopen op rekening.</p>
      ${tekst}
      <table style="border-collapse:collapse;width:100%;font-size:13px">
        <thead><tr style="background:#f3f4f6"><th style="padding:6px 8px;text-align:left">Datum</th><th style="padding:6px 8px;text-align:left">Omschrijving</th><th style="padding:6px 8px;text-align:right">Aantal</th><th style="padding:6px 8px;text-align:right">Bedrag</th></tr></thead>
        <tbody>${rijen}${btwRijen}
        <tr><td colspan="3" style="padding:8px;text-align:right;font-weight:bold;border-top:2px solid #111">Totaal incl. BTW</td><td style="padding:8px;text-align:right;font-weight:bold;border-top:2px solid #111">${eur(Number(f.totaalIncl))}</td></tr></tbody>
      </table>
      ${betaalBlok}
      <p style="color:#6b7280;font-size:12px">Met vriendelijke groeten,<br>${esc(winkel?.naam ?? 'Marché')}</p>
    </div>`;
  }

  // Rekening per e-mail naar de klant (particulier: niet via Scrada). Kan ook opnieuw.
  async mailRekening(id: string, naarOverride?: string) {
    const f = await this.prisma.verkoopfactuur.findUnique({ where: { id }, include: { klant: { select: { email: true } } } });
    if (!f) throw new NotFoundException('Factuur niet gevonden.');
    const naar = (naarOverride?.trim() || f.klantEmail || f.klant?.email || '').trim();
    if (!naar) throw new BadRequestException(`Geen e-mailadres bekend voor ${f.klantNaam}. Vul het in bij de klant (kassa → op rekening) en probeer opnieuw.`);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(naar)) throw new BadRequestException('Geen geldig e-mailadres.');
    const [inst, winkel] = await Promise.all([this.instellingen(), this.prisma.onderneming.findFirst({ where: { isImporteur: false }, select: { naam: true, btwNummer: true, adres: true } })]);
    const html = this.rekeningHtml(f, inst, winkel);
    const onderwerp = `${winkel?.naam ?? 'Marché'} — rekening ${f.nummer}${f.periode ? ` (${f.periode})` : ''}`;
    await this.mail.verstuur({ naar, onderwerp, html });
    await this.prisma.verkoopfactuur.update({ where: { id }, data: { gemaildOp: new Date(), gemaildNaar: naar, ...(f.klantEmail ? {} : { klantEmail: naar }) } });
    return { ok: true, naar, nummer: f.nummer };
  }

  // Alle nog niet gemailde rekeningen van particulieren (niet naar Scrada) in één keer.
  async mailOpenRekeningen() {
    const rows = await this.prisma.verkoopfactuur.findMany({ where: { scradaStatus: 'NIET_NODIG', gemaildOp: null }, orderBy: { datum: 'asc' }, select: { id: true, nummer: true, klantNaam: true } });
    const uit: { nummer: string; naam: string; naar?: string; fout?: string }[] = [];
    for (const r of rows) {
      try { const m = await this.mailRekening(r.id); uit.push({ nummer: r.nummer, naam: r.klantNaam, naar: m.naar }); }
      catch (e) { uit.push({ nummer: r.nummer, naam: r.klantNaam, fout: e instanceof Error ? e.message : 'fout' }); }
    }
    return { verstuurd: uit.filter((u) => u.naar).length, resultaten: uit };
  }

  // --- open rekeningen: betalingen ontvangen aan de kassa (alle medewerkers) ----------
  // Een rekening/factuur wordt betaald met echte betaalwijzen (nooit opnieuw "op
  // rekening"). De betaling komt op de dagafsluiting van vandaag (+ betaalwijze,
  // - op rekening) en wordt oudste-eerst toegewezen aan de open posten van de klant.
  private static readonly BETAALBAAR = new Set(['CASH', 'BANCONTACT', 'KAART', 'OVERSCHRIJVING', 'QR', 'CADEAUBON']);

  private groepSleutel(f: { rekeningBedrijfId: string | null; klantId: string | null; id: string }) {
    return f.rekeningBedrijfId ? `b:${f.rekeningBedrijfId}` : f.klantId ? `k:${f.klantId}` : `f:${f.id}`;
  }

  // Per klant: de open facturen/rekeningen én de aankopen die nog in geen factuur
  // zitten (bron OPEN_AANKOOP) — samen het volledige openstaande bedrag.
  async openRekeningen() {
    type Item = { id: string; nummer: string; datum: Date; bron: string; periode: string | null; omschrijving?: string; totaal: number; betaald: number; rest: number; naarScrada: boolean };
    type Groep = { sleutel: string; naam: string; btwNummer: string | null; telefoon: string | null; adres: string | null; open: number; oudste: Date | null; items: Item[] };
    const groepen = new Map<string, Groep>();
    const [rows, verkopen] = await Promise.all([
      this.prisma.verkoopfactuur.findMany({ where: { betaalstatus: 'OPENSTAAND' }, orderBy: { datum: 'asc' } }),
      this.prisma.verkoop.findMany({ where: this.openVerkoopWhere(), include: VERKOOP_INCLUDE, orderBy: { datum: 'asc' } }),
    ]);
    for (const f of rows) {
      const rest = r2(Number(f.totaalIncl) - Number(f.betaaldBedrag));
      if (rest <= 0.005) continue;
      const sleutel = this.groepSleutel(f);
      const g = groepen.get(sleutel) ?? { sleutel, naam: f.klantNaam, btwNummer: f.klantBtw, telefoon: f.klantTelefoon, adres: f.klantAdres, open: 0, oudste: null, items: [] };
      g.open = r2(g.open + rest);
      if (!g.oudste || f.datum < g.oudste) g.oudste = f.datum;
      g.items.push({ id: f.id, nummer: f.nummer, datum: f.datum, bron: f.bron, periode: f.periode, totaal: Number(f.totaalIncl), betaald: Number(f.betaaldBedrag), rest, naarScrada: f.scradaStatus !== 'NIET_NODIG' });
      groepen.set(sleutel, g);
    }
    for (const v of verkopen) {
      const klant = this.klantVan(v);
      if (!klant) continue;
      const totaal = Number(v.totaal);
      if (totaal <= 0.005) continue;
      const sleutel = this.sleutelVanVerkoop(v);
      const g = groepen.get(sleutel) ?? { sleutel, naam: klant.naam, btwNummer: klant.btw, telefoon: klant.telefoon, adres: klant.adres, open: 0, oudste: null, items: [] };
      g.open = r2(g.open + totaal);
      if (!g.oudste || v.datum < g.oudste) g.oudste = v.datum;
      const artikelen = v.lijnen.map((l) => l.product.naam).slice(0, 3).join(', ') + (v.lijnen.length > 3 ? '…' : '');
      g.items.push({ id: v.id, nummer: '', datum: v.datum, bron: 'OPEN_AANKOOP', periode: null, omschrijving: `${v.rekeningLid ? v.rekeningLid.naam + ' · ' : ''}${artikelen}`, totaal, betaald: 0, rest: totaal, naarScrada: !!klant.btw });
      groepen.set(sleutel, g);
    }
    for (const g of groepen.values()) g.items.sort((a, b) => a.datum.getTime() - b.datum.getTime());
    return [...groepen.values()].sort((a, b) => a.naam.localeCompare(b.naam, 'nl'));
  }

  async registreerBetaling(input: { sleutel: string; betalingen: { betaalwijze: string; bedrag: number }[]; gebruikerId?: string }) {
    const betalingen = (input.betalingen ?? []).map((b) => ({ betaalwijze: String(b.betaalwijze ?? '').toUpperCase(), bedrag: r2(Number(b.bedrag) || 0) })).filter((b) => b.bedrag !== 0);
    if (!betalingen.length || betalingen.length > 2) throw new BadRequestException('Geef één of twee betaalwijzen met een bedrag.');
    for (const b of betalingen) {
      if (!VerkoopfacturenService.BETAALBAAR.has(b.betaalwijze)) throw new BadRequestException(`Betaalwijze ${b.betaalwijze} kan niet: een rekening kan niet opnieuw op rekening gezet worden.`);
      if (b.bedrag <= 0) throw new BadRequestException('Elk bedrag moet groter zijn dan 0.');
    }
    const totaal = r2(betalingen.reduce((s, b) => s + b.bedrag, 0));
    let groep = (await this.openRekeningen()).find((g) => g.sleutel === input.sleutel);
    if (!groep) throw new NotFoundException('Geen openstaande rekening gevonden voor deze klant.');
    if (totaal > groep.open + 0.005) throw new BadRequestException(`Het bedrag (€ ${totaal.toFixed(2)}) is hoger dan het openstaande (€ ${groep.open.toFixed(2)}).`);

    // Betaalt de klant terwijl er nog niet-gefactureerde aankopen open staan, dan
    // wordt daar nu eerst de rekening/factuur van gemaakt (één bundel), zodat de
    // betaling erop kan en er op het einde van de maand niets dubbel gebeurt.
    let nieuweFactuur: { id: string; nummer: string } | null = null;
    if (groep.items.some((i) => i.bron === 'OPEN_AANKOOP')) {
      const r = await this.maakBundelVoorSleutel(input.sleutel);
      nieuweFactuur = { id: r.factuur.id, nummer: r.factuur.nummer };
      groep = (await this.openRekeningen()).find((g) => g.sleutel === input.sleutel);
      if (!groep) throw new NotFoundException('Geen openstaande rekening gevonden voor deze klant.');
    }

    const toegewezen: { factuurId: string; nummer: string; bedrag: number }[] = [];
    await this.prisma.$transaction(async (tx) => {
      let over = totaal;
      for (const item of groep!.items) {
        if (over <= 0.005) break;
        if (item.bron === 'OPEN_AANKOOP') continue;
        const deel = r2(Math.min(item.rest, over));
        over = r2(over - deel);
        // Deelbetalingen evenredig verdelen over de betaalwijzen (laatste krijgt het restje).
        const verdeling = betalingen.map((b) => ({ betaalwijze: b.betaalwijze, bedrag: r2((b.bedrag * deel) / totaal) }));
        const somV = r2(verdeling.reduce((s, v) => s + v.bedrag, 0));
        verdeling[verdeling.length - 1].bedrag = r2(verdeling[verdeling.length - 1].bedrag + (deel - somV));
        await tx.rekeningBetaling.create({ data: { factuurId: item.id, bedrag: new Prisma.Decimal(deel), betalingen: verdeling as unknown as Prisma.InputJsonValue, gebruikerId: input.gebruikerId ?? null } });
        const nieuwBetaald = r2(item.betaald + deel);
        const volledig = nieuwBetaald >= item.totaal - 0.005;
        await tx.verkoopfactuur.update({
          where: { id: item.id },
          data: {
            betaaldBedrag: new Prisma.Decimal(nieuwBetaald),
            ...(volledig ? { betaalstatus: 'BETAALD', betaaldOp: new Date(), betaalwijze: betalingen.map((b) => b.betaalwijze).join('+') } : {}),
          },
        });
        toegewezen.push({ factuurId: item.id, nummer: item.nummer, bedrag: deel });
      }
    });
    return { ok: true, totaal, toegewezen, nieuweFactuur, restNaBetaling: r2(groep.open - totaal) };
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
      samenvatten: f.samenvatten, omschrijving: f.omschrijving,
      klantEmail: f.klantEmail, gemaildOp: f.gemaildOp, gemaildNaar: f.gemaildNaar,
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
    const [open, gefactureerdOnbetaald, teVersturen, tickets, teFactureren] = await Promise.all([
      this.prisma.verkoopfactuur.count({ where: { betaalstatus: 'OPENSTAAND' } }),
      this.prisma.verkoopfactuur.aggregate({ _sum: { totaalIncl: true }, where: { betaalstatus: 'OPENSTAAND' } }),
      this.prisma.verkoopfactuur.count({ where: { scradaStatus: { in: ['NIET_VERSTUURD', 'FOUT'] } } }),
      this.prisma.verkoop.count({ where: { factuurGewenst: true, factuurId: null, geannuleerd: false, betaalwijze: { not: null } } }),
      this.teFactureren(),
    ]);
    return {
      openstaand: open, openstaandBedrag: Number(gefactureerdOnbetaald._sum.totaalIncl ?? 0), teVersturen, ticketsZonderFactuur: tickets,
      teFactureren: teFactureren.length, teFacturerenBedrag: r2(teFactureren.reduce((s, g) => s + g.totaal, 0)),
    };
  }

  // Weergave naar Scrada instellen (vóór het versturen): enkel totalen per
  // BTW-tarief met een eigen omschrijving, of alle productlijnen.
  async zetWeergave(id: string, input: { samenvatten?: boolean; omschrijving?: string | null }) {
    const f = await this.prisma.verkoopfactuur.findUnique({ where: { id } });
    if (!f) throw new NotFoundException('Factuur niet gevonden.');
    if (f.scradaStatus === 'VERSTUURD') throw new BadRequestException('Deze factuur staat al in Scrada; de weergave kan niet meer gewijzigd worden.');
    return this.prisma.verkoopfactuur.update({
      where: { id },
      data: {
        samenvatten: input.samenvatten ?? f.samenvatten,
        omschrijving: input.omschrijving !== undefined ? (input.omschrijving?.trim() || null) : f.omschrijving,
      },
    });
  }

  // Factuur verwijderen (bv. testfacturen). De gekoppelde tickets worden losgemaakt
  // (niet meer gefactureerd, geen factuur meer gewenst) en als het de laatst
  // toegekende factuur van het jaar was, komt het nummer weer vrij. Staat de
  // factuur al als concept in Scrada, dan moet ze daar apart verwijderd worden.
  async verwijder(id: string) {
    const f = await this.prisma.verkoopfactuur.findUnique({ where: { id } });
    if (!f) throw new NotFoundException('Factuur niet gevonden.');
    await this.prisma.$transaction(async (tx) => {
      await tx.verkoop.updateMany({ where: { factuurId: id }, data: { factuurId: null, factuurGewenst: false, gefactureerd: false, gefactureerdOp: null } });
      await tx.verkoopfactuur.delete({ where: { id } });
      // Nummer vrijgeven als het het laatste van de reeks was (teller = laatst uitgegeven volgnummer).
      const sleutel = f.nummer.startsWith('R') ? `factuur.reeksR.${f.boekjaar}` : this.reeksSleutel(f.boekjaar);
      const reeks = await tx.instelling.findUnique({ where: { sleutel } });
      const laatste = Number(reeks?.waarde ?? 0) || 0;
      const eigen = Number(f.nummer.slice(-4)) || 0;
      if (laatste > 0 && eigen === laatste) {
        await tx.instelling.update({ where: { sleutel }, data: { waarde: String(laatste - 1) } });
      }
    });
    return { ok: true, nummer: f.nummer, inScrada: f.scradaStatus === 'VERSTUURD' };
  }

  // --- Scrada: factuur (concept) --------------------------------------------------------

  private bouwScrada(f: { nummer: string; boekjaar: string; datum: Date; vervaldatum: Date | null; klantNaam: string; klantBtw: string | null; klantEmail: string | null; klantAdres: string | null; klantTelefoon: string | null; totaalExcl: Prisma.Decimal | number; totaalBtw: Prisma.Decimal | number; totaalIncl: Prisma.Decimal | number; perBtw: unknown; lijnen: unknown; bron: string; periode: string | null; id: string; betaalstatus: string; betaalwijze: string | null; samenvatten: boolean; omschrijving: string | null }, inst: FactuurInstellingen) {
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
        phone: f.klantTelefoon ?? undefined,
        // Scrada: 'address' is verplicht (met landcode); straat enkel als we ze kennen.
        address: { countryCode: 'BE', ...(f.klantAdres ? { street: f.klantAdres } : {}) },
      },
      // Informatief voor het nazicht in Scrada: betaald aan de kassa (en hoe) of nog te betalen.
      note: (f.bron === 'MAANDFACTUUR'
        ? `Maandfactuur kassa Marché — aankopen op rekening ${f.periode ?? ''}`.trim()
        : 'Factuur kassa Marché — kasticket')
        + (f.betaalstatus === 'BETAALD' ? ` · betaald aan de kassa (${f.betaalwijze ?? 'betaald'})` : ' · nog te betalen'),
      totalExclVat: r2(Number(f.totaalExcl)),
      totalVat: r2(Number(f.totaalBtw)),
      totalInclVat: r2(Number(f.totaalIncl)),
      // Samengevat: één lijn per BTW-tarief met de eigen omschrijving; anders elke productlijn.
      lines: f.samenvatten
        ? perBtw.map((p, i) => ({
          lineNumber: String(i + 1),
          itemName: `${(f.omschrijving?.trim() || 'Aankopen kassa Marché')}${f.periode ? ` (${f.periode})` : ''} — BTW ${p.percentage} %`,
          quantity: 1,
          unitType: 2,
          itemInclVat: p.incl,
          vatType: p.percentage === 0 ? 2 : 1,
          vatPercentage: p.percentage,
          totalInclVat: p.incl,
        }))
        : lijnen.map((l, i) => ({
          lineNumber: String(i + 1), // Scrada verwacht een tekst
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
