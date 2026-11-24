import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from '../push/push.service';

const DATUM = /^\d{4}-\d{2}-\d{2}$/;
const isDatum = (d: string) => DATUM.test(d) && !Number.isNaN(Date.parse(`${d}T12:00:00Z`)) && new Date(`${d}T12:00:00Z`).toISOString().slice(0, 10) === d;
const brusselVandaag = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Brussels' }).format(new Date());
const brusselUur = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', hour: '2-digit', hour12: false }).format(new Date()));
const plusDagen = (d: string, n: number) => new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
const dagenTussen = (van: string, tot: string) => Math.round((Date.parse(`${tot}T12:00:00Z`) - Date.parse(`${van}T12:00:00Z`)) / 86400000);
const r3 = (n: number) => Math.round(n * 1000) / 1000;

const SLEUTEL_INST = 'voorraad.instellingen';
const SLEUTEL_ALARM = 'voorraad.thtAlarm'; // laatste controle: { datum, moment, verlopen, bijna }
const STANDAARD_ALARM_DAGEN = 3;
const CONTROLE_MS = 10 * 60 * 1000;
const ALARM_UUR = 7; // vanaf 07:00 (Brussel), één keer per dag
export const REDENEN = ['THT_VERLOPEN', 'BESCHADIGD', 'ANDERE'] as const;

export type Lot = { id: string; aantal: number; tht: string | null; ontvangenOp: string; createdAt: Date };
export type ThtStatus = 'VERLOPEN' | 'BIJNA' | 'OK';
const thtStatus = (tht: string | null, vandaag: string, alarmDagen: number): ThtStatus | null =>
  !tht ? null : tht < vandaag ? 'VERLOPEN' : tht <= plusDagen(vandaag, alarmDagen) ? 'BIJNA' : 'OK';

type OntvangstInput = { productId?: string; locatieId?: string; aantal?: unknown; ontvangenOp?: string; tht?: string | null; aankoopprijs?: unknown; opmerking?: string; bron?: string };

