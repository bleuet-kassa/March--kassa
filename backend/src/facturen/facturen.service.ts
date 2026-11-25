import { Injectable, BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Anthropic from '@anthropic-ai/sdk';
import { createHash, randomUUID } from 'crypto';
// pdf-parse heeft geen types-standaard export; via require om ESM/CJS-gedoe te vermijden.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse = require('pdf-parse');
import { PrismaService } from '../prisma/prisma.service';
import { ProductsService } from '../products/products.service';
import { leesFactor, verwerkAankoopprijs } from '../common/prijsfactor';

// Eén herkende factuurregel (uit de PDF), nog te controleren door de gebruiker.
export type FactuurRegel = {
  omschrijving: string;
  aantal: number;
  eenheidsprijs: number; // aankoopprijs zoals gefactureerd (per stuk, of per tray/doos), zonder btw
  perVerpakking?: number; // stuks per tray/doos als dat op de factuur staat (bv. "Tray 24 st")
  btwPercentage?: number;
};

// Wat de kassa al weet over een regel: onthouden van een vorige factuur, en voorstellen op naam.
export type InleesRegel = FactuurRegel & {
  // zelfdeLeverancier: onthouden bij deze leverancier; anders bij een andere (enkel als voorstel bruikbaar).
  koppeling: { productId: string | null; nietVoorWinkel: boolean; perVerpakking: number; zelfdeLeverancier: boolean } | null;
  voorstellen: { productId: string; score: number }[]; // beste eerst
};

export type InleesResultaat = {
  bron: 'ai' | 'lokaal';
  leverancier?: string; // naam zoals op de factuur
  leverancierId: string | null; // gekende leverancier met die naam
  factuurnummer: string | null;
  factuurdatum: string | null; // YYYY-MM-DD
  regels: InleesRegel[];
  waarschuwing?: string;
  sleutel: string; // deze inleesbeurt: één keer verwerken, ook bij een dubbele klik
  bestandHash: string;
  eerderVerwerkt: { op: Date; door: string | null; nieuw: number; bijgeboekt: number; factuurnummer: string | null } | null;
};

// Een gecontroleerde regel die de gebruiker bevestigt om te verwerken.
export type VerwerkRegel = {
  omschrijving?: string; // zoals op de factuur (om de koppeling te onthouden)
  voorWinkel?: boolean; // false = niet in de kassa en niet in de voorraad
  productId?: string | null; // bestaand artikel; leeg = nieuw aanmaken
  aantal: number | string; // zoals op de factuur (bv. 2 trays)
  inkoopprijs: number | string; // zoals op de factuur, per verpakking, zonder btw
  perVerpakking?: number | string | null; // stuks/kg per verpakking (leeg = 1): 2 trays van 24 = 48 stuks
  tht?: string | null;
  // enkel voor een nieuw artikel:
  naam?: string;
  verkoopprijs?: number | string | null; // incl. btw (niet nodig met een factor)
  factor?: number | string | null;
  btwTariefId?: string;
  afdelingId?: string | null;
  categorieId?: string | null;
  isAlcohol?: boolean;
  leverancierId?: string | null; // oud formaat (per regel); nu op de factuur zelf
};

export type VerwerkInput = {
  sleutel?: string;
  bestandHash?: string | null;
  leverancierId?: string | null;
  factuurnummer?: string | null;
  factuurdatum?: string | null;
  locatieId?: string | null;
  ontvangenOp?: string | null;
  toch?: boolean; // toch verwerken, al werd deze factuur al eens verwerkt
  prijsBevestigd?: boolean; // aankoopprijzen die fors hoger liggen dan nu, zijn nagekeken
  regels: VerwerkRegel[];
};

// Wat uit de pdf komt, vóór we er iets mee doen.
type Gelezen = { bron: 'ai' | 'lokaal'; leverancier?: string; regels: FactuurRegel[]; factuurnummer?: string; factuurdatum?: string; waarschuwing?: string };

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5';
const DAG = /^\d{4}-\d{2}-\d{2}$/;
// Een echte dag (geen 30 februari of maand 13: die geven een ongeldige datum, geen fout).
const isDatum = (d: string) => {
  if (!DAG.test(d)) return false;
  const t = new Date(`${d}T12:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
};
const brusselVandaag = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Brussels' }).format(new Date());
const dagenTussen = (van: string, tot: string) => Math.round((Date.parse(`${tot}T12:00:00Z`) - Date.parse(`${van}T12:00:00Z`)) / 86400000);
const getal = (v: unknown) => Number(String(v ?? '').trim().replace(',', '.'));
// Stuks per verpakking van de factuur: enkel een geheel getal van 2 tot 1000, anders niets.
const perVerpakkingUit = (v: unknown) => { const n = Number(v); return Number.isInteger(n) && n > 1 && n <= 1000 ? n : undefined; };
// Omschrijving vergelijkbaar maken: kleine letters, zonder accenten en leestekens.
export const normaal = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// Waaronder een factuurregel onthouden wordt (per leverancier).
export const koppelSleutel = (s: string) => normaal(s).slice(0, 300);
// Lidwoorden en voorzetsels zeggen niets over welk artikel het is ("Château de la ...").
const STOPWOORDEN = new Set(['de', 'het', 'een', 'en', 'van', 'met', 'op', 'in', 'voor', 'la', 'le', 'les', 'du', 'des', 'et', 'au', 'aux', 'sur', 'di', 'del', 'der', 'den', 'the', 'of']);
const woordenVan = (s: string) => normaal(s).split(' ').filter((w) => (w.length >= 2 || /\d/.test(w)) && !STOPWOORDEN.has(w));

// Hoe goed past een artikelnaam bij een factuurregel? Vooral: staan de woorden van de artikelnaam
// op de regel (een factuur zet er vaak inhoud, jaartal of code bij). 0 = niets, 1 = alles.
export function gelijkenis(artikel: string[], regel: Set<string>, regelLang: string[] = [...regel].filter((r) => r.length >= 5)) {
  if (!artikel.length || !regel.size) return 0;
  const raak = (w: string) => regel.has(w) || (w.length >= 5 && regelLang.some((r) => r.startsWith(w) || w.startsWith(r)));
  const geraakt = artikel.filter(raak).length;
  return Math.round((0.75 * (geraakt / artikel.length) + 0.25 * Math.min(1, geraakt / regel.size)) * 100) / 100;
}

@Injectable()
export class FacturenService {
  constructor(
    private prisma: PrismaService,
    private products: ProductsService,
  ) {}

  // Leest een factuur-PDF in. Als er een Claude API-sleutel is ingesteld, laat
  // Claude de factuur lezen (nauwkeurig, meerdere lay-outs). Anders valt het
  // terug op lokale PDF-tekstherkenning (gratis, ruwer). Daarna: wat weten we al over elke regel?
  async inlezen(buffer: Buffer): Promise<InleesResultaat> {
    let gelezen: Gelezen;
    if (process.env.ANTHROPIC_API_KEY) {
      try {
        gelezen = await this.inlezenAI(buffer);
      } catch (e) {
        // AI mislukt (geen krediet, netwerk, ...) -> lokaal proberen, met melding.
        gelezen = await this.inlezenLokaal(buffer);
        gelezen.waarschuwing = 'AI-herkenning mislukte, lokale herkenning gebruikt: ' + (e instanceof Error ? e.message : 'onbekende fout');
      }
    } else {
      gelezen = await this.inlezenLokaal(buffer);
      gelezen.waarschuwing = 'Geen ANTHROPIC_API_KEY ingesteld — lokale (ruwere) herkenning gebruikt. Zet een sleutel in backend/.env voor nauwkeurige AI-herkenning.';
    }
    const bestandHash = createHash('sha256').update(buffer).digest('hex');
    const leverancierId = await this.zoekLeverancier(gelezen.leverancier);
    const factuurnummer = gelezen.factuurnummer?.trim().slice(0, 60) || null;
    const factuurdatum = gelezen.factuurdatum && isDatum(gelezen.factuurdatum) ? gelezen.factuurdatum : null;
    const regels = await this.metVoorstellen(gelezen.regels, leverancierId);
    const eerder = await this.eerderVerwerkt(bestandHash, leverancierId, factuurnummer);
    return {
      bron: gelezen.bron, leverancier: gelezen.leverancier, leverancierId, factuurnummer, factuurdatum, regels,
      ...(gelezen.waarschuwing ? { waarschuwing: gelezen.waarschuwing } : {}),
      sleutel: randomUUID(), bestandHash,
      eerderVerwerkt: eerder ? { op: eerder.createdAt, door: eerder.door, nieuw: eerder.nieuw, bijgeboekt: eerder.bijgeboekt, factuurnummer: eerder.factuurnummer } : null,
    };
  }

  // Leverancier op naam: gelijk (zonder hoofdletters/leestekens), of de ene naam bevat de andere.
  private async zoekLeverancier(naam?: string): Promise<string | null> {
    const n = normaal(naam ?? '');
    if (n.length < 3) return null;
    const alle = await this.prisma.leverancier.findMany({ select: { id: true, naam: true } });
    const gelijk = alle.find((l) => normaal(l.naam) === n);
    if (gelijk) return gelijk.id;
    const deels = alle.filter((l) => { const ln = normaal(l.naam); return ln.length >= 5 && (n.includes(ln) || ln.includes(n)); });
    return deels.length === 1 ? deels[0].id : null;
  }

  // Per regel: onthouden koppeling (liefst van deze leverancier) en tot 3 voorstellen op naam.
  private async metVoorstellen(regels: FactuurRegel[], leverancierId: string | null): Promise<InleesRegel[]> {
    const sleutels = [...new Set(regels.map((r) => koppelSleutel(r.omschrijving)).filter(Boolean))];
    const [koppelingen, producten] = await Promise.all([
      sleutels.length ? this.prisma.factuurKoppeling.findMany({ where: { omschrijving: { in: sleutels } }, include: { product: { select: { actief: true } } }, orderBy: { updatedAt: 'desc' } }) : Promise.resolve([]),
      this.prisma.product.findMany({ where: { actief: true, vrijePrijs: false, isStatiegeld: false }, select: { id: true, naam: true } }),
    ]);
    const index = producten.map((p) => ({ id: p.id, woorden: [...new Set(woordenVan(p.naam))] }));
    return regels.map((r) => {
      const sleutel = koppelSleutel(r.omschrijving);
      // Enkel wat nog bruikbaar is: "niet voor de winkel", of een artikel dat nog actief is.
      const eigen = koppelingen.filter((k) => k.omschrijving === sleutel && (k.nietVoorWinkel || (k.productId && k.product?.actief)));
      const k = eigen.find((x) => x.leverancierId === (leverancierId ?? '')) ?? eigen[0] ?? null;
      const regelWoorden = new Set(woordenVan(r.omschrijving));
      const regelLang = [...regelWoorden].filter((w) => w.length >= 5);
      const voorstellen = index
        .map((p) => ({ productId: p.id, score: gelijkenis(p.woorden, regelWoorden, regelLang) }))
        .filter((v) => v.score >= 0.5)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
      return {
        ...r, voorstellen,
        koppeling: k ? { productId: k.productId, nietVoorWinkel: k.nietVoorWinkel, perVerpakking: k.perVerpakking, zelfdeLeverancier: k.leverancierId === (leverancierId ?? '') } : null,
      };
    });
  }

  private async eerderVerwerkt(hash: string | null, leverancierId: string | null, factuurnummer: string | null, db: Prisma.TransactionClient | PrismaService = this.prisma) {
    const of: Prisma.FactuurImportWhereInput[] = [];
    if (hash) of.push({ bestandHash: hash });
    if (leverancierId && factuurnummer) of.push({ leverancierId, factuurnummer });
    if (!of.length) return null;
    return db.factuurImport.findFirst({ where: { OR: of }, orderBy: { createdAt: 'desc' } });
  }
  private alVerwerktFout(eerder: { createdAt: Date; door: string | null; bijgeboekt: number; nieuw: number }) {
    const op = eerder.createdAt.toLocaleDateString('nl-BE', { timeZone: 'Europe/Brussels' });
    return new ConflictException({ code: 'AL_VERWERKT', message: `Deze factuur werd al verwerkt op ${op}${eerder.door ? ` door ${eerder.door}` : ''} (${eerder.bijgeboekt} bijgeboekt, ${eerder.nieuw} nieuw). Nog eens verwerken boekt de voorraad dubbel.` });
  }

  // --- AI-herkenning via Claude (leest de PDF-layout zelf) ---
  private async inlezenAI(buffer: Buffer): Promise<Gelezen> {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const b64 = buffer.toString('base64');

    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        leverancier: { type: 'string' },
        factuurnummer: { type: 'string' },
        factuurdatum: { type: 'string' },
        regels: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              omschrijving: { type: 'string' },
              aantal: { type: 'number' },
              eenheidsprijs: { type: 'number' },
              perVerpakking: { type: 'number' },
              btwPercentage: { type: 'number' },
            },
            required: ['omschrijving', 'aantal', 'eenheidsprijs'],
          },
        },
      },
      required: ['regels'],
    };

    const prompt =
      'Dit is een leveranciersfactuur (voeding, wijn of drank; Nederlands of Frans). ' +
      'Haal de leverancier, het factuurnummer en de factuurdatum (JJJJ-MM-DD) eruit, en elke ' +
      'bestelregel: omschrijving (naam van het product zoals op de factuur, incl. jaartal en inhoud ' +
      'indien vermeld), en het aantal en de eenheidsprijs PRECIES ZOALS GEFACTUREERD: rekent de ' +
      'factuur per tray, doos of bak, geef dan het aantal trays/dozen/bakken en de prijs per ' +
      'tray/doos/bak (reken niet om naar stuks). De eenheidsprijs is EXCLUSIEF BTW. Staat bij de ' +
      'eenheid hoeveel stuks erin zitten (bv. "Tray 24 st", "doos 6 fl"), geef dat als perVerpakking; ' +
      'anders laat je perVerpakking weg. Geef indien zichtbaar het btwPercentage per regel. Negeer ' +
      'transport-, statiegeld- en totaalregels. Antwoord uitsluitend met het JSON-object volgens het schema.';

    // output_config is nog niet in alle SDK-typings aanwezig -> als any doorgeven.
    const params: any = {
      model: MODEL,
      max_tokens: 8000,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64 } },
            { type: 'text', text: prompt },
          ],
        },
      ],
      output_config: { format: { type: 'json_schema', schema } },
    };

    const resp: any = await client.messages.create(params);
    if (resp.stop_reason === 'refusal') throw new Error('AI weigerde de factuur te lezen.');
    const tekst = (resp.content || []).find((b: any) => b.type === 'text')?.text ?? '';
    let data: any;
    try { data = JSON.parse(tekst); } catch { throw new Error('AI gaf geen geldige JSON terug.'); }
    const regels: FactuurRegel[] = (data.regels || [])
      .map((r: any) => ({
        omschrijving: String(r.omschrijving || '').trim(),
        aantal: Number(r.aantal) || 0,
        eenheidsprijs: Number(r.eenheidsprijs) || 0,
        perVerpakking: perVerpakkingUit(r.perVerpakking),
        btwPercentage: r.btwPercentage != null ? Number(r.btwPercentage) : undefined,
      }))
      .filter((r: FactuurRegel) => r.omschrijving && r.aantal > 0);
    return {
      bron: 'ai', leverancier: typeof data.leverancier === 'string' ? data.leverancier : undefined, regels,
      factuurnummer: typeof data.factuurnummer === 'string' ? data.factuurnummer : undefined,
      factuurdatum: typeof data.factuurdatum === 'string' ? data.factuurdatum : undefined,
    };
  }

  // --- Lokale herkenning: PDF-tekst uitlezen + regelherkenning ---
  // De prijsregel ziet er zo uit:  <aantal><eenheid>€ <eenheidsprijs>€ <totaal>
  // bv. "3Fles€ 14,03€ 42,09"  of  "2Tray 24 st€ 28,97€ 57,93".
  // De omschrijving staat ervoor (soms verspreid over de vorige regels).
  private async inlezenLokaal(buffer: Buffer): Promise<Gelezen> {
    const data = await pdfParse(buffer);
    const lines: string[] = (data.text || '').split('\n').map((l: string) => l.trim()).filter(Boolean);

    const PRIJS = /(\d+)\s*(Flessen|Fles|Stuks|Stuk|Tray[^€]*|Bak[^€]*|st)\s*€\s*([\d.]+,\d{2})\s*€\s*[\d.]+,\d{2}/i;
    const KOP = /omschrijving/i;
    const HEAD_END = /^(Subtotaal|Totaal|BTW|Gratis|Verzend)/i;

    const regels: FactuurRegel[] = [];
    let gestart = false;
    let leverancier: string | undefined;
    let omschr: string[] = [];

    for (const line of lines) {
      if (!gestart) {
        if (/wijnhuis|bollaert|niemegeerts|nv|bvba|bv\b/i.test(line) && !leverancier) leverancier = line;
        if (KOP.test(line) && /aantal/i.test(line)) gestart = true;
        continue;
      }
      if (HEAD_END.test(line)) break; // totalen bereikt

      const m = line.match(PRIJS);
      if (m) {
        const voor = line.slice(0, m.index).trim();
        let naam = [...omschr, voor].filter(Boolean).join(' ').trim();
        naam = naam.replace(/^\d{6,9}\s*/, '').trim(); // interne factuurcode weg
        const aantal = Number(m[1]);
        const prijs = Number(m[3].replace(/\./g, '').replace(',', '.'));
        // "Tray 24 st" = 24 stuks per tray (aantal en prijs staan per tray).
        const perVerpakking = perVerpakkingUit(m[2].match(/(\d+)\s*(?:st|stuks|fl|flessen)\b/i)?.[1]);
        if (naam.length > 2 && aantal > 0 && prijs > 0) regels.push({ omschrijving: naam, aantal, eenheidsprijs: prijs, ...(perVerpakking ? { perVerpakking } : {}) });
        omschr = [];
      } else {
        omschr.push(line);
      }
    }
    return { bron: 'lokaal', leverancier, regels };
  }

  // Zonder keuze: de winkel (daar trekt de kassa af), nooit zomaar de eerste in het alfabet.
  private async locatie(locatieId?: string | null) {
    if (locatieId) {
      const l = await this.prisma.stockLocatie.findFirst({ where: { id: String(locatieId), actief: true } });
      if (!l) throw new BadRequestException('Onbekende locatie.');
      return l;
    }
    const w = await this.prisma.stockLocatie.findFirst({ where: { type: 'WINKEL', actief: true }, orderBy: { naam: 'asc' } });
    if (!w) throw new BadRequestException('Geen actieve winkellocatie gevonden.');
    return w;
  }

  // Verwerkt de gecontroleerde regels in één keer (alles of niets): regels "voor de winkel" worden
  // bijgeboekt op een bestaand artikel of als nieuw artikel aangemaakt, met ontvangst (datum, THT,
  // aankoopprijs) in de voorraad; regels "niet voor de winkel" komen niet in de kassa. Per regel
  // onthouden we de keuze, zodat de volgende factuur van die leverancier meteen goed staat.
  async verwerken(input: VerwerkInput, door: string | null = null) {
    const ruw = Array.isArray(input?.regels) ? input.regels : [];
    if (!ruw.length) throw new BadRequestException('Geen regels om te verwerken.');
    if (ruw.length > 300) throw new BadRequestException('Te veel regels in één keer (hoogstens 300).');
    // Elke inleesbeurt heeft een sleutel. Zonder sleutel: een pagina van vóór deze versie, die
    // aantallen en prijzen per tray nog als stuks zou boeken.
    const sleutel = String(input?.sleutel ?? '').trim().slice(0, 100);
    if (!sleutel) throw new BadRequestException('Deze pagina is verouderd. Vernieuw de pagina (F5) en lees de factuur opnieuw in.');
    const vandaag = brusselVandaag();
    const ontvangenOp = String(input?.ontvangenOp ?? '').trim() || vandaag;
    if (!isDatum(ontvangenOp)) throw new BadRequestException('Geef een geldige ontvangstdatum.');
    if (ontvangenOp > vandaag) throw new BadRequestException('De ontvangstdatum ligt in de toekomst.');
    const locatie = await this.locatie(input?.locatieId);
    const leverancierId = (input?.leverancierId || ruw.find((r) => r.leverancierId)?.leverancierId || null) as string | null;
    const leverancier = leverancierId ? await this.prisma.leverancier.findUnique({ where: { id: String(leverancierId) } }) : null;
    if (leverancierId && !leverancier) throw new BadRequestException('Onbekende leverancier.');
    const factuurnummer = String(input?.factuurnummer ?? '').trim().slice(0, 60) || null;
    const factuurdatum = isDatum(String(input?.factuurdatum ?? '')) ? String(input?.factuurdatum) : null;
    const bestandHash = /^[a-f0-9]{64}$/.test(String(input?.bestandHash ?? '')) ? String(input?.bestandHash) : null;

    // Dezelfde inleesbeurt nog eens (dubbele klik, of opnieuw na een time-out): niets dubbel doen.
    const zelfde = await this.prisma.factuurImport.findUnique({ where: { sleutel } });
    if (zelfde) return { alVerwerkt: true, nieuw: zelfde.nieuw, bijgeboekt: zelfde.bijgeboekt, overgeslagen: zelfde.overgeslagen, zonderTht: 0, prijswijzigingen: [] };
    // Dezelfde factuur al eens verwerkt (zelfde pdf, of zelfde leverancier en nummer)? Enkel met bevestiging.
    if (!input?.toch) {
      const eerder = await this.eerderVerwerkt(bestandHash, leverancierId, factuurnummer);
      if (eerder) throw this.alVerwerktFout(eerder);
    }

    // Alles eerst nakijken: een fout op regel 12 mag niet halverwege stoppen.
    const [btw, afdelingen] = await Promise.all([
      this.prisma.btwTarief.findMany({ select: { id: true } }),
      this.prisma.afdeling.findMany({ select: { id: true } }),
    ]);
    const btwIds = new Set(btw.map((b) => b.id));
    const afdIds = new Set(afdelingen.map((a) => a.id));
    const gekozen = [...new Set(ruw.filter((r) => r.voorWinkel !== false && r.productId).map((r) => String(r.productId)))];
    const bestaande = new Map((await this.prisma.product.findMany({
      where: { id: { in: gekozen } },
      select: { id: true, naam: true, eenheid: true, actief: true, vrijePrijs: true, isStatiegeld: true, thtNodig: true, inkoopprijs: true },
    })).map((p) => [p.id, p]));

    // aantal en inkoop zijn hier per stuk (of kg): de factuur per verpakking is al omgerekend.
    type Plan =
      | { soort: 'OVERSLAAN'; omschrijving: string }
      | { soort: 'BESTAAND'; omschrijving: string; per: number; productId: string; naam: string; thtNodig: boolean; aantal: number; inkoop: number; tht: string | null }
      | { soort: 'NIEUW'; omschrijving: string; per: number; naam: string; aantal: number; inkoop: number; tht: string | null; factor: number | null; verkoop: number; btwTariefId: string; afdelingId: string | null; categorieId: string | null; isAlcohol: boolean };
    // Aankoopprijzen die ineens fors hoger liggen: vaak een doosprijs als stukprijs. De aankoopprijs
    // zakt nooit vanzelf terug en met een factor stijgt de verkoopprijs mee, dus eerst laten nakijken.
    const teHoog: string[] = [];
    const euro = (n: number) => `€ ${n.toFixed(2).replace('.', ',')}`;
    const plan: Plan[] = ruw.map((r, i): Plan => {
      const nr = `Regel ${i + 1}`;
      const omschrijving = String(r.omschrijving ?? r.naam ?? '').trim().slice(0, 1000);
      if (r.voorWinkel === false) return { soort: 'OVERSLAAN', omschrijving };
      const aantalF = getal(r.aantal);
      if (!Number.isFinite(aantalF) || aantalF <= 0 || aantalF > 100000) throw new BadRequestException(`${nr}: geef een geldig aantal.`);
      const inkoopF = getal(r.inkoopprijs);
      if (!Number.isFinite(inkoopF) || inkoopF < 0 || inkoopF > 100000) throw new BadRequestException(`${nr}: geef een geldige aankoopprijs.`);
      const per = r.perVerpakking == null || String(r.perVerpakking).trim() === '' ? 1 : getal(r.perVerpakking);
      if (!Number.isInteger(per) || per < 1 || per > 1000) throw new BadRequestException(`${nr}: geef een geldig aantal per verpakking (1 tot 1000).`);
      const aantal = Math.round(aantalF * per * 1000) / 1000;
      const inkoop = Math.round((inkoopF / per) * 100) / 100;
      const tht = String(r.tht ?? '').trim() || null;
      if (tht && !isDatum(tht)) throw new BadRequestException(`${nr}: geef een geldige THT.`);
      if (tht && tht < ontvangenOp) throw new BadRequestException(`${nr}: de THT ligt vóór de ontvangstdatum. Kijk de datum na.`);
      if (tht && dagenTussen(ontvangenOp, tht) > 3650) throw new BadRequestException(`${nr}: de THT ligt meer dan 10 jaar na de ontvangst. Kijk de datum na.`);
      if (r.productId) {
        const p = bestaande.get(String(r.productId));
        if (!p || !p.actief) throw new BadRequestException(`${nr}: het gekozen artikel bestaat niet (meer).`);
        if (p.vrijePrijs || p.isStatiegeld) throw new BadRequestException(`${nr}: ${p.naam} heeft geen voorraad.`);
        if (p.eenheid !== 'KG' && !Number.isInteger(aantal)) throw new BadRequestException(`${nr}: ${p.naam} tel je per stuk.`);
        const nu = p.inkoopprijs != null ? Number(p.inkoopprijs) : 0;
        if (nu > 0 && inkoop > nu * 1.75) teHoog.push(`${nr} (${p.naam}): ${euro(inkoop)} per ${p.eenheid === 'KG' ? 'kg' : 'stuk'}, nu ${euro(nu)}`);
        return { soort: 'BESTAAND', omschrijving, per, productId: p.id, naam: p.naam, thtNodig: p.thtNodig, aantal, inkoop, tht };
      }
      const naam = String(r.naam ?? omschrijving).trim().slice(0, 200);
      if (!naam) throw new BadRequestException(`${nr}: geef een naam voor het nieuwe artikel.`);
      if (!r.btwTariefId || !btwIds.has(String(r.btwTariefId))) throw new BadRequestException(`${nr}: kies een btw-tarief.`);
      if (r.afdelingId && !afdIds.has(String(r.afdelingId))) throw new BadRequestException(`${nr}: onbekende afdeling.`);
      let factor: number | null;
      try { factor = leesFactor(r.factor); } catch { throw new BadRequestException(`${nr}: geef een geldige factor (bv. 1,85) of laat het vak leeg.`); }
      if (factor != null && !(inkoop > 0)) throw new BadRequestException(`${nr}: met een factor heb je een aankoopprijs nodig.`);
      const verkoop = factor != null ? 0 : getal(r.verkoopprijs);
      if (factor == null && (!Number.isFinite(verkoop) || verkoop <= 0 || verkoop > 100000)) throw new BadRequestException(`${nr}: geef een verkoopprijs of een factor.`);
      if (!Number.isInteger(aantal)) throw new BadRequestException(`${nr}: een nieuw artikel tel je per stuk. Maak een weegartikel eerst aan in Beheer en kies het dan.`);
      return {
        soort: 'NIEUW', omschrijving, per, naam, aantal, inkoop, tht, factor, verkoop: Math.round(verkoop * 100) / 100,
        btwTariefId: String(r.btwTariefId), afdelingId: r.afdelingId ? String(r.afdelingId) : null, categorieId: r.categorieId ? String(r.categorieId) : null, isAlcohol: !!r.isAlcohol,
      };
    });
    if (teHoog.length && !input?.prijsBevestigd) {
      const lijst = teHoog.slice(0, 3).join('; ') + (teHoog.length > 3 ? ` en nog ${teHoog.length - 3}` : '');
      throw new ConflictException({ code: 'PRIJS_BEVESTIGEN', message: `Kijk de aankoopprijs na: ${lijst}. Staat de prijs per doos of tray? Vul dan in hoeveel stuks erin zitten. De aankoopprijs zakt nooit vanzelf terug, en met een factor stijgt de verkoopprijs mee.` });
    }

    const opmerking = ['Factuur', factuurnummer, leverancier?.naam ? `· ${leverancier.naam}` : null].filter(Boolean).join(' ').slice(0, 200);
    const onthoud = (tx: Prisma.TransactionClient, omschrijving: string, productId: string | null, nietVoorWinkel: boolean, perVerpakking = 1) => {
      const o = koppelSleutel(omschrijving);
      if (!o) return Promise.resolve(null);
      return tx.factuurKoppeling.upsert({
        where: { leverancierId_omschrijving: { leverancierId: leverancierId ?? '', omschrijving: o } },
        create: { leverancierId: leverancierId ?? '', omschrijving: o, productId, nietVoorWinkel, perVerpakking },
        update: { productId, nietVoorWinkel, perVerpakking },
      });
    };

    try {
      return await this.prisma.$transaction(async (tx) => {
        // Dezelfde factuur tegelijk op twee toestellen (andere sleutel): de tweede wacht hier tot de
        // eerste klaar is, en ziet dan dat ze al verwerkt is. Vaste volgorde van de sloten: geen deadlock.
        const sloten = [bestandHash ? `factuur:${bestandHash}` : null, leverancierId && factuurnummer ? `factuur:${leverancierId}:${factuurnummer.toLowerCase()}` : null]
          .filter((s): s is string => !!s).sort();
        for (const s of sloten) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${s}))`;
        if (sloten.length && !input?.toch) {
          const eerder = await this.eerderVerwerkt(bestandHash, leverancierId, factuurnummer, tx);
          if (eerder) throw this.alVerwerktFout(eerder);
        }
        // Eerst de factuur zelf: een tweede, gelijktijdige poging met dezelfde sleutel stopt hier.
        const imp = await tx.factuurImport.create({ data: { sleutel, bestandHash, leverancierId, factuurnummer, factuurdatum, ontvangenOp, locatieId: locatie.id, door } });
        let nieuw = 0, bijgeboekt = 0, overgeslagen = 0, zonderTht = 0;
        const prijswijzigingen: { naam: string; oudeInkoop: number | null; inkoopprijs: number; oudeVerkoop: number; verkoopprijs: number }[] = [];
        // Hetzelfde nieuwe artikel op twee lijnen van deze factuur: één artikel, de tweede lijn boekt erop bij.
        const nieuwPerNaam = new Map<string, { id: string; thtNodig: boolean }>();
        for (const r of plan) {
          if (r.soort === 'OVERSLAAN') { overgeslagen++; await onthoud(tx, r.omschrijving, null, true); continue; }
          let doel = r.soort === 'BESTAAND' ? { id: r.productId, thtNodig: r.thtNodig } : nieuwPerNaam.get(normaal(r.naam));
          if (doel) {
            // De aankoopprijs zakt nooit vanzelf (de hoogste blijft); met een factor stijgt de verkoopprijs mee.
            if (r.inkoop > 0) {
              const pw = await verwerkAankoopprijs(tx, doel.id, r.inkoop);
              if (pw?.gewijzigd) prijswijzigingen.push({ naam: r.naam, oudeInkoop: pw.oudeInkoop, inkoopprijs: pw.inkoopprijs, oudeVerkoop: pw.oudeVerkoop, verkoopprijs: pw.verkoopprijs });
            }
            bijgeboekt++;
          } else if (r.soort === 'NIEUW') {
            const p = await this.products.createIn(tx, {
              naam: r.naam, verkoopprijs: r.verkoop, inkoopprijs: r.inkoop > 0 ? r.inkoop : null, factor: r.factor,
              btwTariefId: r.btwTariefId, afdelingId: r.afdelingId, categorieId: r.categorieId, isAlcohol: r.isAlcohol, leverancierId,
            });
            doel = { id: p.id, thtNodig: p.thtNodig };
            nieuwPerNaam.set(normaal(r.naam), doel);
            nieuw++;
          } else continue;
          const productId = doel.id;
          const thtNodig = doel.thtNodig;
          await tx.voorraadontvangst.create({
            data: { productId, locatieId: locatie.id, aantal: new Prisma.Decimal(r.aantal), ontvangenOp, tht: r.tht, aankoopprijs: r.inkoop > 0 ? new Prisma.Decimal(r.inkoop) : null, bron: 'FACTUUR', opmerking: opmerking || null, door },
          });
          await tx.voorraad.upsert({
            where: { productId_locatieId: { productId, locatieId: locatie.id } },
            create: { productId, locatieId: locatie.id, aantal: new Prisma.Decimal(r.aantal) },
            update: { aantal: { increment: r.aantal } },
          });
          if (thtNodig && !r.tht) zonderTht++;
          await onthoud(tx, r.omschrijving, productId, false, r.per);
        }
        await tx.factuurImport.update({ where: { id: imp.id }, data: { nieuw, bijgeboekt, overgeslagen } });
        return { alVerwerkt: false, nieuw, bijgeboekt, overgeslagen, zonderTht, prijswijzigingen };
      }, { timeout: 120_000, maxWait: 15_000 });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        // Twee keer tegelijk verwerkt (dubbele klik): de eerste ging door, de tweede doet niets.
        const eerste = await this.prisma.factuurImport.findUnique({ where: { sleutel } });
        if (eerste) return { alVerwerkt: true, nieuw: eerste.nieuw, bijgeboekt: eerste.bijgeboekt, overgeslagen: eerste.overgeslagen, zonderTht: 0, prijswijzigingen: [] };
        // Iemand maakte tegelijk een artikel aan (zelfde barcode) of verwerkte dezelfde regel: er werd niets bewaard.
        throw new ConflictException('Er werd tegelijk iets anders bewaard. Er is niets verwerkt; probeer opnieuw.');
      }
      throw e;
    }
  }
}
