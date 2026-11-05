import { Injectable, BadRequestException, HttpException, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { WebshopBetaling } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { lijnCent, SalesService } from '../sales/sales.service';
import { AgendaService } from '../agenda/agenda.service';
import { MailService } from '../mail/mail.service';
import { kassadag } from '../common/kassadag';
import { MollieBetaling, MollieService } from './mollie.service';

// Publieke webshop-catalogus. Toont ENKEL producten die actief zijn én
// als "toon in webshop" gemarkeerd staan. Een product offline zetten aan de
// kassa (actief=false) haalt het dus automatisch uit de webshop.
// Vrije bedragen (diversen, cadeaubon), statiegeldsoorten en artikelen zonder prijs zijn nooit bestelbaar.
const WEBSHOP_WHERE = { actief: true, webshopZichtbaar: true, vrijePrijs: false, isStatiegeld: false, verkoopprijs: { gt: 0 } };

export type BestellingInput = {
  lijnen: { productId: string; aantal: number }[];
  klant: { naam: string; email: string; telefoon?: string; adres?: string };
  leverwijze: 'AFHALEN' | 'LEVEREN';
  gewensteDag?: string;  // gewenste afhaal-/leverdatum (YYYY-MM-DD), verplicht
  gewensteTijd?: string; // gewenst uur (HH:MM), optioneel
};
export type HerroepingInput = { naam: string; email: string; bestelling: string; toelichting?: string };
type BetaalLijn = { productId: string; naam: string; aantal: number; eenheidsprijs: number; totaal: number; isStatiegeld: boolean };
// Een dag in de webshopkalender, zoals hij voor de klant geldt. van/tot enkel op gewone open dagen.
type KalenderDag = { iso: string; winkelOpen: boolean; afhalen: boolean; leveren: boolean; van: string | null; tot: string | null; afhalenAangepast: boolean; leverenAangepast: boolean };

const STATUSSEN = ['NIEUW', 'IN_BEHANDELING', 'KLAAR', 'AFGEHAALD', 'GELEVERD', 'GEANNULEERD'];
const MAX_LIJNEN = 100;
const MAX_AANTAL = 999;
const REM_MAX = 10; // formulieren per bezoeker per REM_MS
const REM_MS = 10 * 60 * 1000;
const CONTROLE_MS = 10 * 60 * 1000; // open betalingen nakijken, voor het geval een webhook niet aankomt
const BEWAAR_POGING_MS = 30 * 24 * 3600 * 1000; // betaalpogingen wissen (staat zo in de privacyverklaring)
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Betaalmethoden die niet meteen betaald melden: de bestelling zou pas dagen later doorkomen.
const TRAGE_METHODEN = ['banktransfer', 'klarna', 'billie', 'riverty'];
const DAGEN_VOORUIT = 120; // zo ver vooruit kan een klant een dag kiezen
const SLEUTEL_DAGEN_VOORAF = 'webshop.dagenVooraf';
const STANDAARD_DAGEN_VOORAF = 2; // klantregel: minstens 2 dagen op voorhand bestellen

const brusselVandaag = () => kassadag(new Date());
const brusselUur = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' }).format(new Date());
const brusselMoment = (d: Date) => d.toLocaleString('nl-BE', { timeZone: 'Europe/Brussels', dateStyle: 'long', timeStyle: 'short' });
const plusDagen = (d: string, n: number) => new Date(new Date(`${d}T12:00:00Z`).getTime() + n * 24 * 3600 * 1000).toISOString().slice(0, 10);
const weekdagVan = (d: string) => ((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7) + 1; // 1 = maandag
const dagNaam = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('nl-BE', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long' });
const isDatum = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(`${d}T12:00:00Z`).toISOString().slice(0, 10) === d;
const euro = (n: number) => '€ ' + n.toFixed(2).replace('.', ',');
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const bestelnummerVan = (id: string) => 'W-' + id.slice(-8).toUpperCase();
const siteUrl = () => (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || 'https://kassa-5w5f.onrender.com').replace(/\/$/, '');
const isMollieBetaling = (ref?: string | null) => !!ref?.startsWith('tr_');

// Vrije tekst uit een publiek formulier: opgekuist en begrensd.
function veld(waarde: unknown, naam: string, max: number) {
  const s = String(waarde ?? '').trim();
  if (s.length > max) throw new BadRequestException(`${naam} is te lang.`);
  return s;
}

@Injectable()
export class WebshopService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(WebshopService.name);
  private readonly pogingen = new Map<string, number[]>();
  private timer?: NodeJS.Timeout;

  constructor(private prisma: PrismaService, private sales: SalesService, private agenda: AgendaService, private mail: MailService, private mollie: MollieService) {}

  onModuleInit() {
    this.timer = setInterval(() => { void this.controleerOpenBetalingen(); }, CONTROLE_MS);
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // Rem per bezoeker tegen geautomatiseerd misbruik van de publieke formulieren. Eén
  // server, dus bijhouden in het geheugen volstaat.
  rem(bezoeker: string) {
    const nu = Date.now();
    const recent = (this.pogingen.get(bezoeker) ?? []).filter((t) => nu - t < REM_MS);
    if (recent.length >= REM_MAX) throw new HttpException('Te veel pogingen na elkaar. Probeer het over enkele minuten opnieuw of bel ons.', 429);
    if (this.pogingen.size > 5000) this.pogingen.clear();
    this.pogingen.set(bezoeker, [...recent, nu]);
  }

  // Wat de publieke webshop moet weten: kan er besteld worden, en is het een test?
  instellingen() {
    return { betalen: this.mollie.modus() };
  }

  // Voor het personeel: staat de koppeling goed, en welke betaalmethoden staan aan?
  async mollieStatus() {
    const modus = this.mollie.modus();
    if (modus === 'UIT') return { modus, methoden: [], trageMethoden: [], fout: null };
    try {
      const methoden = await this.mollie.methoden();
      return {
        modus, fout: null,
        methoden: methoden.map((m) => m.description),
        trageMethoden: methoden.filter((m) => TRAGE_METHODEN.includes(m.id)).map((m) => m.description),
      };
    } catch (e) {
      return { modus, methoden: [], trageMethoden: [], fout: e instanceof Error ? e.message : 'Mollie is niet bereikbaar.' };
    }
  }

  producten(afdelingId?: string) {
    return this.prisma.product.findMany({
      where: { ...WEBSHOP_WHERE, ...(afdelingId ? { afdelingId } : {}) },
      select: {
        id: true, naam: true, omschrijving: true, verkoopprijs: true, isAlcohol: true, eenheid: true,
        allergenen: true, afdelingId: true, fotoUrl: true,
        afdeling: { select: { id: true, naam: true, volgorde: true } },
        categorie: { select: { id: true, naam: true } },
        statiegeld: { select: { id: true, naam: true, verkoopprijs: true } },
      },
      orderBy: [{ naam: 'asc' }],
    });
  }

  // Afdelingen die minstens één webshop-product bevatten (voor de menu-tegels).
  async afdelingen() {
    const producten = await this.prisma.product.findMany({
      where: { ...WEBSHOP_WHERE, afdelingId: { not: null } },
      select: { afdeling: { select: { id: true, naam: true, volgorde: true } } },
    });
    const map = new Map<string, { id: string; naam: string; volgorde: number; aantal: number }>();
    for (const p of producten) {
      if (!p.afdeling) continue;
      const r = map.get(p.afdeling.id) ?? { ...p.afdeling, aantal: 0 };
      r.aantal++;
      map.set(p.afdeling.id, r);
    }
    return [...map.values()].sort((a, b) => a.volgorde - b.volgorde || a.naam.localeCompare(b.naam));
  }

  // Enkel wat online staat, in een geldig aantal: de kassa laat negatieve aantallen toe
  // (retour) en kent alle artikels, de publieke webshop dus niet. De prijs komt altijd van
  // de server, en zoals aan de kassa dragen stukartikels hun statiegeld automatisch mee.
  private async stelMandjeSamen(invoer: BestellingInput['lijnen']) {
    if (!Array.isArray(invoer) || !invoer.length) throw new BadRequestException('Je winkelmandje is leeg.');
    if (invoer.length > MAX_LIJNEN) throw new BadRequestException('Je mandje bevat te veel verschillende artikels. Neem contact met ons op.');
    const ids = [...new Set(invoer.map((l) => String(l?.productId ?? '')))];
    const producten = await this.prisma.product.findMany({
      where: { ...WEBSHOP_WHERE, id: { in: ids } },
      select: { id: true, naam: true, eenheid: true, verkoopprijs: true, statiegeld: { select: { id: true, naam: true, verkoopprijs: true } } },
    });
    const perId = new Map(producten.map((p) => [p.id, p]));
    const samen = new Map<string, Omit<BetaalLijn, 'totaal'>>();
    const tel = (productId: string, naam: string, prijs: number, aantal: number, isStatiegeld: boolean) => {
      const bestaand = samen.get(productId);
      if (bestaand) bestaand.aantal = Math.round((bestaand.aantal + aantal) * 1000) / 1000;
      else samen.set(productId, { productId, naam, eenheidsprijs: prijs, aantal, isStatiegeld });
    };
    for (const l of invoer) {
      const p = perId.get(String(l?.productId ?? ''));
      if (!p) throw new BadRequestException('Een artikel in je mandje is niet meer beschikbaar. Vernieuw de pagina en probeer opnieuw.');
      const aantal = Number(l.aantal);
      if (!Number.isFinite(aantal) || aantal <= 0 || aantal > MAX_AANTAL) throw new BadRequestException(`Ongeldig aantal voor ${p.naam}.`);
      if (p.eenheid !== 'KG' && !Number.isInteger(aantal)) throw new BadRequestException(`${p.naam} bestel je per stuk.`);
      const hoeveel = p.eenheid === 'KG' ? Math.round(aantal * 1000) / 1000 : aantal;
      if (hoeveel <= 0) throw new BadRequestException(`Ongeldig aantal voor ${p.naam}.`);
      tel(p.id, p.naam, Number(p.verkoopprijs), hoeveel, false);
      if (p.statiegeld && p.eenheid !== 'KG') tel(p.statiegeld.id, p.statiegeld.naam, Number(p.statiegeld.verkoopprijs), hoeveel, true);
    }
    const lijnen: BetaalLijn[] = [...samen.values()].map((l) => {
      if (!l.isStatiegeld && l.aantal > MAX_AANTAL) throw new BadRequestException(`Ongeldig aantal voor ${l.naam}.`);
      return { ...l, totaal: lijnCent(l.eenheidsprijs, l.aantal) / 100 };
    });
    const totaalCent = [...samen.values()].reduce((s, l) => s + lijnCent(l.eenheidsprijs, l.aantal), 0);
    return { lijnen, totaal: totaalCent / 100 };
  }

  // --- Webshopkalender ---------------------------------------------------------------

  // Hoeveel dagen op voorhand een klant minstens moet bestellen (instelbaar in de kalender).
  async dagenVooraf() {
    const i = await this.prisma.instelling.findUnique({ where: { sleutel: SLEUTEL_DAGEN_VOORAF } });
    const n = i ? Number(i.waarde) : NaN;
    return Number.isInteger(n) && n >= 0 ? n : STANDAARD_DAGEN_VOORAF;
  }

  async zetDagenVooraf(waarde: unknown) {
    const n = Number(waarde);
    if (!Number.isInteger(n) || n < 0 || n > 30) throw new BadRequestException('Geef een aantal dagen tussen 0 en 30.');
    await this.prisma.instelling.upsert({ where: { sleutel: SLEUTEL_DAGEN_VOORAF }, create: { sleutel: SLEUTEL_DAGEN_VOORAF, waarde: String(n) }, update: { waarde: String(n) } });
    return { dagenVooraf: n };
  }

  // Afhalen en leveren per dag: standaard afhalen op dagen dat de winkel open is en nergens
  // leveren; wat in de webshopkalender voor een dag ingesteld is, gaat voor.
  private async kalenderDagen(van: string, aantal: number): Promise<KalenderDag[]> {
    const [uren, rijen] = await Promise.all([
      this.prisma.openingsuur.findMany(),
      this.prisma.webshopdag.findMany({ where: { datum: { gte: van, lte: plusDagen(van, aantal - 1) } } }),
    ]);
    const perWeekdag = new Map(uren.map((u) => [u.dag, u]));
    const perDatum = new Map(rijen.map((r) => [r.datum, r]));
    return Array.from({ length: aantal }, (_, i) => {
      const iso = plusDagen(van, i);
      const u = perWeekdag.get(weekdagVan(iso));
      const winkelOpen = !u?.gesloten;
      const r = perDatum.get(iso);
      return {
        iso, winkelOpen,
        afhalen: r?.afhalen ?? winkelOpen,
        leveren: r?.leveren ?? false,
        van: winkelOpen ? u?.van ?? null : null,
        tot: winkelOpen ? u?.tot ?? null : null,
        afhalenAangepast: r?.afhalen != null,
        leverenAangepast: r?.leveren != null,
      };
    });
  }

  // Publiek: de dagen waarop een klant kan afhalen of laten leveren.
  async beschikbareDagen() {
    const dagenVooraf = await this.dagenVooraf();
    const vandaag = brusselVandaag();
    const nu = brusselUur();
    const dagen = await this.kalenderDagen(plusDagen(vandaag, dagenVooraf), DAGEN_VOORUIT);
    return {
      dagenVooraf,
      dagen: dagen
        .map((d) => ({ ...d, afhalen: d.afhalen && !(d.iso === vandaag && d.tot && nu >= d.tot) })) // vandaag al dicht (bij 0 dagen vooraf)
        .filter((d) => d.afhalen || d.leveren)
        .map(({ iso, afhalen, leveren, van, tot }) => ({ iso, afhalen, leveren, van, tot })),
    };
  }

  // Beheer: een maand van de kalender.
  async kalender(maand: string) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(maand))) throw new BadRequestException('Geef een maand (JJJJ-MM).');
    const aantal = new Date(Date.UTC(Number(maand.slice(0, 4)), Number(maand.slice(5, 7)), 0)).getUTCDate();
    return { dagenVooraf: await this.dagenVooraf(), dagen: await this.kalenderDagen(`${maand}-01`, aantal) };
  }

  // Beheer: afhalen en/of leveren voor één dag aan of uit. Gelijk aan de standaard = niets
  // bewaren, zodat de dag gewoon de openingsuren blijft volgen.
  async zetDag(datum: string, input: { afhalen?: unknown; leveren?: unknown }) {
    if (!isDatum(String(datum))) throw new BadRequestException('Ongeldige datum.');
    if (datum < brusselVandaag()) throw new BadRequestException('Een voorbije dag kan je niet meer aanpassen.');
    for (const k of ['afhalen', 'leveren'] as const) {
      if (input?.[k] !== undefined && typeof input[k] !== 'boolean') throw new BadRequestException(`Ongeldige waarde voor ${k}.`);
    }
    const [dag] = await this.kalenderDagen(datum, 1);
    const bestaand = await this.prisma.webshopdag.findUnique({ where: { datum } });
    const afhalen = input.afhalen === undefined ? bestaand?.afhalen ?? null : input.afhalen === dag.winkelOpen ? null : (input.afhalen as boolean);
    const leveren = input.leveren === undefined ? bestaand?.leveren ?? null : input.leveren ? true : null;
    if (afhalen === null && leveren === null) await this.prisma.webshopdag.deleteMany({ where: { datum } });
    else await this.prisma.webshopdag.upsert({ where: { datum }, create: { datum, afhalen, leveren }, update: { afhalen, leveren } });
    return (await this.kalenderDagen(datum, 1))[0];
  }

  private async controleerDatum(input: BestellingInput) {
    const gewensteDag = String(input.gewensteDag ?? '').trim();
    if (!isDatum(gewensteDag)) throw new BadRequestException(`Kies een ${input.leverwijze === 'LEVEREN' ? 'lever' : 'afhaal'}dag.`);
    const vandaag = brusselVandaag();
    const dagenVooraf = await this.dagenVooraf();
    const eerste = plusDagen(vandaag, dagenVooraf);
    if (gewensteDag < eerste) {
      throw new BadRequestException(dagenVooraf
        ? `Bestel minstens ${dagenVooraf} ${dagenVooraf === 1 ? 'dag' : 'dagen'} op voorhand. De eerste mogelijke dag is ${dagNaam(eerste)}.`
        : 'De gekozen datum ligt in het verleden.');
    }
    if (gewensteDag > plusDagen(vandaag, 366)) throw new BadRequestException('De gekozen datum ligt te ver in de toekomst.');
    const gewensteTijd = String(input.gewensteTijd ?? '').trim();
    if (gewensteTijd && !/^([01]\d|2[0-3]):[0-5]\d$/.test(gewensteTijd)) throw new BadRequestException('Geef een geldig uur (bv. 14:00).');
    if (gewensteDag === vandaag && gewensteTijd && gewensteTijd < brusselUur()) throw new BadRequestException('Dat uur is vandaag al voorbij.');

    // Enkel op de dagen die de kalender toelaat; op een gewone open dag binnen de openingsuren.
    const [dag] = await this.kalenderDagen(gewensteDag, 1);
    if (input.leverwijze === 'LEVEREN') {
      if (!dag.leveren) throw new BadRequestException('Op die dag leveren we niet. Kies een andere leverdag.');
    } else {
      if (!dag.afhalen) throw new BadRequestException('Op die dag kan je niet afhalen. Kies een andere afhaaldag.');
      if (dag.van && dag.tot) {
        if (gewensteDag === vandaag && brusselUur() >= dag.tot) throw new BadRequestException('De winkel is vandaag al gesloten. Kies een andere afhaaldag.');
        if (gewensteTijd && (gewensteTijd < dag.van || gewensteTijd > dag.tot)) throw new BadRequestException(`Op die dag kan je afhalen tussen ${dag.van} en ${dag.tot}.`);
      }
    }
    return { gewensteDag, gewensteTijd };
  }

  // Start een bestelling: alles wordt gecontroleerd en de klant gaat naar de betaalpagina van
  // Mollie. Er wordt nog niets geboekt: pas de betaling maakt er een verkoop van. Niets uit dit
  // publieke formulier raakt de klantenlijst, en e-mailkorting geldt hier niet: het
  // e-mailadres is niet geverifieerd.
  async bestelling(input: BestellingInput) {
    if (!this.mollie.geconfigureerd()) throw new BadRequestException('Online bestellen is nog niet mogelijk. Neem contact met ons op.');
    if (input.leverwijze !== 'AFHALEN' && input.leverwijze !== 'LEVEREN') throw new BadRequestException('Kies afhalen of leveren.');
    const naam = veld(input.klant?.naam, 'Je naam', 120);
    const email = veld(input.klant?.email, 'Je e-mailadres', 200).toLowerCase();
    const telefoon = veld(input.klant?.telefoon, 'Je telefoonnummer', 40);
    const adres = input.leverwijze === 'LEVEREN' ? veld(input.klant?.adres, 'Het leveradres', 300) : '';
    if (!naam || !email) throw new BadRequestException('Naam en e-mail zijn vereist.');
    if (!EMAIL.test(email)) throw new BadRequestException('Geef een geldig e-mailadres.');
    if (input.leverwijze === 'LEVEREN' && !adres) throw new BadRequestException('Geef een leveradres op.');
    const { gewensteDag, gewensteTijd } = await this.controleerDatum(input);
    const { lijnen, totaal } = await this.stelMandjeSamen(input.lijnen);

    await this.prisma.webshopBetaling.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - BEWAAR_POGING_MS) } } });
    const sleutel = randomBytes(24).toString('hex');
    const poging = await this.prisma.webshopBetaling.create({
      data: { sleutel, lijnen, totaal, naam, email, telefoon: telefoon || null, adres: adres || null, leverwijze: input.leverwijze, gewensteDag, gewensteTijd: gewensteTijd || null },
    });
    const site = siteUrl();
    try {
      const betaling = await this.mollie.maakBetaling({
        bedrag: totaal,
        omschrijving: `Marché bestelling ${bestelnummerVan(poging.id)}`,
        redirectUrl: `${site}/webshop?bestelling=${sleutel}`,
        webhookUrl: `${site}/api/webshop/mollie`,
        betalingId: poging.id,
      });
      const betaalUrl = betaling._links?.checkout?.href;
      if (!betaalUrl) throw new Error('Mollie gaf geen betaalpagina terug.');
      await this.prisma.webshopBetaling.update({ where: { id: poging.id }, data: { mollieId: betaling.id, mollieStatus: betaling.status } });
      return { betaalUrl };
    } catch (e) {
      this.log.error(`Betaling starten mislukt: ${e instanceof Error ? e.message : e}`);
      await this.prisma.webshopBetaling.delete({ where: { id: poging.id } }).catch(() => undefined);
      throw new BadRequestException('Online betalen lukt nu even niet. Probeer het straks opnieuw of neem contact met ons op.');
    }
  }

  // Webhook, terugkeerpagina en de periodieke controle komen hier samen. Enkel wat Mollie zelf
  // antwoordt telt, want iedereen kan de webhook aanroepen. Onbekende id's worden genegeerd.
  async verwerkBetaling(mollieId: string) {
    const poging = mollieId ? await this.prisma.webshopBetaling.findUnique({ where: { mollieId } }) : null;
    if (!poging || poging.verkoopId) return poging;
    const betaling = await this.mollie.haalBetaling(mollieId);
    if (betaling.metadata?.betalingId !== poging.id || betaling.amount?.currency !== 'EUR' || Math.abs(Number(betaling.amount?.value) - Number(poging.totaal)) > 0.001) {
      this.log.error(`Mollie-betaling ${mollieId} komt niet overeen met bestelling ${poging.id}: niet verwerkt.`);
      return poging;
    }
    if (betaling.status === 'paid') return this.boekBetaling(poging, betaling);
    const mislukt = ['failed', 'canceled', 'expired'].includes(betaling.status);
    return this.prisma.webshopBetaling.update({ where: { id: poging.id }, data: { mollieStatus: betaling.status, ...(mislukt ? { status: 'MISLUKT' } : {}) } });
  }

  // De betaling is binnen: nu pas wordt de bestelling een verkoop, verlaagt ze de stock en komt
  // ze in Bestellingen, de agenda en de dagontvangsten. Ze gebeurt hooguit één keer, ook als
  // Mollie meermaals belt. Een testbetaling raakt de stock en de ontvangsten niet.
  private async boekBetaling(poging: WebshopBetaling, betaling: MollieBetaling) {
    const test = betaling.mode === 'test';
    const lijnen = poging.lijnen as unknown as BetaalLijn[];
    const bestelnummer = bestelnummerVan(poging.id);
    try {
      const ticket = await this.sales.afrekenen(
        { lijnen: lijnen.map((l) => ({ productId: l.productId, aantal: l.aantal })), kanaal: 'WEBSHOP', betaalwijze: test ? undefined : 'ONLINE', leverwijze: poging.leverwijze, status: 'NIEUW', idempotencyKey: `mollie:${betaling.id}` },
        { vastePrijzen: new Map(lijnen.map((l) => [l.productId, l.eenheidsprijs])), geenVoorraad: test },
      );
      await this.prisma.verkoop.update({
        where: { id: ticket.id },
        data: {
          betaald: true, betaalRef: betaling.id, testBetaling: test, bestelnummer, telDag: test ? null : await this.telDagVoorNu(),
          gewensteDag: poging.gewensteDag, gewensteTijd: poging.gewensteTijd, bestelNaam: poging.naam, bestelEmail: poging.email, bestelTelefoon: poging.telefoon, bestelAdres: poging.adres,
        },
      });
      const bijgewerkt = await this.prisma.webshopBetaling.update({ where: { id: poging.id }, data: { status: 'BETAALD', mollieStatus: betaling.status, verkoopId: ticket.id } });
      try { await this.agenda.vanWebshop(ticket.id); } catch (e) { this.log.warn(`Agenda: ${e instanceof Error ? e.message : e}`); }
      this.stuurMail(poging.email, `Bevestiging van je bestelling ${bestelnummer} bij Marché`, this.bestelMail({ bestelnummer, totaal: Number(poging.totaal), leverwijze: poging.leverwijze, gewensteDag: poging.gewensteDag, gewensteTijd: poging.gewensteTijd, lijnen }));
      return bijgewerkt;
    } catch (e) {
      // Betaald maar niet geboekt: het personeel moet dit weten; Mollie probeert de webhook nog opnieuw.
      this.log.error(`Betaalde bestelling ${bestelnummer} niet verwerkt: ${e instanceof Error ? e.message : e}`);
      if (poging.status !== 'FOUT') {
        await this.prisma.webshopBetaling.update({ where: { id: poging.id }, data: { status: 'FOUT', mollieStatus: betaling.status } });
        await this.prisma.agendaItem.create({
          data: {
            dag: brusselVandaag(), soort: 'NOTITIE', bron: 'WEBSHOP', gelezen: false, status: 'OPEN', locatie: 'WINKEL', categorie: 'BOODSCHAPPEN', aangemaaktDoor: 'website',
            titel: `Betaald maar niet verwerkt: ${poging.naam}`,
            omschrijving: `Bestelling ${bestelnummer}, € ${Number(poging.totaal).toFixed(2)}, Mollie ${betaling.id}. Kijk dit na en contacteer de klant: ${lijnen.map((l) => `${l.aantal}× ${l.naam}`).join(', ')}`,
            klantNaam: poging.naam, klantEmail: poging.email, klantTelefoon: poging.telefoon,
          },
        }).catch(() => undefined);
      }
      throw e;
    }
  }

  // Een verkoop na de dagafsluiting mag die afgesloten dag niet meer wijzigen, en Scrada aanvaardt
  // geen tweede boeking voor dezelfde dag: ze telt dan op de eerstvolgende dag die nog open is.
  private async telDagVoorNu(): Promise<string | null> {
    const vandaag = brusselVandaag();
    let dag = vandaag;
    while (await this.prisma.dagafsluiting.findFirst({ where: { boekdatum: dag }, select: { id: true } })) dag = plusDagen(dag, 1);
    return dag === vandaag ? null : dag;
  }

  // De klant komt terug van Mollie. Is de webhook er nog niet, dan vragen we het zelf na.
  async statusVan(sleutel: string) {
    let poging = await this.prisma.webshopBetaling.findUnique({ where: { sleutel: String(sleutel) } });
    if (!poging) throw new NotFoundException('Bestelling niet gevonden.');
    if ((poging.status === 'OPEN' || poging.status === 'FOUT') && poging.mollieId) {
      try { poging = (await this.verwerkBetaling(poging.mollieId)) ?? poging; }
      catch (e) {
        this.log.warn(`Status nakijken: ${e instanceof Error ? e.message : e}`);
        poging = (await this.prisma.webshopBetaling.findUnique({ where: { sleutel: String(sleutel) } })) ?? poging;
      }
    }
    const mislukt = poging.status === 'MISLUKT';
    return {
      status: poging.status, bestelnummer: bestelnummerVan(poging.id), totaal: Number(poging.totaal),
      leverwijze: poging.leverwijze, gewensteDag: poging.gewensteDag, gewensteTijd: poging.gewensteTijd,
      lijnen: poging.lijnen as unknown as BetaalLijn[], naam: poging.naam, email: poging.email,
      bevestigingPerMail: this.mail.geconfigureerd(),
      // Enkel na een mislukte betaling nodig, om het formulier opnieuw in te vullen.
      ...(mislukt ? { telefoon: poging.telefoon, adres: poging.adres } : {}),
    };
  }

  private async controleerOpenBetalingen() {
    if (!this.mollie.geconfigureerd()) return;
    const open = await this.prisma.webshopBetaling.findMany({
      where: { status: { in: ['OPEN', 'FOUT'] }, mollieId: { not: null }, createdAt: { gte: new Date(Date.now() - 48 * 3600 * 1000) } },
      select: { mollieId: true }, take: 50,
    }).catch(() => []);
    for (const { mollieId } of open) {
      await this.verwerkBetaling(mollieId as string).catch((e) => this.log.warn(`Open betaling ${mollieId}: ${e instanceof Error ? e.message : e}`));
    }
  }

  // Herroepingsfunctie: de verklaring komt als nieuw punt in de agenda; de klant krijgt
  // de inhoud met datum en uur als ontvangstbevestiging. Of de herroeping geldt (bv. niet
  // voor bederfbare goederen), beoordeelt de zaak zelf.
  async herroeping(input: HerroepingInput) {
    const naam = veld(input?.naam, 'Je naam', 120);
    const email = veld(input?.email, 'Je e-mailadres', 200).toLowerCase();
    const bestelling = veld(input?.bestelling, 'De bestelling', 200);
    const toelichting = veld(input?.toelichting, 'De toelichting', 500);
    if (!naam || !email || !bestelling) throw new BadRequestException('Vul je naam, e-mailadres en bestelling in.');
    if (!EMAIL.test(email)) throw new BadRequestException('Geef een geldig e-mailadres.');

    const ontvangenOp = new Date();
    await this.prisma.agendaItem.create({
      data: {
        dag: brusselVandaag(), soort: 'NOTITIE', bron: 'WEBSHOP', gelezen: false,
        titel: `Herroeping webshop: ${naam}`,
        omschrijving: `Bestelling: ${bestelling}${toelichting ? ` · Toelichting: ${toelichting}` : ''} · Ontvangen op ${brusselMoment(ontvangenOp)}`,
        klantNaam: naam, klantEmail: email, locatie: 'WINKEL', categorie: 'BOODSCHAPPEN', status: 'OPEN', aangemaaktDoor: 'website',
      },
    });
    this.stuurMail(email, 'Ontvangstbevestiging van je herroeping bij Marché', [
      '<p>We ontvingen je verklaring dat je je bestelling herroept.</p>',
      `<p><b>Ontvangen op:</b> ${esc(brusselMoment(ontvangenOp))}<br><b>Naam:</b> ${esc(naam)}<br><b>Bestelling:</b> ${esc(bestelling)}${toelichting ? `<br><b>Toelichting:</b> ${esc(toelichting)}` : ''}</p>`,
      '<p>We nemen zo snel mogelijk contact met je op over de verdere afhandeling.</p>',
    ].join(''));
    return { ok: true, ontvangenOp, bevestigingPerMail: this.mail.geconfigureerd() };
  }

  private bestelMail(b: { bestelnummer: string; totaal: number; leverwijze: string; gewensteDag: string; gewensteTijd: string | null; lijnen: { naam: string; aantal: number; totaal: number }[] }) {
    const dag = new Date(`${b.gewensteDag}T12:00:00Z`).toLocaleDateString('nl-BE', { timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const site = siteUrl();
    return [
      `<p>Bedankt voor je bestelling bij Marché. We ontvingen je betaling.</p><p><b>Bestelnummer:</b> ${b.bestelnummer}</p>`,
      `<table cellpadding="4" style="border-collapse:collapse">${b.lijnen.map((l) => `<tr><td>${l.aantal} ×</td><td>${esc(l.naam)}</td><td align="right">${euro(l.totaal)}</td></tr>`).join('')}`,
      `<tr><td colspan="2"><b>Betaald (incl. btw)</b></td><td align="right"><b>${euro(b.totaal)}</b></td></tr></table>`,
      `<p><b>${b.leverwijze === 'LEVEREN' ? 'Levering' : 'Afhalen in de winkel'}:</b> ${esc(dag)}${b.gewensteTijd ? ` om ${b.gewensteTijd}` : ''}</p>`,
      `<p><a href="${site}/voorwaarden">Algemene voorwaarden</a> · <a href="${site}/herroeping">Herroepingsrecht en modelformulier</a> · <a href="${site}/privacy">Privacyverklaring</a></p>`,
    ].join('');
  }

  // Een mail mag een bestelling of herroeping nooit tegenhouden. De afzender van de zaak komt onderaan.
  private stuurMail(naar: string, onderwerp: string, html: string) {
    if (!this.mail.geconfigureerd()) return;
    void (async () => {
      const o = await this.prisma.onderneming.findFirst({ where: { isImporteur: false } });
      const afzender = o ? [o.naam, o.adres, `ondernemingsnummer ${o.ondernemingsnummer}`, o.btwNummer ? `btw ${o.btwNummer}` : null].filter(Boolean).join(' · ') : '';
      await this.mail.verstuur({ naar, onderwerp, html: `${html}<p style="color:#666;font-size:12px">${esc(afzender)}</p>` });
    })().catch((e) => this.log.warn(`Mail "${onderwerp}" niet verstuurd: ${e instanceof Error ? e.message : e}`));
  }

  // Beheer: alle webshop-bestellingen (nieuwste eerst), met wat er al terugbetaald is.
  async bestellingen() {
    const rijen = await this.prisma.verkoop.findMany({
      where: { kanaal: 'WEBSHOP', terugbetalingVanId: null },
      include: {
        klant: { select: { naam: true, email: true, telefoon: true, adres: true } },
        lijnen: { select: { productId: true, aantal: true, eenheidsprijs: true, product: { select: { naam: true, eenheid: true, isStatiegeld: true } } } },
      },
      orderBy: { datum: 'desc' },
      take: 500,
    });
    const terug = await this.prisma.verkoop.findMany({
      where: { terugbetalingVanId: { in: rijen.map((o) => o.id) } },
      select: { terugbetalingVanId: true, totaal: true, lijnen: { select: { productId: true, aantal: true } } },
    });
    return rijen.map((o) => {
      const eigen = terug.filter((t) => t.terugbetalingVanId === o.id);
      const terugPerProduct: Record<string, number> = {};
      for (const l of eigen.flatMap((t) => t.lijnen)) terugPerProduct[l.productId] = (terugPerProduct[l.productId] ?? 0) - Number(l.aantal);
      return {
        ...o,
        bestelnummer: o.bestelnummer ?? bestelnummerVan(o.id),
        terugbetaald: -eigen.reduce((s, t) => s + Number(t.totaal), 0),
        terugPerProduct,
        kanTerugbetalen: o.betaald && isMollieBetaling(o.betaalRef),
      };
    });
  }

  // Annuleren van een niet-betaalde (oudere) bestelling boekt de stock terug; een betaalde
  // bestelling loopt via terugbetalen. Geannuleerd is definitief.
  async updateStatus(id: string, status: string) {
    if (!STATUSSEN.includes(status)) throw new BadRequestException('Onbekende status.');
    const bestaand = await this.prisma.verkoop.findUnique({ where: { id }, select: { kanaal: true, geannuleerd: true, status: true, terugbetalingVanId: true } });
    if (!bestaand || bestaand.kanaal !== 'WEBSHOP' || bestaand.terugbetalingVanId) throw new NotFoundException('Bestelling niet gevonden.');
    if ((bestaand.geannuleerd || bestaand.status === 'GEANNULEERD') && status !== 'GEANNULEERD') throw new BadRequestException('Een geannuleerde bestelling kan je niet heropenen; plaats een nieuwe bestelling.');
    if (status === 'GEANNULEERD' && !bestaand.geannuleerd) await this.sales.annuleer(id, 'Webshopbestelling geannuleerd');
    const v = await this.prisma.verkoop.update({ where: { id }, data: { status } });
    await this.agenda.syncWebshopStatus(id, status).catch(() => undefined);
    return v;
  }

  // Betaalt (een deel van) een bestelling terug via Mollie en boekt dat als negatieve verkoop
  // op de dag van de terugbetaling, zoals een retour aan de kassa. Een afgesloten dag blijft
  // zo ongewijzigd. Alles terugbetaald = de bestelling is geannuleerd.
  async terugbetalen(id: string, gevraagd: { productId: string; aantal: number }[]) {
    const o = await this.prisma.verkoop.findUnique({ where: { id }, include: { lijnen: { include: { product: { select: { naam: true, eenheid: true } } } } } });
    if (!o || o.kanaal !== 'WEBSHOP' || o.terugbetalingVanId) throw new NotFoundException('Bestelling niet gevonden.');
    if (!o.betaald || !isMollieBetaling(o.betaalRef)) throw new BadRequestException('Deze bestelling is niet via Mollie betaald.');
    if (!Array.isArray(gevraagd) || !gevraagd.length) throw new BadRequestException('Kies wat je wil terugbetalen.');

    const eerder = await this.prisma.verkoop.findMany({ where: { terugbetalingVanId: id }, select: { totaal: true, lijnen: { select: { productId: true, aantal: true } } } });
    const alTerug = new Map<string, number>();
    for (const l of eerder.flatMap((t) => t.lijnen)) alTerug.set(l.productId, (alTerug.get(l.productId) ?? 0) - Number(l.aantal));
    const rest = (productId: string, besteld: number) => Math.round((besteld - (alTerug.get(productId) ?? 0)) * 1000) / 1000;

    const lijnen = gevraagd.map((g) => {
      const l = o.lijnen.find((x) => x.productId === String(g?.productId ?? ''));
      if (!l) throw new BadRequestException('Dat artikel staat niet op deze bestelling.');
      const aantal = Number(g.aantal);
      if (!Number.isFinite(aantal) || aantal <= 0 || aantal > rest(l.productId, Number(l.aantal)) + 0.0001) throw new BadRequestException(`Van ${l.product.naam} kan je nog ${rest(l.productId, Number(l.aantal))} terugbetalen.`);
      if (l.product.eenheid !== 'KG' && !Number.isInteger(aantal)) throw new BadRequestException(`${l.product.naam} betaal je per stuk terug.`);
      return { productId: l.productId, aantal, prijs: Number(l.eenheidsprijs) };
    });
    // Zelfde berekening als de boeking hieronder, zodat Mollie en de dagontvangsten gelijk lopen.
    const centen = -lijnen.reduce((s, l) => s + lijnCent(l.prijs, -l.aantal), 0);
    if (centen <= 0) throw new BadRequestException('Er valt niets terug te betalen.');

    const bestelnummer = o.bestelnummer ?? bestelnummerVan(o.id);
    const sleutel = createHash('sha256').update(JSON.stringify([id, eerder.length, lijnen])).digest('hex');
    let terugbetaling;
    try {
      terugbetaling = await this.mollie.terugbetalen(o.betaalRef as string, centen / 100, `Terugbetaling ${bestelnummer}`, sleutel);
    } catch (e) {
      throw new BadRequestException(`Mollie deed de terugbetaling niet: ${e instanceof Error ? e.message : 'onbekende fout'}`);
    }

    try {
      const ticket = await this.sales.afrekenen(
        { lijnen: lijnen.map((l) => ({ productId: l.productId, aantal: -l.aantal })), kanaal: 'WEBSHOP', betaalwijze: o.testBetaling ? undefined : 'ONLINE', leverwijze: o.leverwijze ?? undefined, status: 'TERUGBETALING', idempotencyKey: `mollie:${terugbetaling.id}` },
        { vastePrijzen: new Map(lijnen.map((l) => [l.productId, l.prijs])), geenVoorraad: o.testBetaling },
      );
      await this.prisma.verkoop.update({
        where: { id: ticket.id },
        data: { betaald: true, betaalRef: terugbetaling.id, testBetaling: o.testBetaling, terugbetalingVanId: id, bestelnummer, bestelNaam: o.bestelNaam, telDag: o.testBetaling ? null : await this.telDagVoorNu() },
      });
    } catch (e) {
      this.log.error(`Terugbetaling ${terugbetaling.id} van ${bestelnummer} (€ ${(centen / 100).toFixed(2)}) niet geboekt: ${e instanceof Error ? e.message : e}`);
      throw new BadRequestException(`Mollie betaalt € ${(centen / 100).toFixed(2)} terug, maar dat kon niet in de kassa geboekt worden (${terugbetaling.id}). Geef dit door aan de beheerder.`);
    }

    const volledig = o.lijnen.every((l) => rest(l.productId, Number(l.aantal)) - (lijnen.find((x) => x.productId === l.productId)?.aantal ?? 0) <= 0.0001);
    if (volledig) {
      await this.prisma.verkoop.update({ where: { id }, data: { status: 'GEANNULEERD' } });
      await this.agenda.syncWebshopStatus(id, 'GEANNULEERD').catch(() => undefined);
    }
    if (o.bestelEmail) this.stuurMail(o.bestelEmail, `Terugbetaling van je bestelling ${bestelnummer} bij Marché`, `<p>We betalen je ${euro(centen / 100)} terug voor bestelling ${bestelnummer}. Je krijgt het bedrag terug via dezelfde betaalmethode; dat kan enkele werkdagen duren.</p>`);
    return { ok: true, bedrag: centen / 100, volledig, mollieStatus: terugbetaling.status };
  }
}
