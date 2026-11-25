import { BadRequestException, Injectable } from '@nestjs/common';
import { promises as dns } from 'dns';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { MollieService } from './mollie.service';
import { LeveringService } from './levering.service';
import { WebshopService, WEBSHOP_WHERE } from './webshop.service';

// Controlelijst "klaar om live te gaan" voor de webshop: wat het systeem zelf kan nakijken
// (Mollie, domein, gegevens, afhaaldagen, allergenen, Scrada, wachtwoorden) en wat een
// beheerder met de hand bevestigt (bedrijfsnaam, juridische teksten, repository op privé).

export type LivegangStatus = 'OK' | 'ONTBREEKT' | 'LET_OP' | 'INFO';
export type LivegangPunt = {
  sleutel: string;
  titel: string;
  status: LivegangStatus;
  uitleg: string;
  waar: string | null; // waar het in orde te brengen is
  nodig: boolean; // nodig om live te gaan (anders: aanbevolen of ter info)
  handmatig?: { bevestigd: boolean; door: string | null; op: string | null };
  details?: string[];
};

const SLEUTEL = 'webshop.livegang';
export const HANDMATIG = ['bedrijf', 'juridisch', 'repository'] as const;
type Handmatig = (typeof HANDMATIG)[number];
type Bevestigingen = Partial<Record<Handmatig, { door: string | null; op: string }>>;

const DOMEIN = 'xn--march-fsa.eu'; // marché.eu
const RENDER_IP = '216.24.57.1';
const STANDAARD_WACHTWOORD = 'kassa1234';
const VOORBEELD_ADRES = 'Marktstraat 1, 0000 Gemeente';
const VOORBEELD_TELEFOON = '+32 (0)00 00 00 00';
const GEEN_VOEDING = /^(onderhoud|private hygi|lifestyle)/i; // non-food: geen allergenen nodig

const metTijdslimiet = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, nee) => setTimeout(() => nee(new Error('time-out')), ms))]);

@Injectable()
export class LivegangService {
  constructor(
    private prisma: PrismaService,
    private mollie: MollieService,
    private levering: LeveringService,
    private webshop: WebshopService,
    private mail: MailService,
  ) {}

  private async bevestigingen(): Promise<Bevestigingen> {
    const i = await this.prisma.instelling.findUnique({ where: { sleutel: SLEUTEL } });
    try { return i ? (JSON.parse(i.waarde) as Bevestigingen) : {}; } catch { return {}; }
  }

  // Een punt met de hand afvinken (of het vinkje weer weghalen).
  async bevestig(sleutel: string, bevestigd: unknown, door: string | null) {
    if (!(HANDMATIG as readonly string[]).includes(sleutel)) throw new BadRequestException('Dit punt vink je niet met de hand af.');
    if (typeof bevestigd !== 'boolean') throw new BadRequestException('Ongeldige waarde.');
    const b = await this.bevestigingen();
    if (bevestigd) b[sleutel as Handmatig] = { door, op: new Date().toISOString() };
    else delete b[sleutel as Handmatig];
    const waarde = JSON.stringify(b);
    await this.prisma.instelling.upsert({ where: { sleutel: SLEUTEL }, create: { sleutel: SLEUTEL, waarde }, update: { waarde } });
    return this.lijst();
  }

  async lijst() {
    const bev = await this.bevestigingen();
    const hand = (k: Handmatig) => ({ bevestigd: !!bev[k], door: bev[k]?.door ?? null, op: bev[k]?.op ?? null });
    const punten = await Promise.all([
      this.mollieStatus(),
      this.testbestelling(),
      this.domein(),
      this.publiekAdres(),
      this.bedrijf(hand('bedrijf')),
      this.contact(),
      this.afhaaldagen(),
      this.leveren(),
      this.assortiment(),
      this.allergenen(),
      this.juridisch(hand('juridisch')),
      this.scrada(),
      this.wachtwoorden(),
      this.repository(hand('repository')),
      this.mailPunt(),
    ]);
    const open = punten.filter((p) => p.nodig && p.status !== 'OK');
    return { klaar: open.length === 0, open: open.length, punten, gecontroleerdOp: new Date().toISOString() };
  }

