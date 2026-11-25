import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from '../push/push.service';
import { verwerkAankoopprijs } from '../common/prijsfactor';

const DATUM = /^\d{4}-\d{2}-\d{2}$/;
const isDatum = (d: string) => DATUM.test(d) && !Number.isNaN(Date.parse(`${d}T12:00:00Z`)) && new Date(`${d}T12:00:00Z`).toISOString().slice(0, 10) === d;
const brusselVandaag = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Brussels' }).format(new Date());
const brusselUur = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', hour: '2-digit', hour12: false }).format(new Date()));
const plusDagen = (d: string, n: number) => new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
const dagenTussen = (van: string, tot: string) => Math.round((Date.parse(`${tot}T12:00:00Z`) - Date.parse(`${van}T12:00:00Z`)) / 86400000);
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const nl = (d: string | null) => (d ? d.split('-').reverse().join('/') : 'geen');
const hoeveelheidNl = (n: number, eenheid: string) => `${String(n).replace('.', ',')}${eenheid === 'KG' ? ' kg' : ''}`;

const SLEUTEL_INST = 'voorraad.instellingen';
const SLEUTEL_ALARM = 'voorraad.thtAlarm'; // laatste controle: { datum, moment, verlopen, bijna, verstuurd, klaar, pogingen }
const STANDAARD_ALARM_DAGEN = 3;
const CONTROLE_MS = 10 * 60 * 1000;
const ALARM_UUR = 7; // vanaf 07:00 (Brussel), één keer per dag
const MAX_POGINGEN = 6; // melding niet vertrokken: elke 10 minuten opnieuw, hoogstens 6 keer per dag
const MAX_HOUDBAAR = 3650; // THT meer dan 10 jaar na ontvangst: zeker een tikfout
export const REDENEN = ['THT_VERLOPEN', 'BESCHADIGD', 'ANDERE'] as const;

export type Lot = { id: string; aantal: number; tht: string | null; ontvangenOp: string; createdAt: Date };
export type ThtStatus = 'VERLOPEN' | 'BIJNA' | 'OK';
export type LaatsteControle = { datum: string; moment: string; verlopen: number; bijna: number; verstuurd?: number; klaar?: boolean; pogingen?: number };
const thtStatus = (tht: string | null, vandaag: string, alarmDagen: number): ThtStatus | null =>
  !tht ? null : tht < vandaag ? 'VERLOPEN' : tht <= plusDagen(vandaag, alarmDagen) ? 'BIJNA' : 'OK';
const alsLot = (x: { id: string; aantal: Prisma.Decimal; tht: string | null; ontvangenOp: string; createdAt: Date }): Lot =>
  ({ id: x.id, aantal: Number(x.aantal), tht: x.tht, ontvangenOp: x.ontvangenOp, createdAt: x.createdAt });

