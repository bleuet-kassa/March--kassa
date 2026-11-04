import { Injectable, BadRequestException, HttpException, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SalesService } from '../sales/sales.service';
import { AgendaService } from '../agenda/agenda.service';
import { MailService } from '../mail/mail.service';

// Publieke webshop-catalogus. Toont ENKEL producten die actief zijn én
// als "toon in webshop" gemarkeerd staan. Een product offline zetten aan de
// kassa (actief=false) haalt het dus automatisch uit de webshop.
// Vrije bedragen (diversen, cadeaubon), statiegeldsoorten en artikelen zonder prijs zijn nooit bestelbaar.
const WEBSHOP_WHERE = { actief: true, webshopZichtbaar: true, vrijePrijs: false, isStatiegeld: false, verkoopprijs: { gt: 0 } };

export type BestellingInput = {
  lijnen: { productId: string; aantal: number }[];
  klant: { naam: string; email: string; telefoon?: string; adres?: string };
  leverwijze: 'AFHALEN' | 'LEVEREN';
  betaalwijze?: string; // enkel betalen bij afhaling/levering; online betalen (Axepta) is nog niet gebouwd
  gewensteDag?: string;  // gewenste afhaal-/leverdatum (YYYY-MM-DD), verplicht
  gewensteTijd?: string; // gewenst uur (HH:MM), optioneel
};
export type HerroepingInput = { naam: string; email: string; bestelling: string; toelichting?: string };

const STATUSSEN = ['NIEUW', 'IN_BEHANDELING', 'KLAAR', 'AFGEHAALD', 'GELEVERD', 'GEANNULEERD'];
const MAX_LIJNEN = 100;
const MAX_AANTAL = 999;
const REM_MAX = 10; // formulieren per bezoeker per REM_MS
const REM_MS = 10 * 60 * 1000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const brusselVandaag = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const brusselMoment = (d: Date) => d.toLocaleString('nl-BE', { timeZone: 'Europe/Brussels', dateStyle: 'long', timeStyle: 'short' });
const euro = (n: number) => '€ ' + n.toFixed(2).replace('.', ',');
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
const bestelnummerVan = (id: string) => 'W-' + id.slice(-8).toUpperCase();

// Vrije tekst uit een publiek formulier: opgekuist en begrensd.
function veld(waarde: unknown, naam: string, max: number) {
  const s = String(waarde ?? '').trim();
  if (s.length > max) throw new BadRequestException(`${naam} is te lang.`);
  return s;
}

@Injectable()
export class WebshopService {
  private readonly log = new Logger(WebshopService.name);
  private readonly pogingen = new Map<string, number[]>();

  constructor(private prisma: PrismaService, private sales: SalesService, private agenda: AgendaService, private mail: MailService) {}

  // Rem per bezoeker tegen geautomatiseerd misbruik van de publieke formulieren (elke
  // bestelling verlaagt de stock). Eén server, dus bijhouden in het geheugen volstaat.
  rem(bezoeker: string) {
    const nu = Date.now();
    const recent = (this.pogingen.get(bezoeker) ?? []).filter((t) => nu - t < REM_MS);
    if (recent.length >= REM_MAX) throw new HttpException('Te veel pogingen na elkaar. Probeer het over enkele minuten opnieuw of bel ons.', 429);
    if (this.pogingen.size > 5000) this.pogingen.clear();
    this.pogingen.set(bezoeker, [...recent, nu]);
  }