  // --- de punten ---------------------------------------------------------------------------
  private async mollieStatus(): Promise<LivegangPunt> {
    const basis = { sleutel: 'mollie', titel: 'Online betalen (Mollie)', waar: 'Render → Environment: MOLLIE_API_KEY', nodig: true };
    const s = await this.webshop.mollieStatus();
    if (s.modus === 'UIT') {
      return { ...basis, status: 'ONTBREEKT', uitleg: s.fout ?? 'Er is nog geen Mollie-sleutel. Zet eerst de Test API key (begint met test_) op Render, na een geslaagde testbestelling de Live API key (live_).' };
    }
    if (s.fout) return { ...basis, status: 'ONTBREEKT', uitleg: `Mollie antwoordt niet zoals het hoort: ${s.fout}` };
    const details = s.methoden.length ? [`Betaalmethoden: ${s.methoden.join(', ')}`] : [];
    if (s.trageMethoden.length) {
      return { ...basis, status: 'LET_OP', uitleg: `Zet ${s.trageMethoden.join(' en ')} uit in Mollie: die betalingen komen pas na dagen binnen, en een bestelling wordt pas doorgezet als ze betaald is.`, details };
    }
    if (!s.methoden.length) return { ...basis, status: 'ONTBREEKT', uitleg: 'In Mollie staat nog geen enkele betaalmethode aan (bv. Bancontact, kaart).' };
    if (s.modus === 'TEST') {
      return { ...basis, status: 'LET_OP', uitleg: 'Mollie staat in testmodus: klanten kunnen enkel testbetalingen doen, er komt geen echt geld binnen. Zet de Live API key (live_) als de testbestelling gelukt is.', details };
    }
    return { ...basis, status: 'OK', uitleg: 'Mollie staat live: klanten betalen echt.', details };
  }

  private async testbestelling(): Promise<LivegangPunt> {
    const basis = { sleutel: 'testbestelling', titel: 'Testbestelling', waar: 'De webshop zelf (met de testsleutel van Mollie)', nodig: true };
    const laatste = await this.prisma.verkoop.findFirst({
      where: { kanaal: 'WEBSHOP', betaald: true, terugbetalingVanId: null },
      orderBy: { datum: 'desc' },
      select: { datum: true, testBetaling: true },
    });
    if (!laatste) {
      return { ...basis, status: 'ONTBREEKT', uitleg: 'Plaats met de testsleutel een bestelling op de site, betaal ze met een testbetaling en kijk na dat ze bij Bestellingen en in de agenda verschijnt.' };
    }
    const dag = laatste.datum.toLocaleDateString('nl-BE', { timeZone: 'Europe/Brussels' });
    return { ...basis, status: 'OK', uitleg: laatste.testBetaling ? `Laatste testbestelling betaald op ${dag}.` : `Laatste betaalde bestelling op ${dag}.` };
  }

  private async domein(): Promise<LivegangPunt> {
    const basis = { sleutel: 'domein', titel: 'Domein marché.eu', waar: 'Combell (DNS) en Render → Settings → Custom Domains', nodig: true };
    try {
      const ips = await metTijdslimiet(dns.resolve4(DOMEIN), 4000);
      if (ips.includes(RENDER_IP)) return { ...basis, status: 'OK', uitleg: 'marché.eu wijst naar de server op Render.' };
      return { ...basis, status: 'ONTBREEKT', uitleg: `marché.eu wijst nog niet naar Render (nu ${ips.join(', ')}). Zet bij Combell het A-record van @ op ${RENDER_IP} en www als CNAME naar kassa-5w5f.onrender.com; voeg het domein toe in Render. De MX-records (mail) niet aanraken.` };
    } catch {
      return { ...basis, status: 'ONTBREEKT', uitleg: `marché.eu wijst nog niet naar Render. Zet bij Combell het A-record van @ op ${RENDER_IP} en www als CNAME naar kassa-5w5f.onrender.com; voeg het domein toe in Render. De MX-records (mail) niet aanraken.` };
    }
  }