// Voorraad per artikel: ontvangsten met ontvangstdatum en THT, afboeken en tellen, een centrale
// lijst, en elke ochtend een THT-controle op de achtergrond met een melding naar de beheerders.
// De actuele voorraad komt zoals altijd uit Voorraad (de kassa trekt er bij elke verkoop af).
// Welke ontvangsten er nog liggen, rekenen we daaruit: wat het eerst vervalt, gaat eerst weg.
@Injectable()
export class VoorraadService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(VoorraadService.name);
  private timer?: NodeJS.Timeout;
  private bezig = false;

  constructor(private prisma: PrismaService, private push: PushService) {}

  onModuleInit() {
    this.timer = setInterval(() => { void this.tik(); }, CONTROLE_MS);
    setTimeout(() => { void this.tik(); }, 60_000).unref?.();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // Wat er nog ligt: de actuele voorraad hoort bij de laatst houdbare ontvangsten (wat het eerst
  // vervalt, wordt eerst verkocht). Ontvangsten zonder THT tellen als eerst verkocht, zodat een
  // THT nooit onterecht uit beeld verdwijnt. Meer voorraad dan ontvangen = zonder registratie.
  static verdeel(voorraad: number, loten: Lot[]) {
    const volgorde = [...loten].sort((a, b) => {
      if (a.tht && b.tht && a.tht !== b.tht) return a.tht < b.tht ? 1 : -1; // latere THT eerst
      if (!!a.tht !== !!b.tht) return a.tht ? -1 : 1;                       // met THT vóór zonder
      if (a.ontvangenOp !== b.ontvangenOp) return a.ontvangenOp < b.ontvangenOp ? 1 : -1;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });
    let over = Math.max(0, r3(voorraad));
    const rest = new Map<string, number>();
    for (const l of volgorde) {
      const r = r3(Math.min(l.aantal, over));
      rest.set(l.id, r);
      over = r3(over - r);
    }
    return { rest, zonderOntvangst: over };
  }

  // --- instellingen ------------------------------------------------------------------
  async instellingen() {
    const i = await this.prisma.instelling.findUnique({ where: { sleutel: SLEUTEL_INST } });
    let alarmDagen = STANDAARD_ALARM_DAGEN;
    try {
      const v = JSON.parse(i?.waarde ?? '{}');
      if (Number.isInteger(v.alarmDagen) && v.alarmDagen >= 0 && v.alarmDagen <= 60) alarmDagen = v.alarmDagen;
    } catch { /* standaard */ }
    return { alarmDagen };
  }

  async zetInstellingen(input: { alarmDagen?: unknown }) {
    const n = Number(input?.alarmDagen);
    if (!Number.isInteger(n) || n < 0 || n > 60) throw new BadRequestException('Geef een aantal dagen van 0 tot 60.');
    const waarde = JSON.stringify({ alarmDagen: n });
    await this.prisma.instelling.upsert({ where: { sleutel: SLEUTEL_INST }, create: { sleutel: SLEUTEL_INST, waarde }, update: { waarde } });
    return { alarmDagen: n };
  }

  // --- locaties en artikels ---------------------------------------------------------------
  locaties() {
    return this.prisma.stockLocatie.findMany({ where: { actief: true }, orderBy: [{ type: 'asc' }, { naam: 'asc' }], select: { id: true, naam: true, type: true } });
  }

  // Zonder keuze: de winkel (daar trekt de kassa af), nooit zomaar de eerste in het alfabet.
  private async locatie(locatieId?: string) {
    if (locatieId) {
      const l = await this.prisma.stockLocatie.findFirst({ where: { id: String(locatieId), actief: true } });
      if (!l) throw new BadRequestException('Onbekende locatie.');
      return l;
    }
    const w = await this.prisma.stockLocatie.findFirst({ where: { type: 'WINKEL', actief: true }, orderBy: { naam: 'asc' } });
    if (!w) throw new BadRequestException('Geen actieve winkellocatie gevonden.');
    return w;
  }

  private async artikelMetVoorraad(productId?: string) {
    const p = await this.prisma.product.findUnique({ where: { id: String(productId ?? '') } });
    if (!p) throw new NotFoundException('Artikel niet gevonden.');
    if (p.vrijePrijs || p.isStatiegeld) throw new BadRequestException(`${p.naam} heeft geen voorraad.`);
    return p;
  }

  private hoeveel(waarde: unknown, eenheid: string, wat: string) {
    const n = Number(String(waarde ?? '').replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0 || n > 100000) throw new BadRequestException(`Geef een geldig aantal ${wat}.`);
    if (eenheid !== 'KG' && !Number.isInteger(n)) throw new BadRequestException('Dit artikel tel je per stuk.');
    return r3(n);
  }

  // --- ontvangen, afboeken, tellen --------------------------------------------------------
  async ontvangst(input: OntvangstInput, door?: string | null) {
    const p = await this.artikelMetVoorraad(input?.productId);
    const aantal = this.hoeveel(input?.aantal, p.eenheid, 'om te ontvangen');
    const vandaag = brusselVandaag();
    const ontvangenOp = String(input?.ontvangenOp ?? '').trim() || vandaag;
    if (!isDatum(ontvangenOp)) throw new BadRequestException('Geef een geldige ontvangstdatum.');
    if (ontvangenOp > vandaag) throw new BadRequestException('De ontvangstdatum ligt in de toekomst.');
    const tht = String(input?.tht ?? '').trim() || null;
    if (p.thtNodig && !tht) throw new BadRequestException(`Geef de THT van ${p.naam}.`);
    if (tht && !isDatum(tht)) throw new BadRequestException('Geef een geldige THT-datum.');
    if (tht && tht < ontvangenOp) throw new BadRequestException('De THT ligt vóór de ontvangstdatum. Kijk de datum na.');
    let aankoopprijs: Prisma.Decimal | null = null;
    if (input?.aankoopprijs != null && String(input.aankoopprijs).trim() !== '') {
      const a = Number(String(input.aankoopprijs).replace(',', '.'));
      if (!Number.isFinite(a) || a < 0 || a > 100000) throw new BadRequestException('Geef een geldige aankoopprijs.');
      aankoopprijs = new Prisma.Decimal(Math.round(a * 100) / 100);
    }
    const locatie = await this.locatie(input?.locatieId);
    const opmerking = String(input?.opmerking ?? '').trim().slice(0, 200) || null;
    await this.prisma.$transaction([
      this.prisma.voorraadontvangst.create({
        data: { productId: p.id, locatieId: locatie.id, aantal: new Prisma.Decimal(aantal), ontvangenOp, tht, aankoopprijs, bron: input?.bron === 'FACTUUR' ? 'FACTUUR' : 'MANUEEL', opmerking, door: door ?? null },
      }),
      this.prisma.voorraad.upsert({
        where: { productId_locatieId: { productId: p.id, locatieId: locatie.id } },
        create: { productId: p.id, locatieId: locatie.id, aantal: new Prisma.Decimal(aantal) },
        update: { aantal: { increment: aantal } },
      }),
    ]);
    return this.artikel(p.id);
  }

  // Afboeken: weggegooid (THT verlopen), beschadigd, ... De voorraad gaat omlaag; wat er nog ligt
  // van de ontvangsten volgt vanzelf.
  async afboeken(input: { productId?: string; locatieId?: string; aantal?: unknown; reden?: string; opmerking?: string }, door?: string | null) {
    const p = await this.artikelMetVoorraad(input?.productId);
    const aantal = this.hoeveel(input?.aantal, p.eenheid, 'om af te boeken');
    const reden = (REDENEN as readonly string[]).includes(String(input?.reden)) ? String(input?.reden) : null;
    if (!reden) throw new BadRequestException('Kies een reden.');
    const locatie = await this.locatie(input?.locatieId);
    const opmerking = String(input?.opmerking ?? '').trim().slice(0, 200) || null;
    await this.prisma.$transaction([
      this.prisma.voorraad.upsert({
        where: { productId_locatieId: { productId: p.id, locatieId: locatie.id } },
        create: { productId: p.id, locatieId: locatie.id, aantal: new Prisma.Decimal(-aantal) },
        update: { aantal: { decrement: aantal } },
      }),
      this.prisma.voorraadcorrectie.create({ data: { productId: p.id, locatieId: locatie.id, aantal: new Prisma.Decimal(-aantal), reden, opmerking, door: door ?? null } }),
    ]);
    return this.artikel(p.id);
  }

  // Tellen: de getelde hoeveelheid wordt de voorraad; het verschil komt in het logboek.
  async tellen(input: { productId?: string; locatieId?: string; geteld?: unknown; opmerking?: string }, door?: string | null) {
    const p = await this.artikelMetVoorraad(input?.productId);
    const n = Number(String(input?.geteld ?? '').replace(',', '.'));
    if (String(input?.geteld ?? '').trim() === '' || !Number.isFinite(n) || n < 0 || n > 1000000) throw new BadRequestException('Geef het getelde aantal.');
    if (p.eenheid !== 'KG' && !Number.isInteger(n)) throw new BadRequestException('Dit artikel tel je per stuk.');
    const geteld = r3(n);
    const locatie = await this.locatie(input?.locatieId);
    const opmerking = String(input?.opmerking ?? '').trim().slice(0, 200) || null;
    await this.prisma.$transaction(async (tx) => {
      const sleutel = { productId_locatieId: { productId: p.id, locatieId: locatie.id } };
      await tx.voorraad.upsert({ where: sleutel, create: { productId: p.id, locatieId: locatie.id, aantal: new Prisma.Decimal(0) }, update: {} });
      // De rij vergrendelen: een verkoop tijdens het tellen mag niet verloren gaan.
      const rij = (await tx.$queryRaw`SELECT "aantal" FROM "Voorraad" WHERE "productId" = ${p.id} AND "locatieId" = ${locatie.id} FOR UPDATE`) as { aantal: Prisma.Decimal }[];
      const verschil = r3(geteld - Number(rij[0]?.aantal ?? 0));
      await tx.voorraad.update({ where: sleutel, data: { aantal: new Prisma.Decimal(geteld) } });
      if (verschil !== 0) {
        await tx.voorraadcorrectie.create({ data: { productId: p.id, locatieId: locatie.id, aantal: new Prisma.Decimal(verschil), reden: 'TELLING', opmerking, door: door ?? null } });
      }
    });
    return this.artikel(p.id);
  }

  async zetThtNodig(productId: string, thtNodig: unknown) {
    if (typeof thtNodig !== 'boolean') throw new BadRequestException('Ongeldige waarde.');
    const p = await this.artikelMetVoorraad(productId);
    await this.prisma.product.update({ where: { id: p.id }, data: { thtNodig } });
    return this.artikel(p.id);
  }

  // --- per artikel ---------------------------------------------------------------------------
  async artikel(productId: string) {
    const p = await this.prisma.product.findUnique({
      where: { id: String(productId ?? '') },
      select: { id: true, naam: true, eenheid: true, thtNodig: true, vrijePrijs: true, isStatiegeld: true, afdeling: { select: { naam: true } }, categorie: { select: { afdeling: { select: { naam: true } } } } },
    });
    if (!p) throw new NotFoundException('Artikel niet gevonden.');
    const [locaties, voorraad, loten, correcties, inst] = await Promise.all([
      this.locaties(),
      this.prisma.voorraad.findMany({ where: { productId: p.id } }),
      this.prisma.voorraadontvangst.findMany({ where: { productId: p.id }, orderBy: [{ ontvangenOp: 'desc' }, { createdAt: 'desc' }], take: 300 }),
      this.prisma.voorraadcorrectie.findMany({ where: { productId: p.id }, orderBy: { createdAt: 'desc' }, take: 30 }),
      this.instellingen(),
    ]);
    const vandaag = brusselVandaag();
    const restPerLot = new Map<string, number>();
    const perLocatie = locaties.map((l) => {
      const aantal = Number(voorraad.find((v) => v.locatieId === l.id)?.aantal ?? 0);
      const eigen = loten.filter((x) => x.locatieId === l.id).map((x) => ({ id: x.id, aantal: Number(x.aantal), tht: x.tht, ontvangenOp: x.ontvangenOp, createdAt: x.createdAt }));
      const { rest, zonderOntvangst } = VoorraadService.verdeel(aantal, eigen);
      rest.forEach((r, id) => restPerLot.set(id, r));
      return { id: l.id, naam: l.naam, type: l.type, aantal: r3(aantal), zonderOntvangst };
    });
    const naamVan = new Map(locaties.map((l) => [l.id, l.naam]));
    return {
      product: { id: p.id, naam: p.naam, eenheid: p.eenheid, thtNodig: p.thtNodig, heeftVoorraad: !p.vrijePrijs && !p.isStatiegeld, afdeling: p.afdeling?.naam ?? p.categorie?.afdeling?.naam ?? null },
      locaties: perLocatie,
      totaal: r3(perLocatie.reduce((s, l) => s + l.aantal, 0)),
      loten: loten.map((x) => {
        const rest = restPerLot.get(x.id) ?? 0;
        return {
          id: x.id, locatie: naamVan.get(x.locatieId) ?? '', ontvangenOp: x.ontvangenOp, tht: x.tht, aantal: Number(x.aantal), rest,
          aankoopprijs: x.aankoopprijs != null ? Number(x.aankoopprijs) : null, bron: x.bron, door: x.door, opmerking: x.opmerking,
          status: rest > 0 ? thtStatus(x.tht, vandaag, inst.alarmDagen) : null,
          dagenTotTht: x.tht ? dagenTussen(vandaag, x.tht) : null,
        };
      }),
      correcties: correcties.map((c) => ({ id: c.id, locatie: naamVan.get(c.locatieId) ?? '', aantal: Number(c.aantal), reden: c.reden, opmerking: c.opmerking, door: c.door, op: c.createdAt })),
      alarmDagen: inst.alarmDagen,
    };
  }

  // --- centrale lijst -------------------------------------------------------------------------
  async lijst(f: { zoek?: string; afdelingId?: string; filter?: string } = {}) {
    const zoek = String(f?.zoek ?? '').trim().slice(0, 80);
    const en: Prisma.ProductWhereInput[] = [];
    if (zoek) en.push({ OR: [{ naam: { contains: zoek, mode: 'insensitive' } }, { barcode: { contains: zoek } }, { interneCode: { contains: zoek, mode: 'insensitive' } }] });
    if (f?.afdelingId) en.push({ OR: [{ afdelingId: f.afdelingId }, { afdelingId: null, categorie: { afdelingId: f.afdelingId } }] });
    const producten = await this.prisma.product.findMany({
      where: { actief: true, vrijePrijs: false, isStatiegeld: false, ...(en.length ? { AND: en } : {}) },
      select: { id: true, naam: true, eenheid: true, thtNodig: true, afdeling: { select: { id: true, naam: true } }, categorie: { select: { afdeling: { select: { id: true, naam: true } } } } },
      orderBy: { naam: 'asc' },
    });
    const ids = producten.map((p) => p.id);
    const [locaties, voorraad, loten, inst] = await Promise.all([
      this.locaties(),
      ids.length ? this.prisma.voorraad.findMany({ where: { productId: { in: ids } } }) : Promise.resolve([]),
      ids.length ? this.prisma.voorraadontvangst.findMany({ where: { productId: { in: ids } }, select: { id: true, productId: true, locatieId: true, aantal: true, tht: true, ontvangenOp: true, createdAt: true } }) : Promise.resolve([]),
      this.instellingen(),
    ]);
    const vandaag = brusselVandaag();
    const grens = plusDagen(vandaag, inst.alarmDagen);
    const stock = new Map(voorraad.map((v) => [`${v.productId}|${v.locatieId}`, Number(v.aantal)]));
    const lotenPer = new Map<string, Lot[]>();
    for (const l of loten) {
      const k = `${l.productId}|${l.locatieId}`;
      const lijst = lotenPer.get(k) ?? [];
      lijst.push({ id: l.id, aantal: Number(l.aantal), tht: l.tht, ontvangenOp: l.ontvangenOp, createdAt: l.createdAt });
      lotenPer.set(k, lijst);
    }
    const alleRijen = producten.map((p) => {
      const perLocatie: Record<string, number> = {};
      let eerstvolgendeTht: string | null = null;
      let laatsteOntvangst: string | null = null;
      let zonderOntvangst = 0;
      for (const l of locaties) {
        const aantal = stock.get(`${p.id}|${l.id}`) ?? 0;
        if (aantal !== 0) perLocatie[l.id] = r3(aantal);
        const eigen = lotenPer.get(`${p.id}|${l.id}`) ?? [];
        const { rest, zonderOntvangst: z } = VoorraadService.verdeel(aantal, eigen);
        zonderOntvangst = r3(zonderOntvangst + z);
        for (const lot of eigen) {
          if (!laatsteOntvangst || lot.ontvangenOp > laatsteOntvangst) laatsteOntvangst = lot.ontvangenOp;
          if ((rest.get(lot.id) ?? 0) > 0 && lot.tht && (!eerstvolgendeTht || lot.tht < eerstvolgendeTht)) eerstvolgendeTht = lot.tht;
        }
      }
      const totaal = r3(Object.values(perLocatie).reduce((s, n) => s + n, 0));
      const status = !eerstvolgendeTht ? null : eerstvolgendeTht < vandaag ? 'VERLOPEN' : eerstvolgendeTht <= grens ? 'BIJNA' : 'OK';
      return {
        id: p.id, naam: p.naam, eenheid: p.eenheid, thtNodig: p.thtNodig,
        afdeling: p.afdeling?.naam ?? p.categorie?.afdeling?.naam ?? null,
        perLocatie, totaal, eerstvolgendeTht, dagenTotTht: eerstvolgendeTht ? dagenTussen(vandaag, eerstvolgendeTht) : null,
        status: status as ThtStatus | null, laatsteOntvangst, zonderOntvangst,
        negatief: Object.values(perLocatie).some((n) => n < 0),
      };
    });
    const telling = { verlopen: alleRijen.filter((r) => r.status === 'VERLOPEN').length, bijna: alleRijen.filter((r) => r.status === 'BIJNA').length };
    const filter = String(f?.filter ?? '');
    const rang = (r: (typeof alleRijen)[number]) => (r.status === 'VERLOPEN' ? 0 : r.status === 'BIJNA' ? 1 : 2);
    const rijen = alleRijen
      .filter((r) => filter === 'alarm' ? r.status === 'VERLOPEN' || r.status === 'BIJNA'
        : filter === 'voorraad' ? r.totaal > 0
        : filter === 'negatief' ? r.negatief
        : filter === 'zonderTht' ? r.thtNodig && r.zonderOntvangst > 0
        : true)
      .sort((a, b) => rang(a) - rang(b) || (a.status && b.status && a.eerstvolgendeTht && b.eerstvolgendeTht && a.eerstvolgendeTht !== b.eerstvolgendeTht ? (a.eerstvolgendeTht < b.eerstvolgendeTht ? -1 : 1) : 0) || a.naam.localeCompare(b.naam));
    return { locaties, alarmDagen: inst.alarmDagen, telling, rijen: rijen.slice(0, 3000), afgekapt: rijen.length > 3000 };
  }

  // --- THT-alarm --------------------------------------------------------------------------------
  async alarmen() {
    const { rijen, alarmDagen } = await this.lijst({ filter: 'alarm' });
    const kort = (r: (typeof rijen)[number]) => ({ id: r.id, naam: r.naam, tht: r.eerstvolgendeTht, dagen: r.dagenTotTht });
    return { alarmDagen, verlopen: rijen.filter((r) => r.status === 'VERLOPEN').map(kort), bijna: rijen.filter((r) => r.status === 'BIJNA').map(kort) };
  }

  // Laatste achtergrondcontrole (voor het scherm).
  async laatsteControle() {
    const i = await this.prisma.instelling.findUnique({ where: { sleutel: SLEUTEL_ALARM } });
    try { return i ? JSON.parse(i.waarde) as { datum: string; moment: string; verlopen: number; bijna: number; verstuurd?: number } : null; } catch { return null; }
  }

  private async tik() {
    if (this.bezig) return;
    this.bezig = true;
    try {
      if (brusselUur() < ALARM_UUR) return;
      if ((await this.laatsteControle())?.datum === brusselVandaag()) return;
      await this.controleer(true);
    } catch (e) {
      this.log.warn(`THT-controle mislukt: ${e instanceof Error ? e.message : e}`);
    } finally {
      this.bezig = false;
    }
  }

  // De telling op de achtergrond: wat ligt er nog, en wat is (bijna) over de THT? Is er iets,
  // dan een melding naar de beheerders (één keer per dag; ook met de hand te starten).
  async controleer(stuurMelding = true) {
    const a = await this.alarmen();
    let verstuurd = 0;
    if (stuurMelding && (a.verlopen.length || a.bijna.length)) {
      const delen = [
        a.verlopen.length ? `${a.verlopen.length} ${a.verlopen.length === 1 ? 'artikel' : 'artikels'} over de THT` : '',
        a.bijna.length ? `${a.bijna.length} binnen ${a.alarmDagen} ${a.alarmDagen === 1 ? 'dag' : 'dagen'}` : '',
      ].filter(Boolean).join(', ');
      const namen = [...a.verlopen, ...a.bijna].map((x) => x.naam);
      const voorbeeld = namen.slice(0, 3).join(', ') + (namen.length > 3 ? ` en ${namen.length - 3} meer` : '');
      try {
        const r = await this.push.naarBeheerders({ titel: 'THT-alarm', tekst: `${delen}: ${voorbeeld}.`, url: '/kassa/voorraad?alarm=1', tag: 'tht' });
        verstuurd = r.verstuurd;
      } catch (e) {
        this.log.warn(`THT-melding niet verstuurd: ${e instanceof Error ? e.message : e}`);
      }
    }
    const waarde = JSON.stringify({ datum: brusselVandaag(), moment: new Date().toISOString(), verlopen: a.verlopen.length, bijna: a.bijna.length, verstuurd });
    await this.prisma.instelling.upsert({ where: { sleutel: SLEUTEL_ALARM }, create: { sleutel: SLEUTEL_ALARM, waarde }, update: { waarde } });
    return { ...a, verstuurd };
  }
}
