import { Injectable, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import Anthropic from '@anthropic-ai/sdk';
// pdf-parse heeft geen types-standaard export; via require om ESM/CJS-gedoe te vermijden.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse = require('pdf-parse');
import { PrismaService } from '../prisma/prisma.service';
import { ProductsService } from '../products/products.service';
import { StockService } from '../stock/stock.service';

// Eén herkende factuurregel (uit de PDF), nog te controleren door de gebruiker.
export type FactuurRegel = {
  omschrijving: string;
  aantal: number;
  eenheidsprijs: number; // inkoopprijs per stuk (zoals op de factuur)
  btwPercentage?: number;
};

export type InleesResultaat = {
  bron: 'ai' | 'lokaal';
  leverancier?: string;
  regels: FactuurRegel[];
  waarschuwing?: string;
};

// Een gecontroleerde regel die de gebruiker bevestigt om te verwerken.
export type VerwerkRegel = {
  naam: string;
  aantal: number;
  inkoopprijs: number;
  verkoopprijs: number;
  btwTariefId: string;
  isAlcohol?: boolean;
  leverancierId?: string | null;
  categorieId?: string | null;
  productId?: string | null; // gekozen bestaand product; leeg = nieuw aanmaken
};

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5';

@Injectable()
export class FacturenService {
  constructor(
    private prisma: PrismaService,
    private products: ProductsService,
    private stock: StockService,
  ) {}

  // Leest een factuur-PDF in. Als er een Claude API-sleutel is ingesteld, laat
  // Claude de factuur lezen (nauwkeurig, meerdere lay-outs). Anders valt het
  // terug op lokale PDF-tekstherkenning (gratis, ruwer).
  async inlezen(buffer: Buffer): Promise<InleesResultaat> {
    if (process.env.ANTHROPIC_API_KEY) {
      try {
        return await this.inlezenAI(buffer);
      } catch (e) {
        // AI mislukt (geen krediet, netwerk, ...) -> lokaal proberen, met melding.
        const lokaal = await this.inlezenLokaal(buffer);
        lokaal.waarschuwing =
          'AI-herkenning mislukte, lokale herkenning gebruikt: ' +
          (e instanceof Error ? e.message : 'onbekende fout');
        return lokaal;
      }
    }
    const lokaal = await this.inlezenLokaal(buffer);
    lokaal.waarschuwing =
      'Geen ANTHROPIC_API_KEY ingesteld — lokale (ruwere) herkenning gebruikt. ' +
      'Zet een sleutel in backend/.env voor nauwkeurige AI-herkenning.';
    return lokaal;
  }

  // --- AI-herkenning via Claude (leest de PDF-layout zelf) ---
  private async inlezenAI(buffer: Buffer): Promise<InleesResultaat> {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const b64 = buffer.toString('base64');

    const schema = {
      type: 'object',
      additionalProperties: false,
      properties: {
        leverancier: { type: 'string' },
        regels: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              omschrijving: { type: 'string' },
              aantal: { type: 'number' },
              eenheidsprijs: { type: 'number' },
              btwPercentage: { type: 'number' },
            },
            required: ['omschrijving', 'aantal', 'eenheidsprijs'],
          },
        },
      },
      required: ['regels'],
    };

    const prompt =
      'Dit is een leveranciersfactuur (vaak wijn/drank, Nederlands/Frans). ' +
      'Haal de leverancier en elke bestelregel eruit: omschrijving (naam van het ' +
      'product, incl. jaartal indien vermeld), aantal (stuks/flessen), en de ' +
      'eenheidsprijs = inkoopprijs per stuk EXCLUSIEF BTW. Geef indien zichtbaar ' +
      'het btwPercentage per regel. Negeer transport-, statiegeld- en totaalregels. ' +
      'Antwoord uitsluitend met het JSON-object volgens het schema.';

    // output_config is nog niet in alle SDK-typings aanwezig -> als any doorgeven.
    const params: any = {
      model: MODEL,
      max_tokens: 8000,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: b64 },
            },
            { type: 'text', text: prompt },
          ],
        },
      ],
      output_config: { format: { type: 'json_schema', schema } },
    };

    const resp: any = await client.messages.create(params);
    if (resp.stop_reason === 'refusal') {
      throw new Error('AI weigerde de factuur te lezen.');
    }
    const tekst =
      (resp.content || []).find((b: any) => b.type === 'text')?.text ?? '';
    let data: any;
    try {
      data = JSON.parse(tekst);
    } catch {
      throw new Error('AI gaf geen geldige JSON terug.');
    }
    const regels: FactuurRegel[] = (data.regels || [])
      .map((r: any) => ({
        omschrijving: String(r.omschrijving || '').trim(),
        aantal: Number(r.aantal) || 0,
        eenheidsprijs: Number(r.eenheidsprijs) || 0,
        btwPercentage: r.btwPercentage != null ? Number(r.btwPercentage) : undefined,
      }))
      .filter((r: FactuurRegel) => r.omschrijving && r.aantal > 0);
    return { bron: 'ai', leverancier: data.leverancier, regels };
  }

  // --- Lokale herkenning: PDF-tekst uitlezen + regelherkenning ---
  // De prijsregel ziet er zo uit:  <aantal><eenheid>€ <eenheidsprijs>€ <totaal>
  // bv. "3Fles€ 14,03€ 42,09"  of  "2Tray 24 st€ 28,97€ 57,93".
  // De omschrijving staat ervoor (soms verspreid over de vorige regels).
  private async inlezenLokaal(buffer: Buffer): Promise<InleesResultaat> {
    const data = await pdfParse(buffer);
    const lines: string[] = (data.text || '')
      .split('\n')
      .map((l: string) => l.trim())
      .filter(Boolean);

    const PRIJS = /(\d+)\s*(?:Flessen|Fles|Stuks|Stuk|Tray[^€]*|Bak[^€]*|st)\s*€\s*([\d.]+,\d{2})\s*€\s*[\d.]+,\d{2}/i;
    const KOP = /omschrijving/i;
    const HEAD_END = /^(Subtotaal|Totaal|BTW|Gratis|Verzend)/i;

    const regels: FactuurRegel[] = [];
    let gestart = false;
    let leverancier: string | undefined;
    let omschr: string[] = [];

    for (const line of lines) {
      if (!gestart) {
        if (/wijnhuis|bollaert|niemegeerts|nv|bvba|bv\b/i.test(line) && !leverancier) {
          leverancier = line;
        }
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
        const prijs = Number(m[2].replace(/\./g, '').replace(',', '.'));
        if (naam.length > 2 && aantal > 0 && prijs > 0) {
          regels.push({ omschrijving: naam, aantal, eenheidsprijs: prijs });
        }
        omschr = [];
      } else {
        omschr.push(line);
      }
    }
    return { bron: 'lokaal', leverancier, regels };
  }

  // Verwerkt de gecontroleerde regels: maakt nieuwe producten aan of boekt op
  // bestaande, en boekt de voorraad bij op de gekozen locatie.
  async verwerken(regels: VerwerkRegel[], locatieId: string) {
    if (!regels?.length) throw new BadRequestException('Geen regels om te verwerken.');
    if (!locatieId) throw new BadRequestException('Geen locatie gekozen.');

    let nieuw = 0;
    let bijgeboekt = 0;

    for (const r of regels) {
      let productId = r.productId || null;

      if (productId) {
        // Bestaand product: inkoop-/verkoopprijs bijwerken (optioneel).
        await this.prisma.product.update({
          where: { id: productId },
          data: {
            inkoopprijs: new Prisma.Decimal(r.inkoopprijs),
            verkoopprijs: new Prisma.Decimal(r.verkoopprijs),
          },
        });
        bijgeboekt++;
      } else {
        // Nieuw product aanmaken (auto-barcode via de productenservice).
        const p = await this.products.create({
          naam: r.naam,
          verkoopprijs: r.verkoopprijs,
          inkoopprijs: r.inkoopprijs,
          isAlcohol: r.isAlcohol ?? false,
          btwTariefId: r.btwTariefId,
          leverancierId: r.leverancierId ?? null,
          categorieId: r.categorieId ?? null,
        });
        productId = p.id;
        nieuw++;
      }

      await this.stock.ontvangst({ productId, locatieId, aantal: r.aantal });
    }

    return { nieuw, bijgeboekt, totaal: regels.length };
  }
}
