import { BadRequestException, HttpException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type LeverSoort = 'KM' | 'FORFAIT' | 'NIET';
// Een uitzonderingsregel: geldt als alle ingevulde voorwaarden kloppen. Lege voorwaarden tellen niet mee.
export type LeverRegel = { actief: boolean; naam: string; vanafBedrag: number | null; vanafKm: number | null; totKm: number | null; soort: LeverSoort; bedrag: number | null };
export type Leveradres = { straat: string; postcode: string; gemeente: string };
export type LeverInstellingen = {
  vertrekadres: Leveradres | null;              // vanwaar we leveren (de winkel)
  vertrekpunt: { lat: number; lon: number } | null;
  standaard: { soort: 'KM' | 'FORFAIT'; bedrag: number | null };
  regels: LeverRegel[];
};

const SLEUTEL = 'webshop.levering';
const MAX_REGELS = 4;
const CACHE_MS = 90 * 24 * 3600 * 1000;        // gevonden adressen: hoogstens 90 dagen (privacyverklaring)
const NIET_GEVONDEN_MS = 24 * 3600 * 1000;     // "niet gevonden" maar een dag: OpenStreetMap wordt bijgewerkt
const OPRUIMEN_MS = 3600 * 1000;               // elk uur verlopen adressen wissen
const MAX_OPZOEKINGEN = 6;                     // tegelijk lopende opzoekingen; meer = even te druk
// De rij voor Nominatim is vol: liever meteen "probeer zo opnieuw" dan klanten minutenlang laten wachten.
class TeDruk extends Error {}
const GRONDTARIEF: LeverInstellingen = { vertrekadres: null, vertrekpunt: null, standaard: { soort: 'KM', bedrag: null }, regels: [] };
const r2 = (n: number) => Math.round(n * 100) / 100;
const siteUrl = () => (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || 'https://kassa-5w5f.onrender.com').replace(/\/$/, '');

function getal(waarde: unknown, naam: string): number | null {
  if (waarde === null || waarde === undefined || waarde === '') return null;
  const n = Number(String(waarde).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > 100000) throw new BadRequestException(`Ongeldige waarde voor ${naam}.`);
  return r2(n);
}

// Leverkosten: de afstand in vogelvlucht van de winkel tot het leveradres × de kilometerprijs,
// of een forfait. Maximaal 4 uitzonderingsregels (bv. verder dan 30 km niet leveren, vanaf € 250
// gratis); de eerste regel die past, telt, zodat een regel erboven bewust kan voorgaan. Adressen
// zoeken we op met de publieke zoekdienst van OpenStreetMap (Nominatim), volgens hun voorwaarden:
// enkel als de klant het adres volledig invulde, hooguit 1 verzoek per seconde, met
// bronvermelding, en elk adres wordt bewaard.
@Injectable()
export class LeveringService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(LeveringService.name);
  private laatsteVerzoek = 0;
  private wachtrij: Promise<unknown> = Promise.resolve();
  private opzoekingen = 0;                                                    // nu bezig of wachtend
  private readonly bezig = new Map<string, Promise<{ lat: number; lon: number } | null>>(); // zelfde adres tegelijk: één opzoeking
  private timer?: NodeJS.Timeout;

  constructor(private prisma: PrismaService) {}

  onModuleInit() {
    void this.ruimOp();
    this.timer = setInterval(() => { void this.ruimOp(); }, OPRUIMEN_MS);
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // Verlopen adressen wissen: gevonden na 90 dagen, niet gevonden na een dag.
  async ruimOp() {
    const nu = Date.now();
    try {
      await this.prisma.adrescache.deleteMany({
        where: { OR: [{ createdAt: { lt: new Date(nu - CACHE_MS) } }, { gevonden: false, createdAt: { lt: new Date(nu - NIET_GEVONDEN_MS) } }] },
      });
    } catch (e) {
      this.log.warn(`Adressen opruimen mislukt: ${e instanceof Error ? e.message : e}`);
    }
  }

  async instellingen(): Promise<LeverInstellingen> {
    const i = await this.prisma.instelling.findUnique({ where: { sleutel: SLEUTEL } });
    if (!i) return GRONDTARIEF;
    try { return { ...GRONDTARIEF, ...JSON.parse(i.waarde) }; } catch { return GRONDTARIEF; }
  }

  // Kan er geleverd worden? Er is een vertrekpunt en een standaardprijs nodig.
  klaar(inst: LeverInstellingen) {
    return !!inst.vertrekpunt && inst.standaard.bedrag != null;
  }

  static leesAdres(a: Partial<Leveradres> | undefined, wat: string): Leveradres {
    const straat = String(a?.straat ?? '').trim().replace(/\s+/g, ' ');
    const postcode = String(a?.postcode ?? '').trim();
    const gemeente = String(a?.gemeente ?? '').trim().replace(/\s+/g, ' ');
    if (straat.length < 3 || straat.length > 120) throw new BadRequestException(`Vul de straat en het huisnummer van ${wat} in.`);
    if (!/^\d{4}$/.test(postcode)) throw new BadRequestException(`Geef een Belgische postcode van 4 cijfers voor ${wat}.`);
    if (gemeente.length < 2 || gemeente.length > 60) throw new BadRequestException(`Vul de gemeente van ${wat} in.`);
    return { straat, postcode, gemeente };
  }

  async zetInstellingen(input: Partial<LeverInstellingen>) {
    const vertrekadres = LeveringService.leesAdres(input?.vertrekadres ?? undefined, 'het vertrekadres');
    const soort = input?.standaard?.soort === 'FORFAIT' ? 'FORFAIT' : 'KM';
    const standaardBedrag = getal(input?.standaard?.bedrag, 'de standaardprijs');
    if (standaardBedrag === null) throw new BadRequestException('Geef de standaardprijs voor een levering.');
    const ruw = Array.isArray(input?.regels) ? input.regels : [];
    if (ruw.length > MAX_REGELS) throw new BadRequestException(`Maximaal ${MAX_REGELS} regels.`);
    const regels: LeverRegel[] = ruw.map((r, i) => {
      const regel: LeverRegel = {
        actief: !!r?.actief,
        naam: String(r?.naam ?? '').trim().slice(0, 40),
        vanafBedrag: getal(r?.vanafBedrag, `regel ${i + 1}`),
        vanafKm: getal(r?.vanafKm, `regel ${i + 1}`),
        totKm: getal(r?.totKm, `regel ${i + 1}`),
        soort: r?.soort === 'FORFAIT' || r?.soort === 'NIET' ? r.soort : 'KM',
        bedrag: getal(r?.bedrag, `regel ${i + 1}`),
      };
      if (regel.actief && regel.vanafBedrag === null && regel.vanafKm === null && regel.totKm === null) throw new BadRequestException(`Regel ${i + 1} heeft geen voorwaarde.`);
      if (regel.actief && regel.soort !== 'NIET' && regel.bedrag === null) throw new BadRequestException(`Geef het bedrag van regel ${i + 1}.`);
      return regel;
    });
    // Het vertrekpunt enkel opnieuw opzoeken als het adres veranderde.
    const huidig = await this.instellingen();
    const zelfde = JSON.stringify(huidig.vertrekadres) === JSON.stringify(vertrekadres) && huidig.vertrekpunt;
    let vertrekpunt = zelfde ? huidig.vertrekpunt : null;
    if (!vertrekpunt) {
      try { vertrekpunt = await this.zoekAdres(vertrekadres, { vers: true }); }
      catch { throw new BadRequestException('Het vertrekadres kan nu niet opgezocht worden. Probeer het straks opnieuw.'); }
      if (!vertrekpunt) throw new BadRequestException('Het vertrekadres werd niet gevonden. Controleer straat, huisnummer, postcode en gemeente.');
    }
    const nieuw: LeverInstellingen = { vertrekadres, vertrekpunt, standaard: { soort, bedrag: standaardBedrag }, regels };
    await this.prisma.instelling.upsert({ where: { sleutel: SLEUTEL }, create: { sleutel: SLEUTEL, waarde: JSON.stringify(nieuw) }, update: { waarde: JSON.stringify(nieuw) } });
    return nieuw;
  }

  // Afstand in vogelvlucht, afgerond op 100 m.
  static afstandKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
    const rad = (x: number) => (x * Math.PI) / 180;
    const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
    return Math.round(2 * 6371 * Math.asin(Math.sqrt(h)) * 10) / 10;
  }

  // De leverkost voor een bestelbedrag (artikels incl. btw, zonder statiegeld) en een afstand.
  // De eerste actieve regel waarvan alle ingevulde voorwaarden kloppen, telt. bedrag null = niet leveren.
  static bereken(inst: LeverInstellingen, subtotaal: number, km: number): { bedrag: number | null; regel: string | null } {
    for (const [i, r] of inst.regels.entries()) {
      if (!r.actief || (r.vanafBedrag === null && r.vanafKm === null && r.totKm === null)) continue;
      if (r.vanafBedrag !== null && subtotaal < r.vanafBedrag) continue;
      if (r.vanafKm !== null && km < r.vanafKm) continue;
      if (r.totKm !== null && km > r.totKm) continue;
      const naam = r.naam || `regel ${i + 1}`;
      if (r.soort === 'NIET') return { bedrag: null, regel: naam };
      return { bedrag: r2(r.soort === 'FORFAIT' ? r.bedrag ?? 0 : km * (r.bedrag ?? 0)), regel: naam };
    }
    const s = inst.standaard;
    return { bedrag: r2(s.soort === 'FORFAIT' ? s.bedrag ?? 0 : km * (s.bedrag ?? 0)), regel: null };
  }

  // Wat een levering naar dit adres kost. Gooit een duidelijke melding als het niet kan.
  // opMisser loopt enkel als het adres echt opgezocht moet worden (de rem per bezoeker).
  async offerte(adres: Leveradres, subtotaal: number, opMisser?: () => void) {
    const inst = await this.instellingen();
    if (!this.klaar(inst)) throw new BadRequestException('Leveren is nog niet ingesteld. Kies afhalen of neem contact met ons op.');
    let punt: { lat: number; lon: number } | null;
    try { punt = await this.zoekAdres(adres, { opMisser }); }
    catch (e) {
      if (e instanceof HttpException) throw e; // de rem: "te veel pogingen"
      if (e instanceof TeDruk) throw new HttpException('Het opzoeken van adressen is even druk. Probeer het over een minuutje opnieuw of kies afhalen.', 503);
      this.log.warn(`Adres opzoeken mislukt: ${e instanceof Error ? e.message : e}`);
      throw new BadRequestException('We kunnen het adres nu niet opzoeken. Probeer het straks opnieuw of kies afhalen.');
    }
    if (!punt) throw new BadRequestException('We vinden dit adres niet. Controleer straat, huisnummer, postcode en gemeente.');
    const km = LeveringService.afstandKm(inst.vertrekpunt as { lat: number; lon: number }, punt);
    const { bedrag, regel } = LeveringService.bereken(inst, subtotaal, km);
    if (bedrag === null) throw new BadRequestException('Op dit adres leveren we niet. Kies afhalen in de winkel.');
    return { km, bedrag, regel };
  }

  // Beheer: proberen wat een levering naar een adres kost, met de bewaarde instellingen.
  async test(input: { adres?: Partial<Leveradres>; bedrag?: unknown }) {
    const adres = LeveringService.leesAdres(input?.adres, 'het testadres');
    const subtotaal = getal(input?.bedrag, 'het bestelbedrag') ?? 0;
    const inst = await this.instellingen();
    if (!this.klaar(inst)) return { ok: false, melding: 'Bewaar eerst een vertrekadres en een standaardprijs.' };
    let punt: { lat: number; lon: number } | null;
    // Beheer zoekt "niet gevonden" altijd opnieuw op: zo is een adres dat intussen in
    // OpenStreetMap staat meteen ook voor de klant in orde.
    try { punt = await this.zoekAdres(adres, { vers: true }); }
    catch { return { ok: false, melding: 'Het adres kan nu niet opgezocht worden. Probeer het straks opnieuw.' }; }
    if (!punt) return { ok: false, melding: 'Adres niet gevonden.' };
    const km = LeveringService.afstandKm(inst.vertrekpunt as { lat: number; lon: number }, punt);
    const { bedrag, regel } = LeveringService.bereken(inst, subtotaal, km);
    return bedrag === null ? { ok: false, km, regel, melding: `Niet leveren (${regel}).` } : { ok: true, km, regel, bedrag };
  }

  // Zoekt een adres op, eerst in de cache. Enkel resultaten tot op straatniveau tellen: een
  // gemeente alleen is te onnauwkeurig voor een prijs. vers = "niet gevonden" uit de cache
  // negeren (beheer). opMisser loopt net voor een echte opzoeking (rem per bezoeker).
  async zoekAdres(a: Leveradres, opties: { vers?: boolean; opMisser?: () => void } = {}): Promise<{ lat: number; lon: number } | null> {
    const sleutel = [a.straat, a.postcode, a.gemeente].map((s) => s.trim().toLowerCase().replace(/\s+/g, ' ')).join('|');
    const nu = Date.now();
    const bewaard = await this.prisma.adrescache.findUnique({ where: { sleutel } });
    if (bewaard?.gevonden && bewaard.createdAt.getTime() > nu - CACHE_MS) return { lat: bewaard.lat as number, lon: bewaard.lon as number };
    if (bewaard && !bewaard.gevonden && !opties.vers && bewaard.createdAt.getTime() > nu - NIET_GEVONDEN_MS) return null;
    const lopend = this.bezig.get(sleutel);
    if (lopend) return lopend;
    opties.opMisser?.();
    if (this.opzoekingen >= MAX_OPZOEKINGEN) throw new TeDruk('te veel opzoekingen tegelijk');
    this.opzoekingen++;
    const opzoeking = (async () => {
      try {
        const punt = (await this.nominatim({ street: a.straat, postalcode: a.postcode, city: a.gemeente }))
          ?? (await this.nominatim({ q: `${a.straat}, ${a.postcode} ${a.gemeente}` }));
        const data = { gevonden: !!punt, lat: punt?.lat ?? null, lon: punt?.lon ?? null, createdAt: new Date() };
        await this.prisma.adrescache.upsert({ where: { sleutel }, create: { sleutel, ...data }, update: data });
        return punt;
      } finally {
        this.opzoekingen--;
        this.bezig.delete(sleutel);
      }
    })();
    this.bezig.set(sleutel, opzoeking);
    return opzoeking;
  }

  // Hooguit 1 verzoek per seconde naar Nominatim, voor de hele server samen.
  private beurt() {
    const volgende = this.wachtrij.then(async () => {
      const wacht = this.laatsteVerzoek + 1100 - Date.now();
      if (wacht > 0) await new Promise((r) => setTimeout(r, wacht));
      this.laatsteVerzoek = Date.now();
    });
    this.wachtrij = volgende.catch(() => undefined);
    return volgende;
  }

  private async nominatim(zoek: Record<string, string>): Promise<{ lat: number; lon: number } | null> {
    await this.beurt();
    const basis = (process.env.GEOCODER_URL?.trim() || 'https://nominatim.openstreetmap.org').replace(/\/$/, '');
    const res = await fetch(`${basis}/search?${new URLSearchParams({ format: 'jsonv2', limit: '1', countrycodes: 'be', ...zoek })}`, {
      headers: { 'User-Agent': `MarcheWebshop/1.0 (+${siteUrl()})`, 'Accept-Language': 'nl' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Nominatim gaf HTTP ${res.status}`);
    const lijst = (await res.json()) as { lat: string; lon: string; place_rank?: number }[];
    const r = Array.isArray(lijst) ? lijst[0] : null;
    if (!r || Number(r.place_rank ?? 0) < 26) return null; // 26 = straat, 30 = huisnummer
    const punt = { lat: Number(r.lat), lon: Number(r.lon) };
    return Number.isFinite(punt.lat) && Number.isFinite(punt.lon) ? punt : null;
  }
}
