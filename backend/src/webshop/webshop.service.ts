import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SalesService } from '../sales/sales.service';

// Publieke webshop-catalogus. Toont ENKEL producten die actief zijn én
// als "toon in webshop" gemarkeerd staan. Een product offline zetten aan de
// kassa (actief=false) haalt het dus automatisch uit de webshop.
const WEBSHOP_WHERE = { actief: true, webshopZichtbaar: true } as const;

export type BestellingInput = {
  lijnen: { productId: string; aantal: number }[];
  klant: { naam: string; email: string; telefoon?: string; adres?: string };
  leverwijze: 'AFHALEN' | 'LEVEREN';
  betaalwijze?: 'ACHTERAF' | 'ONLINE'; // ONLINE = Axepta (nu in testmodus)
};

@Injectable()
export class WebshopService {
  constructor(private prisma: PrismaService, private sales: SalesService) {}

  producten(afdelingId?: string) {
    return this.prisma.product.findMany({
      where: { ...WEBSHOP_WHERE, ...(afdelingId ? { afdelingId } : {}) },
      select: {
        id: true, naam: true, verkoopprijs: true, isAlcohol: true, eenheid: true,
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

  // Plaatst een webshop-bestelling: maakt/vindt de klant, past een eventuele
  // e-mailkorting toe en boekt de verkoop via het WEBSHOP-kanaal (betalen bij
  // afhaling/levering; status NIEUW). Verlaagt dezelfde winkelstock.
  async bestelling(input: BestellingInput) {
    if (!input.lijnen?.length) throw new BadRequestException('Je winkelmandje is leeg.');
    if (!input.klant?.naam?.trim() || !input.klant?.email?.trim()) throw new BadRequestException('Naam en e-mail zijn vereist.');
    if (input.leverwijze === 'LEVEREN' && !input.klant.adres?.trim()) throw new BadRequestException('Geef een leveradres op.');

    const email = input.klant.email.trim().toLowerCase();
    let klant = await this.prisma.klant.findFirst({ where: { email } });
    if (!klant) {
      klant = await this.prisma.klant.create({
        data: { naam: input.klant.naam.trim(), email, adres: input.klant.adres?.trim() || null },
      });
    } else {
      klant = await this.prisma.klant.update({
        where: { id: klant.id },
        data: { naam: input.klant.naam.trim(), adres: input.klant.adres?.trim() || klant.adres },
      });
    }

    // E-mailkorting (personeel / friends & family) uit het register.
    const begunstigde = await this.prisma.kortingsBegunstigde.findUnique({ where: { email }, include: { regeling: true } });
    const regeling = begunstigde?.regeling?.actief ? begunstigde.regeling : null;
    const pct = regeling ? Number(regeling.pct) : 0;
    const kortingReden = regeling ? `${regeling.naam} ${pct}%` : undefined;

    const ticket = await this.sales.afrekenen({
      lijnen: input.lijnen.map((l) => ({ productId: l.productId, aantal: l.aantal, kortingPct: pct || undefined })),
      kanaal: 'WEBSHOP',
      klantId: klant.id,
      leverwijze: input.leverwijze,
      status: 'NIEUW',
      kortingReden,
    });

    // Online betaling (Axepta). Nu in TESTMODUS: we markeren de bestelling en
    // laten de frontend de betaling simuleren. In LIVE start hier de echte
    // Axepta-sessie (redirect + webhook).
    const online = input.betaalwijze === 'ONLINE';
    let betaalUrl: string | null = null;
    if (online) {
      if (this.betaalModus() === 'LIVE') {
        betaalUrl = await this.startAxepta(ticket.id, ticket.totaal);
      } else {
        await this.prisma.verkoop.update({ where: { id: ticket.id }, data: { betaalRef: 'TEST-' + ticket.id } });
      }
    }

    return {
      ...ticket, leverwijze: input.leverwijze, status: 'NIEUW',
      klant: { naam: klant.naam, email: klant.email },
      online, betaalModus: this.betaalModus(), betaalUrl, betaald: false,
    };
  }

  // TEST zolang er geen Axepta-sleutels zijn ingesteld; anders LIVE.
  betaalModus(): 'TEST' | 'LIVE' {
    return process.env.AXEPTA_MERCHANT_ID ? 'LIVE' : 'TEST';
  }

  // Enige plek waar de echte Axepta-betaalsessie aangemaakt wordt (later live
  // te zetten met de sleutels van de klant). Retourneert de redirect-URL.
  private async startAxepta(_verkoopId: string, _bedrag: number): Promise<string> {
    // TODO (live): REST-call "Create checkout session" naar Axepta BNP Paribas
    // (AXEPTA_BASE_URL, AXEPTA_MERCHANT_ID, AXEPTA_HMAC_KEY, AXEPTA_CRYPTO_KEY),
    // met return/cancel/webhook-URL's; return de Hosted Payment Page-URL.
    throw new BadRequestException('Axepta is nog niet geconfigureerd (sleutels ontbreken).');
  }

  // Testmodus-simulatie van de betaling (in LIVE komt dit via de Axepta-webhook).
  async betalingAfronden(verkoopId: string, gelukt: boolean) {
    if (gelukt) await this.prisma.verkoop.update({ where: { id: verkoopId }, data: { betaald: true } });
    return { betaald: !!gelukt };
  }

  // Beheer: alle webshop-bestellingen (nieuwste eerst).
  bestellingen() {
    return this.prisma.verkoop.findMany({
      where: { kanaal: 'WEBSHOP' },
      include: { klant: true, lijnen: { include: { product: true } } },
      orderBy: { datum: 'desc' },
      take: 500,
    });
  }

  async updateStatus(id: string, status: string) {
    return this.prisma.verkoop.update({ where: { id }, data: { status } });
  }
}