  producten(afdelingId?: string) {
    return this.prisma.product.findMany({
      where: { ...WEBSHOP_WHERE, ...(afdelingId ? { afdelingId } : {}) },
      select: {
        id: true, naam: true, omschrijving: true, verkoopprijs: true, isAlcohol: true, eenheid: true,
        allergenen: true, afdelingId: true, fotoUrl: true,
        afdeling: { select: { id: true, naam: true, volgorde: true } },
        categorie: { select: { id: true, naam: true } },
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

  // Enkel wat online staat, in een geldig aantal: de kassa laat negatieve aantallen
  // toe (retour) en kent alle artikels, de publieke webshop dus niet.
  private async controleerLijnen(lijnen: BestellingInput['lijnen']) {
    if (!Array.isArray(lijnen) || !lijnen.length) throw new BadRequestException('Je winkelmandje is leeg.');
    if (lijnen.length > MAX_LIJNEN) throw new BadRequestException('Je mandje bevat te veel verschillende artikels. Neem contact met ons op.');
    const ids = [...new Set(lijnen.map((l) => String(l?.productId ?? '')))];
    const producten = await this.prisma.product.findMany({ where: { ...WEBSHOP_WHERE, id: { in: ids } }, select: { id: true, naam: true, eenheid: true } });
    const perId = new Map(producten.map((p) => [p.id, p]));
    return lijnen.map((l) => {
      const p = perId.get(String(l?.productId ?? ''));
      if (!p) throw new BadRequestException('Een artikel in je mandje is niet meer beschikbaar. Vernieuw de pagina en probeer opnieuw.');
      const aantal = Number(l.aantal);
      if (!Number.isFinite(aantal) || aantal <= 0 || aantal > MAX_AANTAL) throw new BadRequestException(`Ongeldig aantal voor ${p.naam}.`);
      if (p.eenheid !== 'KG' && !Number.isInteger(aantal)) throw new BadRequestException(`${p.naam} bestel je per stuk.`);
      return { productId: p.id, aantal: p.eenheid === 'KG' ? Math.round(aantal * 1000) / 1000 : aantal };
    });
  }

  private controleerDatum(input: BestellingInput) {
    const gewensteDag = String(input.gewensteDag ?? '').trim();
    const dag = new Date(`${gewensteDag}T12:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(gewensteDag) || Number.isNaN(dag.getTime()) || dag.toISOString().slice(0, 10) !== gewensteDag) {
      throw new BadRequestException(`Kies een ${input.leverwijze === 'LEVEREN' ? 'lever' : 'afhaal'}datum.`);
    }
    if (gewensteDag < brusselVandaag()) throw new BadRequestException('De gekozen datum ligt in het verleden.');
    if (dag.getTime() > Date.now() + 366 * 24 * 3600 * 1000) throw new BadRequestException('De gekozen datum ligt te ver in de toekomst.');
    const gewensteTijd = String(input.gewensteTijd ?? '').trim();
    if (gewensteTijd && !/^([01]\d|2[0-3]):[0-5]\d$/.test(gewensteTijd)) throw new BadRequestException('Geef een geldig uur (bv. 14:00).');
    return { gewensteDag, gewensteTijd };
  }

  // Plaatst een webshop-bestelling en boekt ze via het WEBSHOP-kanaal (betalen bij
  // afhaling/levering; status NIEUW). Verlaagt dezelfde winkelstock. Niets uit dit
  // publieke formulier raakt de klantenlijst, en een e-mailkorting wordt niet automatisch
  // toegepast: het e-mailadres is niet geverifieerd. Het personeel ziet in Bestellingen
  // wie op de kortingslijst staat en controleert dat bij het afrekenen.
  async bestelling(input: BestellingInput) {
    if (input.betaalwijze && input.betaalwijze !== 'ACHTERAF') throw new BadRequestException('Online betalen is nog niet mogelijk. Je betaalt bij afhaling of levering.');
    if (input.leverwijze !== 'AFHALEN' && input.leverwijze !== 'LEVEREN') throw new BadRequestException('Kies afhalen of leveren.');
    const naam = veld(input.klant?.naam, 'Je naam', 120);
    const email = veld(input.klant?.email, 'Je e-mailadres', 200).toLowerCase();
    const telefoon = veld(input.klant?.telefoon, 'Je telefoonnummer', 40);
    const adres = input.leverwijze === 'LEVEREN' ? veld(input.klant?.adres, 'Het leveradres', 300) : '';
    if (!naam || !email) throw new BadRequestException('Naam en e-mail zijn vereist.');
    if (!EMAIL.test(email)) throw new BadRequestException('Geef een geldig e-mailadres.');
    if (input.leverwijze === 'LEVEREN' && !adres) throw new BadRequestException('Geef een leveradres op.');
    const { gewensteDag, gewensteTijd } = this.controleerDatum(input);
    const lijnen = await this.controleerLijnen(input.lijnen);

    const ticket = await this.sales.afrekenen({ lijnen, kanaal: 'WEBSHOP', leverwijze: input.leverwijze, status: 'NIEUW' });

    // Gewenste datum/uur en contactgegevens bewaren; de bestelling komt automatisch in de
    // agenda van de zaak (eerst op de besteldag; na "Gelezen" op de afhaal-/leverdag).
    await this.prisma.verkoop.update({
      where: { id: ticket.id },
      data: { gewensteDag, gewensteTijd: gewensteTijd || null, bestelNaam: naam, bestelEmail: email, bestelTelefoon: telefoon || null, bestelAdres: adres || null },
    });
    try { await this.agenda.vanWebshop(ticket.id); } catch { /* agenda mag de bestelling niet blokkeren */ }

    const bestelnummer = bestelnummerVan(ticket.id);
    const bevestigd = {
      bestelnummer, totaal: ticket.totaal, leverwijze: input.leverwijze, gewensteDag, gewensteTijd: gewensteTijd || null,
      lijnen: ticket.lijnen.map((l) => ({ naam: l.naam, aantal: l.aantal, eenheidsprijs: l.eenheidsprijs, totaal: l.totaal })),
    };
    this.stuurMail(email, `Bevestiging van je bestelling ${bestelnummer} bij Marché`, this.bestelMail(bevestigd));
    return {
      id: ticket.id, status: 'NIEUW', ...bevestigd,
      klant: { naam, email },
      bevestigingPerMail: this.mail.geconfigureerd(),
    };
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
    const leveren = b.leverwijze === 'LEVEREN';
    const dag = new Date(`${b.gewensteDag}T12:00:00Z`).toLocaleDateString('nl-BE', { timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const site = process.env.SITE_URL?.trim() || 'https://kassa-5w5f.onrender.com';
    return [
      `<p>Bedankt voor je bestelling bij Marché.</p><p><b>Bestelnummer:</b> ${b.bestelnummer}</p>`,
      `<table cellpadding="4" style="border-collapse:collapse">${b.lijnen.map((l) => `<tr><td>${l.aantal} ×</td><td>${esc(l.naam)}</td><td align="right">${euro(l.totaal)}</td></tr>`).join('')}`,
      `<tr><td colspan="2"><b>Totaal (incl. btw)</b></td><td align="right"><b>${euro(b.totaal)}</b></td></tr></table>`,
      `<p><b>${leveren ? 'Levering' : 'Afhalen in de winkel'}:</b> ${esc(dag)}${b.gewensteTijd ? ` om ${b.gewensteTijd}` : ''}<br>Je betaalt bij ${leveren ? 'de levering' : 'het afhalen'}.</p>`,
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

  // Beheer: alle webshop-bestellingen (nieuwste eerst).
  async bestellingen() {
    const rijen = await this.prisma.verkoop.findMany({
      where: { kanaal: 'WEBSHOP' },
      include: {
        klant: { select: { naam: true, email: true, telefoon: true, adres: true } },
        lijnen: { select: { aantal: true, eenheidsprijs: true, product: { select: { naam: true } } } },
      },
      orderBy: { datum: 'desc' },
      take: 500,
    });
    const emailVan = (o: (typeof rijen)[number]) => (o.bestelEmail ?? o.klant?.email ?? '').toLowerCase();
    const begunstigden = await this.prisma.kortingsBegunstigde.findMany({ where: { email: { in: [...new Set(rijen.map(emailVan).filter(Boolean))] } }, include: { regeling: true } });
    const korting = new Map(begunstigden.filter((b) => b.regeling.actief).map((b) => [b.email.toLowerCase(), `${b.regeling.naam} ${Number(b.regeling.pct)}%`]));
    return rijen.map((o) => ({ ...o, bestelnummer: bestelnummerVan(o.id), mogelijkeKorting: korting.get(emailVan(o)) ?? null }));
  }

  // Annuleren boekt de stock terug; daarna kan de bestelling niet meer heropend worden.
  async updateStatus(id: string, status: string) {
    if (!STATUSSEN.includes(status)) throw new BadRequestException('Onbekende status.');
    const bestaand = await this.prisma.verkoop.findUnique({ where: { id }, select: { kanaal: true, geannuleerd: true } });
    if (!bestaand || bestaand.kanaal !== 'WEBSHOP') throw new NotFoundException('Bestelling niet gevonden.');
    if (bestaand.geannuleerd && status !== 'GEANNULEERD') throw new BadRequestException('Een geannuleerde bestelling kan je niet heropenen; plaats een nieuwe bestelling.');
    if (status === 'GEANNULEERD' && !bestaand.geannuleerd) await this.sales.annuleer(id, 'Webshopbestelling geannuleerd');
    const v = await this.prisma.verkoop.update({ where: { id }, data: { status } });
    await this.agenda.syncWebshopStatus(id, status).catch(() => undefined);
    return v;
  }
}