  private async publiekAdres(): Promise<LivegangPunt> {
    const basis = { sleutel: 'adres', titel: 'Adres van de site (PUBLIC_URL)', waar: 'Render → Environment: PUBLIC_URL', nodig: true };
    const publiek = process.env.PUBLIC_URL?.trim();
    if (!publiek) {
      return { ...basis, status: 'LET_OP', uitleg: 'Betaallinks en de terugkeer na betalen gaan nu naar kassa-5w5f.onrender.com. Zet PUBLIC_URL op https://xn--march-fsa.eu zodra het domein gekoppeld is.' };
    }
    if (!/^https:\/\//.test(publiek)) return { ...basis, status: 'ONTBREEKT', uitleg: `PUBLIC_URL moet met https:// beginnen (nu ${publiek}).` };
    return { ...basis, status: 'OK', uitleg: `Betaallinks gaan naar ${publiek}.` };
  }

  private async bedrijf(hand: { bevestigd: boolean; door: string | null; op: string | null }): Promise<LivegangPunt> {
    const basis = { sleutel: 'bedrijf', titel: 'Bedrijfsgegevens', waar: 'Kassa → Beheerder → Instellingen', nodig: true, handmatig: hand };
    const o = await this.prisma.onderneming.findFirst({ where: { isImporteur: false }, orderBy: { createdAt: 'asc' } });
    const ontbreekt = !o ? ['alles'] : [!o.naam?.trim() && 'naam', !o.ondernemingsnummer?.trim() && 'ondernemingsnummer', !o.btwNummer?.trim() && 'btw-nummer', !o.adres?.trim() && 'adres'].filter(Boolean) as string[];
    const details = o ? [`${o.naam} · ondernemingsnr. ${o.ondernemingsnummer}${o.btwNummer ? ` · btw ${o.btwNummer}` : ''}${o.adres ? ` · ${o.adres}` : ''}`] : [];
    if (ontbreekt.length) return { ...basis, status: 'ONTBREEKT', uitleg: `Vul in: ${ontbreekt.join(', ')}. Die gegevens staan op de site, in de voorwaarden en op de tickets.`, details };
    if (!hand.bevestigd) return { ...basis, status: 'LET_OP', uitleg: 'Kijk na dat de naam de juridische naam van de vennootschap is zoals in de KBO (niet de handelsnaam), en vink dan aan.', details };
    return { ...basis, status: 'OK', uitleg: 'Nagekeken.', details };
  }

  private async contact(): Promise<LivegangPunt> {
    const basis = { sleutel: 'contact', titel: 'Contactgegevens op de site', waar: 'Kassa → Website → Teksten (contact)', nodig: true };
    const rijen = await this.prisma.siteTekst.findMany({ where: { sleutel: { in: ['contact_adres', 'contact_telefoon', 'contact_email'] } } });
    const t = new Map(rijen.map((r) => [r.sleutel, r.waarde?.trim() ?? '']));
    const fout: string[] = [];
    const adres = t.get('contact_adres') ?? '';
    const tel = t.get('contact_telefoon') ?? '';
    if (!adres || adres === VOORBEELD_ADRES) fout.push('adres');
    if (!tel || tel === VOORBEELD_TELEFOON) fout.push('telefoonnummer');
    if (!(t.get('contact_email') ?? '')) fout.push('e-mailadres');
    const details = [`Adres: ${adres || '—'}`, `Telefoon: ${tel || '—'}`, `E-mail: ${t.get('contact_email') || '—'}`];
    if (fout.length) return { ...basis, status: 'ONTBREEKT', uitleg: `Nog een voorbeeld of leeg: ${fout.join(', ')}. Klanten moeten jullie kunnen bereiken (verplicht voor een webshop).`, details };
    return { ...basis, status: 'OK', uitleg: 'Adres, telefoon en e-mail staan op de site.', details };
  }

  private async afhaaldagen(): Promise<LivegangPunt> {
    const basis = { sleutel: 'afhaaldagen', titel: 'Afhaaldagen', waar: 'Webshop → Afhaal- en leverdagen, en de openingsuren op Website', nodig: true };
    const d = await this.webshop.beschikbareDagen();
    const grens = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
    const afhalen = d.dagen.filter((x) => x.afhalen && x.iso <= grens).length;
    if (!afhalen) return { ...basis, status: 'ONTBREEKT', uitleg: 'Er is de komende twee weken geen enkele afhaaldag: kijk de openingsuren en de webshopkalender na.' };
    return { ...basis, status: 'OK', uitleg: `${afhalen} afhaaldag${afhalen === 1 ? '' : 'en'} in de komende twee weken; klanten bestellen minstens ${d.dagenVooraf} dag${d.dagenVooraf === 1 ? '' : 'en'} op voorhand.` };
  }

  private async leveren(): Promise<LivegangPunt> {
    const basis = { sleutel: 'leveren', titel: 'Leveren', waar: 'Webshop → Leverkosten en Afhaal- en leverdagen', nodig: false };
    const vandaag = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Brussels' }).format(new Date());
    const leverdagen = await this.prisma.webshopdag.count({ where: { datum: { gte: vandaag }, leveren: true } });
    const klaar = this.levering.klaar(await this.levering.instellingen());
    if (!leverdagen) return { ...basis, status: 'INFO', uitleg: klaar ? 'Leverkosten zijn ingesteld, maar er staat geen leverdag aan: klanten kunnen enkel afhalen.' : 'Leveren staat uit: klanten kunnen enkel afhalen. Wil je leveren, vul dan de leverkosten in en zet leverdagen aan.' };
    if (!klaar) return { ...basis, status: 'LET_OP', uitleg: `Er ${leverdagen === 1 ? 'staat 1 leverdag' : `staan ${leverdagen} leverdagen`} aan, maar de leverkosten (vertrekadres en prijs) zijn niet ingesteld: klanten kunnen dan niet voor levering kiezen.` };
    return { ...basis, status: 'OK', uitleg: `Leverkosten ingesteld, ${leverdagen} leverdag${leverdagen === 1 ? '' : 'en'} aan.` };
  }

  private async assortiment(): Promise<LivegangPunt> {
    const basis = { sleutel: 'assortiment', titel: 'Artikels online', waar: 'Webshop → Assortiment', nodig: true };
    const [aantal, zonderFoto] = await Promise.all([
      this.prisma.product.count({ where: WEBSHOP_WHERE }),
      this.prisma.product.count({ where: { ...WEBSHOP_WHERE, OR: [{ fotoUrl: null }, { fotoUrl: '' }] } }),
    ]);
    if (!aantal) return { ...basis, status: 'ONTBREEKT', uitleg: 'Er staat nog geen enkel artikel in de webshop.' };
    return { ...basis, status: 'OK', uitleg: `${aantal} artikel${aantal === 1 ? '' : 's'} online${zonderFoto ? `, waarvan ${zonderFoto} zonder foto` : ''}.` };
  }

  // Voeding die online verkocht wordt: allergenen vóór de aankoop (EU-verordening 1169/2011).
  private async allergenen(): Promise<LivegangPunt> {
    const basis = { sleutel: 'allergenen', titel: 'Allergenen', waar: 'Webshop → Assortiment (kolom Allergenen, of "geen")', nodig: true };
    const online = await this.prisma.product.findMany({
      where: WEBSHOP_WHERE,
      select: { naam: true, allergenen: true, afdeling: { select: { naam: true } }, categorie: { select: { afdeling: { select: { naam: true } } } } },
      orderBy: { naam: 'asc' },
    });
    const voeding = online.filter((p) => !GEEN_VOEDING.test(p.afdeling?.naam ?? p.categorie?.afdeling?.naam ?? ''));
    const zonder = voeding.filter((p) => !p.allergenen?.trim());
    if (!voeding.length) return { ...basis, status: 'OK', uitleg: 'Er staat geen voeding online.' };
    if (!zonder.length) return { ...basis, status: 'OK', uitleg: `Alle ${voeding.length} online voedingsartikels hebben allergeneninformatie.` };
    return {
      ...basis, status: 'ONTBREEKT',
      uitleg: `${zonder.length} van de ${voeding.length} online voedingsartikels ${zonder.length === 1 ? 'heeft' : 'hebben'} nog geen allergeneninformatie. Die moet vóór de aankoop zichtbaar zijn; vul de allergenen in, of "geen". Voor wijn: "bevat sulfieten".`,
      details: zonder.slice(0, 12).map((p) => p.naam).concat(zonder.length > 12 ? [`… en nog ${zonder.length - 12}`] : []),
    };
  }

  private async juridisch(hand: { bevestigd: boolean; door: string | null; op: string | null }): Promise<LivegangPunt> {
    const basis = { sleutel: 'juridisch', titel: 'Privacy, voorwaarden en herroeping', waar: 'Kassa → Website → Juridische teksten; nalezen door jullie jurist', nodig: true, handmatig: hand };
    const eigen = await this.prisma.siteTekst.findMany({ where: { sleutel: { in: ['juridisch_privacy', 'juridisch_voorwaarden', 'juridisch_herroeping'] } }, select: { sleutel: true, waarde: true } });
    const eigenVersies = eigen.filter((e) => e.waarde?.trim()).map((e) => e.sleutel.replace('juridisch_', ''));
    const details = eigenVersies.length ? [`Eigen versie bewaard voor: ${eigenVersies.join(', ')}. Die toont latere aanvullingen (bv. over leverkosten) niet vanzelf.`] : [];
    if (!hand.bevestigd) return { ...basis, status: 'LET_OP', uitleg: 'De teksten staan online. Laat ze nalezen door jullie jurist en vink aan als dat gebeurd is.', details };
    return { ...basis, status: 'OK', uitleg: 'Nagelezen.', details };
  }

  // Webshopbetalingen komen als betaalwijze "Online" in de dagontvangsten: die moet naar een
  // betaalmethode in Scrada gaan die ook negatieve bedragen (terugbetalingen) aanvaardt.
  private async scrada(): Promise<LivegangPunt> {
    const basis = { sleutel: 'scrada', titel: 'Boekhouding (Scrada)', waar: 'Kassa → Beheerder → Boekhouding', nodig: true };
    const ingesteld = !!(process.env.SCRADA_API_KEY && process.env.SCRADA_API_PASSWORD && process.env.SCRADA_COMPANY_ID);
    if (!ingesteld) return { ...basis, nodig: false, status: 'INFO', uitleg: 'Scrada is nog niet gekoppeld. Zodra het dat wel is: koppel ook de betaalwijze "Online (webshop)".' };
    const i = await this.prisma.instelling.findUnique({ where: { sleutel: 'scrada.dagboek' } });
    let online: string | undefined;
    try { online = (JSON.parse(i?.waarde ?? '{}') as { pmMap?: Record<string, string> }).pmMap?.ONLINE; } catch { /* leeg */ }
    if (!online) return { ...basis, status: 'ONTBREEKT', uitleg: 'Koppel de betaalwijze "Online (webshop)" aan een betaalmethode in Scrada die ook negatieve bedragen toelaat (voor terugbetalingen). Anders lukt de dagboeking niet op dagen met webshopverkopen.' };
    return { ...basis, status: 'OK', uitleg: 'De betaalwijze "Online (webshop)" is gekoppeld.' };
  }

  // Het standaardwachtwoord staat in de openbare code: een account dat het nog gebruikt, is open.
  private async wachtwoorden(): Promise<LivegangPunt> {
    const basis = { sleutel: 'wachtwoorden', titel: 'Wachtwoorden', waar: 'Kassa → Beheerder → Personeel (wachtwoord resetten)', nodig: true };
    const gebruikers = await this.prisma.gebruiker.findMany({ where: { actief: true }, select: { naam: true, email: true, wachtwoordHash: true } });
    const open: string[] = [];
    for (const g of gebruikers) {
      if (g.wachtwoordHash && (await bcrypt.compare(STANDAARD_WACHTWOORD, g.wachtwoordHash))) open.push(`${g.naam} (${g.email})`);
    }
    if (open.length) return { ...basis, status: 'ONTBREEKT', uitleg: `Het standaardwachtwoord werkt nog voor ${open.length === 1 ? 'dit account' : 'deze accounts'}. Dat wachtwoord staat in de code die online staat: geef ${open.length === 1 ? 'het' : 'ze'} een eigen wachtwoord.`, details: open };
    return { ...basis, status: 'OK', uitleg: 'Geen enkel actief account gebruikt nog het standaardwachtwoord.' };
  }

  private async repository(hand: { bevestigd: boolean; door: string | null; op: string | null }): Promise<LivegangPunt> {
    const basis = { sleutel: 'repository', titel: 'Code op GitHub op privé', waar: 'GitHub → repository → Settings → Change visibility', nodig: true, handmatig: hand };
    if (!hand.bevestigd) return { ...basis, status: 'LET_OP', uitleg: 'De code staat openbaar op GitHub, met daarin aankoopprijzen en het standaardwachtwoord. Zet de repository op privé (Render blijft werken als het toegang heeft) en vink dan aan.' };
    return { ...basis, status: 'OK', uitleg: 'Op privé gezet.' };
  }

  // Een webshop moet de bestelling bevestigen op een duurzame drager (e-mail), en een
  // herroeping met een ontvangstbevestiging: zonder mailserver gebeurt dat niet.
  private async mailPunt(): Promise<LivegangPunt> {
    const basis = { sleutel: 'mail', titel: 'E-mail (bevestigingen)', waar: 'Render → Environment: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM', nodig: true };
    if (!this.mail.geconfigureerd()) return { ...basis, status: 'ONTBREEKT', uitleg: 'Er is nog geen mailserver ingesteld: klanten krijgen geen bevestiging van hun bestelling per mail, en geen ontvangstbevestiging als ze herroepen. Die moeten ze wel krijgen. Stel de mail van Combell in zodra de mailbox op marché.eu bestaat.' };
    return { ...basis, status: 'OK', uitleg: 'Mail is ingesteld: klanten krijgen een bevestiging per mail.' };
  }
}