// bestaand: de THT registreren van wat er al ligt (zonder THT), zonder de voorraad te verhogen.
// thtBevestigd: de medewerker bevestigde een ongewoon late THT.
type OntvangstInput = {
  productId?: string; locatieId?: string; aantal?: unknown; ontvangenOp?: string; tht?: string | null; aankoopprijs?: unknown;
  opmerking?: string; bron?: string; bestaand?: boolean; thtBevestigd?: boolean;
};

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
  // zonderTht = wat er ligt zonder gekende THT: zonder ontvangst, of van een ontvangst zonder THT
  // (bv. ingelezen van een factuur).
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
    let zonderTht = over;
    for (const l of loten) if (!l.tht) zonderTht = r3(zonderTht + (rest.get(l.id) ?? 0));
    return { rest, zonderOntvangst: over, zonderTht };
  }

  // Mag een ontvangst zonder THT er nog een krijgen? Niet als registraties van "THT van wat er
  // ligt" (BESTAAND) al een deel van haar goederen dekken: dan zou dat deel twee THT's hebben.
  static thtInvulbaar(voorraad: number, loten: { id: string; aantal: Prisma.Decimal; tht: string | null; ontvangenOp: string; createdAt: Date; bron: string }[], lotId: string) {
    const met = VoorraadService.verdeel(voorraad, loten.map(alsLot)).rest.get(lotId) ?? 0;
    const zonder = VoorraadService.verdeel(voorraad, loten.filter((x) => x.bron !== 'BESTAAND').map(alsLot)).rest.get(lotId) ?? 0;
    return met >= zonder;
  }

  // Nog een THT-controle te doen vandaag? Niet als die van vandaag rond is; wel opnieuw (hoogstens
  // MAX_POGINGEN keer) als de melding niet vertrok. Oude registraties zonder 'klaar' zijn rond.
  static nogTeDoen(laatste: LaatsteControle | null, vandaag: string) {
    if (laatste?.datum !== vandaag) return true;
    return laatste.klaar === false && (laatste.pogingen ?? 0) < MAX_POGINGEN;
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

  // Een tikfout in het jaartal (2027 i.p.v. 2026) zou het alarm een jaar lang stilleggen. Ligt de
  // THT veel later dan bij vorige ontvangsten van dit artikel (zonder geschiedenis: meer dan een
  // jaar na ontvangst), dan eerst een bevestiging vragen; meer dan 10 jaar kan niet.
  private async controleerTht(p: { id: string; naam: string }, van: string, tht: string, bevestigd: boolean, behalveLot?: string) {
    const houdbaar = dagenTussen(van, tht);
    if (houdbaar > MAX_HOUDBAAR) throw new BadRequestException(`De THT (${nl(tht)}) ligt meer dan 10 jaar na de ontvangst. Kijk de datum na.`);
    if (bevestigd || houdbaar <= 0) return;
    const vorige = await this.prisma.voorraadontvangst.findMany({
      where: { productId: p.id, tht: { not: null }, geannuleerdOp: null, bron: { not: 'BESTAAND' }, ...(behalveLot ? { id: { not: behalveLot } } : {}) },
      orderBy: { createdAt: 'desc' }, take: 20, select: { ontvangenOp: true, tht: true },
    });
    const langste = vorige.reduce<number | null>((m, v) => { const d = dagenTussen(v.ontvangenOp, v.tht as string); return m == null || d > m ? d : m; }, null);
    // Een vaste marge van een half jaar: zo valt een jaar te veel ook op bij lang houdbare waren.
    const grens = langste == null ? 365 : langste + 180;
    if (houdbaar > grens) {
      throw new ConflictException({
        code: 'THT_BEVESTIGEN',
        message: langste == null
          ? `De THT van ${p.naam} (${nl(tht)}) ligt meer dan een jaar na de ontvangst. Klopt dat?`
          : `De THT van ${p.naam} (${nl(tht)}) ligt veel later dan bij vorige ontvangsten (tot nu toe hoogstens ${langste} dagen houdbaar). Klopt dat?`,
      });
    }
  }

  // --- ontvangen, afboeken, tellen --------------------------------------------------------
  // Gewone ontvangst: de voorraad gaat omhoog. Met 'bestaand': enkel de THT registreren van wat er
  // al ligt zonder THT (van vóór de registratie, of ingelezen van een factuur); de voorraad blijft.
  async ontvangst(input: OntvangstInput, door?: string | null) {
    const p = await this.artikelMetVoorraad(input?.productId);
    const bestaand = input?.bestaand === true;
    const aantal = this.hoeveel(input?.aantal, p.eenheid, bestaand ? 'voor deze THT' : 'om te ontvangen');
    const vandaag = brusselVandaag();
    const ontvangenOp = bestaand ? vandaag : String(input?.ontvangenOp ?? '').trim() || vandaag;
    if (!isDatum(ontvangenOp)) throw new BadRequestException('Geef een geldige ontvangstdatum.');
    if (ontvangenOp > vandaag) throw new BadRequestException('De ontvangstdatum ligt in de toekomst.');
    const tht = String(input?.tht ?? '').trim() || null;
    if ((p.thtNodig || bestaand) && !tht) throw new BadRequestException(`Geef de THT van ${p.naam}.`);
    if (tht && !isDatum(tht)) throw new BadRequestException('Geef een geldige THT-datum.');
    // Wat er al ligt, kan al over de THT zijn (dan meteen alarm); een jaar of meer is een tikfout.
    if (tht && bestaand && tht < plusDagen(vandaag, -365)) throw new BadRequestException(`De THT (${nl(tht)}) ligt meer dan een jaar in het verleden. Kijk de datum na.`);
    if (tht && !bestaand && tht < ontvangenOp) throw new BadRequestException('De THT ligt vóór de ontvangstdatum. Kijk de datum na.');
    if (tht) await this.controleerTht(p, ontvangenOp, tht, input?.thtBevestigd === true);
    let aankoop: number | null = null;
    if (!bestaand && input?.aankoopprijs != null && String(input.aankoopprijs).trim() !== '') {
      const a = Number(String(input.aankoopprijs).replace(',', '.'));
      if (!Number.isFinite(a) || a < 0 || a > 100000) throw new BadRequestException('Geef een geldige aankoopprijs.');
      aankoop = Math.round(a * 100) / 100;
    }
    const locatie = await this.locatie(input?.locatieId);
    const opmerking = String(input?.opmerking ?? '').trim().slice(0, 200) || null;
    const bron = bestaand ? 'BESTAAND' : input?.bron === 'FACTUUR' ? 'FACTUUR' : 'MANUEEL';
    const prijs = await this.prisma.$transaction(async (tx) => {
      if (bestaand) {
        // De rij vergrendelen (zoals bij tellen) en nagaan hoeveel er hier zonder THT ligt: nooit
        // meer THT registreren dan er werkelijk ligt.
        const rij = (await tx.$queryRaw`SELECT "aantal" FROM "Voorraad" WHERE "productId" = ${p.id} AND "locatieId" = ${locatie.id} FOR UPDATE`) as { aantal: Prisma.Decimal }[];
        const loten = await tx.voorraadontvangst.findMany({ where: { productId: p.id, locatieId: locatie.id, geannuleerdOp: null } });
        const { zonderTht } = VoorraadService.verdeel(Number(rij[0]?.aantal ?? 0), loten.map(alsLot));
        if (aantal > zonderTht) {
          throw new BadRequestException(zonderTht > 0
            ? `Op ${locatie.naam} ligt maar ${hoeveelheidNl(zonderTht, p.eenheid)} zonder THT. Ligt er meer? Tel het artikel eerst.`
            : `Op ${locatie.naam} ligt niets zonder THT. Ligt er meer? Tel het artikel eerst.`);
        }
      }
      await tx.voorraadontvangst.create({
        data: { productId: p.id, locatieId: locatie.id, aantal: new Prisma.Decimal(aantal), ontvangenOp, tht, aankoopprijs: aankoop != null ? new Prisma.Decimal(aankoop) : null, bron, opmerking, door: door ?? null },
      });
      if (bestaand) return null;
      await tx.voorraad.upsert({
        where: { productId_locatieId: { productId: p.id, locatieId: locatie.id } },
        create: { productId: p.id, locatieId: locatie.id, aantal: new Prisma.Decimal(aantal) },
        update: { aantal: { increment: aantal } },
      });
      // Hogere aankoopprijs: wordt de nieuwe aankoopprijs; met een factor stijgt de verkoopprijs mee.
      return aankoop != null && aankoop > 0 ? verwerkAankoopprijs(tx, p.id, aankoop) : null;
    });
    return {
      ...(await this.artikel(p.id)),
      prijsWijziging: prijs?.gewijzigd ? { oudeInkoop: prijs.oudeInkoop, inkoopprijs: prijs.inkoopprijs, oudeVerkoop: prijs.oudeVerkoop, verkoopprijs: prijs.verkoopprijs } : null,
    };
  }

  // Een ontvangst verbeteren (THT, ontvangstdatum, opmerking), bv. een tikfout in de THT of een
  // THT aanvullen bij een ingelezen factuur. De voorraad verandert niet; de wijziging komt in het logboek.
  async wijzigOntvangst(id: string, input: { tht?: string | null; ontvangenOp?: string; opmerking?: string | null; thtBevestigd?: boolean }, door?: string | null) {
    const lot = await this.prisma.voorraadontvangst.findUnique({ where: { id: String(id ?? '') } });
    if (!lot) throw new NotFoundException('Ontvangst niet gevonden.');
    if (lot.geannuleerdOp) throw new BadRequestException('Deze ontvangst is geannuleerd.');
    const p = await this.artikelMetVoorraad(lot.productId);
    const bestaand = lot.bron === 'BESTAAND';
    const vandaag = brusselVandaag();
    // Bij 'bestaand' is de datum die van de registratie: die blijft.
    const ontvangenOp = input?.ontvangenOp !== undefined && !bestaand ? String(input.ontvangenOp ?? '').trim() : lot.ontvangenOp;
    if (!isDatum(ontvangenOp)) throw new BadRequestException('Geef een geldige ontvangstdatum.');
    if (ontvangenOp > vandaag) throw new BadRequestException('De ontvangstdatum ligt in de toekomst.');
    const tht = input?.tht !== undefined ? String(input.tht ?? '').trim() || null : lot.tht;
    if ((p.thtNodig || bestaand) && !tht) throw new BadRequestException(`Geef de THT van ${p.naam}.`);
    if (tht && !isDatum(tht)) throw new BadRequestException('Geef een geldige THT-datum.');
    if (tht && bestaand && tht < plusDagen(lot.ontvangenOp, -365)) throw new BadRequestException(`De THT (${nl(tht)}) ligt meer dan een jaar in het verleden. Kijk de datum na.`);
    if (tht && !bestaand && tht < ontvangenOp) throw new BadRequestException('De THT ligt vóór de ontvangstdatum. Kijk de datum na.');
    const opmerking = input?.opmerking !== undefined ? String(input.opmerking ?? '').trim().slice(0, 200) || null : lot.opmerking;
    const wat: string[] = [];
    if (tht !== lot.tht) wat.push(`THT ${nl(lot.tht)} → ${nl(tht)}`);
    if (ontvangenOp !== lot.ontvangenOp) wat.push(`ontvangen ${nl(lot.ontvangenOp)} → ${nl(ontvangenOp)}`);
    if (opmerking !== lot.opmerking) wat.push('opmerking aangepast');
    if (!wat.length) return this.artikel(p.id);
    if (tht && (tht !== lot.tht || ontvangenOp !== lot.ontvangenOp)) await this.controleerTht(p, ontvangenOp, tht, input?.thtBevestigd === true, lot.id);
    await this.prisma.$transaction(async (tx) => {
      if (!lot.tht && tht) {
        // Een THT invullen bij een ontvangst zonder THT (bv. een factuur): niet als een deel van die
        // goederen al een THT kreeg via "THT van wat er ligt", anders tellen ze dubbel en kan een
        // vroegere THT uit beeld verdwijnen. Zelfde vergrendeling als bij tellen en registreren.
        const rij = (await tx.$queryRaw`SELECT "aantal" FROM "Voorraad" WHERE "productId" = ${lot.productId} AND "locatieId" = ${lot.locatieId} FOR UPDATE`) as { aantal: Prisma.Decimal }[];
        const loten = await tx.voorraadontvangst.findMany({ where: { productId: lot.productId, locatieId: lot.locatieId, geannuleerdOp: null } });
        if (!VoorraadService.thtInvulbaar(Number(rij[0]?.aantal ?? 0), loten, lot.id)) {
          throw new BadRequestException(`Een deel van deze ontvangst kreeg al een THT via "THT van wat er ligt". Registreer de THT van wat nog zonder THT ligt daar.`);
        }
      }
      // Enkel als de ontvangst intussen niet veranderde (geannuleerd, of een andere THT op een ander toestel).
      const r = await tx.voorraadontvangst.updateMany({ where: { id: lot.id, geannuleerdOp: null, tht: lot.tht }, data: { tht, ontvangenOp, opmerking } });
      if (r.count !== 1) throw new BadRequestException('Deze ontvangst is intussen gewijzigd of geannuleerd. Laad het artikel opnieuw.');
      await tx.voorraadcorrectie.create({
        data: { productId: p.id, locatieId: lot.locatieId, aantal: new Prisma.Decimal(0), reden: 'ONTVANGST_GEWIJZIGD', opmerking: `Ontvangst van ${nl(lot.ontvangenOp)}: ${wat.join(', ')}`.slice(0, 200), door: door ?? null },
      });
    });
    return this.artikel(p.id);
  }

  // Een ontvangst annuleren (dubbel ingegeven, verkeerd artikel...): enkel een beheerder. De
  // ontvangst telt niet meer mee en de voorraad gaat met dat aantal omlaag. Niet bij 'bestaand'
  // (die verhoogde de voorraad ook niet) en niet als er na de ontvangst geteld werd: de telling
  // zette de voorraad al juist. Prijzen blijven zoals ze zijn.
  async annuleerOntvangst(id: string, door?: string | null) {
    const lot = await this.prisma.voorraadontvangst.findUnique({ where: { id: String(id ?? '') } });
    if (!lot) throw new NotFoundException('Ontvangst niet gevonden.');
    if (lot.geannuleerdOp) throw new BadRequestException('Deze ontvangst is al geannuleerd.');
    const bestaand = lot.bron === 'BESTAAND';
    const aantal = Number(lot.aantal);
    await this.prisma.$transaction(async (tx) => {
      // Zelfde vergrendeling als tellen: een telling tijdens het annuleren wacht of gaat voor.
      await tx.$queryRaw`SELECT 1 FROM "Voorraad" WHERE "productId" = ${lot.productId} AND "locatieId" = ${lot.locatieId} FOR UPDATE`;
      const telling = bestaand ? null : await tx.voorraadcorrectie.findFirst({
        where: { productId: lot.productId, locatieId: lot.locatieId, reden: 'TELLING', createdAt: { gt: lot.createdAt } },
        orderBy: { createdAt: 'desc' },
      });
      const terugboeken = !bestaand && !telling;
      const r = await tx.voorraadontvangst.updateMany({ where: { id: lot.id, geannuleerdOp: null }, data: { geannuleerdOp: new Date(), geannuleerdDoor: door ?? null } });
      if (r.count !== 1) throw new BadRequestException('Deze ontvangst is al geannuleerd.');
      if (terugboeken) {
        await tx.voorraad.upsert({
          where: { productId_locatieId: { productId: lot.productId, locatieId: lot.locatieId } },
          create: { productId: lot.productId, locatieId: lot.locatieId, aantal: new Prisma.Decimal(-aantal) },
          update: { aantal: { decrement: aantal } },
        });
      }
      const waarom = bestaand ? ', voorraad ongewijzigd'
        : telling ? `, voorraad ongewijzigd (geteld op ${telling.createdAt.toLocaleDateString('nl-BE', { timeZone: 'Europe/Brussels' })}, na de ontvangst)` : '';
      await tx.voorraadcorrectie.create({
        data: {
          productId: lot.productId, locatieId: lot.locatieId, aantal: new Prisma.Decimal(terugboeken ? -aantal : 0), reden: 'ONTVANGST_GEANNULEERD',
          opmerking: `Ontvangst van ${nl(lot.ontvangenOp)}${lot.tht ? ` (THT ${nl(lot.tht)})` : ''}${waarom}`.slice(0, 200), door: door ?? null,
        },
      });
    });
    return this.artikel(lot.productId);
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
      select: { id: true, naam: true, eenheid: true, thtNodig: true, vrijePrijs: true, isStatiegeld: true, inkoopprijs: true, verkoopprijs: true, factor: true, afdeling: { select: { naam: true } }, categorie: { select: { afdeling: { select: { naam: true } } } } },
    });
    if (!p) throw new NotFoundException('Artikel niet gevonden.');
    const [locaties, voorraad, alleLoten, correcties, inst, tellingen] = await Promise.all([
      this.locaties(),
      this.prisma.voorraad.findMany({ where: { productId: p.id } }),
      this.prisma.voorraadontvangst.findMany({ where: { productId: p.id }, orderBy: [{ ontvangenOp: 'desc' }, { createdAt: 'desc' }] }),
      this.prisma.voorraadcorrectie.findMany({ where: { productId: p.id }, orderBy: { createdAt: 'desc' }, take: 30 }),
      this.instellingen(),
      this.prisma.voorraadcorrectie.groupBy({ by: ['locatieId'], where: { productId: p.id, reden: 'TELLING' }, _max: { createdAt: true } }),
    ]);
    const vandaag = brusselVandaag();
    const restPerLot = new Map<string, number>();
    const invulbaar = new Set<string>(); // ontvangsten zonder THT die er nog een mogen krijgen
    const laatsteTelling = new Map(tellingen.map((t) => [t.locatieId, t._max.createdAt]));
    const actief = alleLoten.filter((x) => !x.geannuleerdOp);
    const perLocatie = locaties.map((l) => {
      const aantal = Number(voorraad.find((v) => v.locatieId === l.id)?.aantal ?? 0);
      const hier = actief.filter((x) => x.locatieId === l.id);
      const { rest, zonderOntvangst, zonderTht } = VoorraadService.verdeel(aantal, hier.map(alsLot));
      rest.forEach((r, id) => restPerLot.set(id, r));
      for (const x of hier) if (!x.tht && VoorraadService.thtInvulbaar(aantal, hier, x.id)) invulbaar.add(x.id);
      return { id: l.id, naam: l.naam, type: l.type, aantal: r3(aantal), zonderOntvangst, zonderTht };
    });
    const naamVan = new Map(locaties.map((l) => [l.id, l.naam]));
    // Alles wat er nog ligt, plus de recentste andere (ook geannuleerde) voor de geschiedenis.
    let anderen = 0;
    const loten = alleLoten.filter((x) => (restPerLot.get(x.id) ?? 0) > 0 || anderen++ < 100);
    return {
      product: {
        id: p.id, naam: p.naam, eenheid: p.eenheid, thtNodig: p.thtNodig, heeftVoorraad: !p.vrijePrijs && !p.isStatiegeld, afdeling: p.afdeling?.naam ?? p.categorie?.afdeling?.naam ?? null,
        inkoopprijs: p.inkoopprijs != null ? Number(p.inkoopprijs) : null, verkoopprijs: Number(p.verkoopprijs), factor: p.factor != null ? Number(p.factor) : null,
      },
      locaties: perLocatie,
      totaal: r3(perLocatie.reduce((s, l) => s + l.aantal, 0)),
      loten: loten.map((x) => {
        const rest = restPerLot.get(x.id) ?? 0;
        return {
          id: x.id, locatie: naamVan.get(x.locatieId) ?? '', ontvangenOp: x.ontvangenOp, tht: x.tht, aantal: Number(x.aantal), rest,
          aankoopprijs: x.aankoopprijs != null ? Number(x.aankoopprijs) : null, bron: x.bron, door: x.door, opmerking: x.opmerking,
          status: rest > 0 ? thtStatus(x.tht, vandaag, inst.alarmDagen) : null,
          dagenTotTht: x.tht ? dagenTussen(vandaag, x.tht) : null,
          geannuleerd: !!x.geannuleerdOp, geannuleerdOp: x.geannuleerdOp, geannuleerdDoor: x.geannuleerdDoor,
          thtInvulbaar: invulbaar.has(x.id),
          // Na deze ontvangst geteld: annuleren verandert de voorraad dan niet meer.
          geteldNa: !!(laatsteTelling.get(x.locatieId) && (laatsteTelling.get(x.locatieId) as Date) > x.createdAt),
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
      ids.length ? this.prisma.voorraadontvangst.findMany({ where: { productId: { in: ids }, geannuleerdOp: null }, select: { id: true, productId: true, locatieId: true, aantal: true, tht: true, ontvangenOp: true, createdAt: true, bron: true } }) : Promise.resolve([]),
      this.instellingen(),
    ]);
    const vandaag = brusselVandaag();
    const grens = plusDagen(vandaag, inst.alarmDagen);
    const stock = new Map(voorraad.map((v) => [`${v.productId}|${v.locatieId}`, Number(v.aantal)]));
    const lotenPer = new Map<string, (Lot & { bron: string })[]>();
    for (const l of loten) {
      const k = `${l.productId}|${l.locatieId}`;
      const lijst = lotenPer.get(k) ?? [];
      lijst.push({ ...alsLot(l), bron: l.bron });
      lotenPer.set(k, lijst);
    }
    const alleRijen = producten.map((p) => {
      const perLocatie: Record<string, number> = {};
      let eerstvolgendeTht: string | null = null;
      let laatsteOntvangst: string | null = null;
      let zonderOntvangst = 0;
      let zonderTht = 0;
      for (const l of locaties) {
        const aantal = stock.get(`${p.id}|${l.id}`) ?? 0;
        if (aantal !== 0) perLocatie[l.id] = r3(aantal);
        const eigen = lotenPer.get(`${p.id}|${l.id}`) ?? [];
        const v = VoorraadService.verdeel(aantal, eigen);
        zonderOntvangst = r3(zonderOntvangst + v.zonderOntvangst);
        zonderTht = r3(zonderTht + v.zonderTht);
        for (const lot of eigen) {
          // Een THT registreren voor wat er al lag, is geen levering.
          if (lot.bron !== 'BESTAAND' && (!laatsteOntvangst || lot.ontvangenOp > laatsteOntvangst)) laatsteOntvangst = lot.ontvangenOp;
          if ((v.rest.get(lot.id) ?? 0) > 0 && lot.tht && (!eerstvolgendeTht || lot.tht < eerstvolgendeTht)) eerstvolgendeTht = lot.tht;
        }
      }
      const totaal = r3(Object.values(perLocatie).reduce((s, n) => s + n, 0));
      const status = !eerstvolgendeTht ? null : eerstvolgendeTht < vandaag ? 'VERLOPEN' : eerstvolgendeTht <= grens ? 'BIJNA' : 'OK';
      return {
        id: p.id, naam: p.naam, eenheid: p.eenheid, thtNodig: p.thtNodig,
        afdeling: p.afdeling?.naam ?? p.categorie?.afdeling?.naam ?? null,
        perLocatie, totaal, eerstvolgendeTht, dagenTotTht: eerstvolgendeTht ? dagenTussen(vandaag, eerstvolgendeTht) : null,
        status: status as ThtStatus | null, laatsteOntvangst, zonderOntvangst, zonderTht,
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
        : filter === 'zonderTht' ? r.thtNodig && r.zonderTht > 0
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
  async laatsteControle(): Promise<LaatsteControle | null> {
    const i = await this.prisma.instelling.findUnique({ where: { sleutel: SLEUTEL_ALARM } });
    try { return i ? JSON.parse(i.waarde) as LaatsteControle : null; } catch { return null; }
  }

  private async tik() {
    if (this.bezig) return;
    this.bezig = true;
    try {
      if (brusselUur() < ALARM_UUR) return;
      if (!VoorraadService.nogTeDoen(await this.laatsteControle(), brusselVandaag())) return;
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
    let klaar = true; // false = er was iets te melden, maar de melding kwam nergens aan: later opnieuw
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
        // Geen enkel toestel ingeschreven: niets om te herhalen. Wel toestellen, maar nergens aangekomen: opnieuw.
        klaar = r.verstuurd > 0 || !r.toestellen;
      } catch (e) {
        klaar = false;
        this.log.warn(`THT-melding niet verstuurd: ${e instanceof Error ? e.message : e}`);
      }
    }
    const vandaag = brusselVandaag();
    const vorige = await this.laatsteControle();
    const pogingen = (vorige?.datum === vandaag ? vorige.pogingen ?? 1 : 0) + 1;
    const waarde = JSON.stringify({ datum: vandaag, moment: new Date().toISOString(), verlopen: a.verlopen.length, bijna: a.bijna.length, verstuurd, klaar, pogingen });
    await this.prisma.instelling.upsert({ where: { sleutel: SLEUTEL_ALARM }, create: { sleutel: SLEUTEL_ALARM, waarde }, update: { waarde } });
    return { ...a, verstuurd };
  }
}
