import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { Betaalwijze, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

// Wettelijke cash-limiet in België: max. €3.000 contant per transactie.
const CASH_LIMIET = 3000;

// Eén verkoopregel zoals de kassa ze aanlevert: enkel wat + hoeveel.
// De server bepaalt zelf prijs en BTW (nooit vertrouwen op de client).
export type AfrekenLijn = { productId: string; aantal: number; kortingPct?: number; bedrag?: number };

export type AfrekenInput = {
  lijnen: AfrekenLijn[];
  betaalwijze?: Betaalwijze; // optioneel bij webshop (betalen bij afhaling/levering)
  ontvangen?: number; // enkel bij CASH, om het wisselgeld te berekenen
  gebruikerId?: string;
  kortingReden?: string; // bv. "Personeel 20%" — reden van de korting
  verkoopKortingPct?: number; // verkoopbrede korting (0-100%), los van de lijnkorting
  // webshop-velden
  kanaal?: 'KASSA' | 'WEBSHOP';
  klantId?: string;
  leverwijze?: string; // AFHALEN | LEVEREN
  status?: string; // NIEUW | ... (webshopbestelling)
  // "op rekening": geboekt op een bedrijf + personeelslid
  rekeningBedrijfId?: string;
  rekeningLidId?: string;
  // offline-buffer: unieke sleutel; bestaat de verkoop al, dan geven we die terug
  idempotencyKey?: string;
};

// Werk met centen om afrondingsfouten met kommagetallen te vermijden.
const naarCent = (n: number) => Math.round(n * 100);
const naarEuro = (c: number) => c / 100;

@Injectable()
export class SalesService {
  constructor(private prisma: PrismaService) {}

  // Rekent een verkoop af: schrijft de verkoop + lijnen weg, verlaagt de
  // winkelstock en berekent de BTW per lijn. Alles in één transactie zodat
  // een verkoop nooit half wordt bewaard.
  async afrekenen(input: AfrekenInput) {
    const { lijnen, betaalwijze, ontvangen, gebruikerId, kortingReden, kanaal, klantId, leverwijze, status, rekeningBedrijfId, rekeningLidId, idempotencyKey } = input;
    // Verkoopbrede korting (geldt op elke lijn, bovenop een eventuele lijnkorting).
    const verkoopKorting = Math.min(Math.max(Number(input.verkoopKortingPct) || 0, 0), 100);

    if (!lijnen?.length) {
      throw new BadRequestException('Geen verkoopregels.');
    }

    // Al eerder verwerkt (bv. een offline verkoop die opnieuw gesynct wordt)?
    // Geef dan gewoon het bestaande ticket terug, zonder dubbel te boeken.
    if (idempotencyKey) {
      const bestaande = await this.prisma.verkoop.findUnique({
        where: { idempotencyKey },
        include: { lijnen: { include: { product: true } }, gebruiker: true },
      });
      if (bestaande) return this.metTicket(bestaande, ontvangen);
    }

    // De kassa is (voorlopig) enkel voor de winkel: bepaal de winkel-
    // onderneming (niet-importeur) en de winkellocatie.
    const onderneming = await this.prisma.onderneming.findFirst({
      where: { isImporteur: false },
    });
    if (!onderneming) {
      throw new NotFoundException('Geen winkel-onderneming gevonden.');
    }
    const locatie = await this.prisma.stockLocatie.findFirst({
      where: { type: 'WINKEL', actief: true },
    });
    if (!locatie) {
      throw new NotFoundException('Geen actieve winkellocatie gevonden.');
    }

    // Producten ophalen (met BTW-tarief) en regels valideren.
    const productIds = [...new Set(lijnen.map((l) => l.productId))];
    const producten = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      include: { btwTarief: true },
    });
    const perId = new Map(producten.map((p) => [p.id, p]));

    let totaalCent = 0;
    const lijnData = lijnen.map((l) => {
      const product = perId.get(l.productId);
      if (!product) {
        throw new NotFoundException(`Onbekend product: ${l.productId}`);
      }
      // Een negatief aantal is een retour/correctie (trekt af, ook van een
      // lopende rekening); enkel 0 of een niet-getal is ongeldig.
      if (!l.aantal || Number.isNaN(Number(l.aantal))) {
        throw new BadRequestException(`Ongeldig aantal voor ${product.naam}.`);
      }
      // verkoopprijs is de consumentenprijs INCL. BTW.
      const pct = Number(product.btwTarief.percentage);
      // korting per lijn (0-100%): verlaagt de effectieve stukprijs.
      const korting = Math.min(Math.max(Number(l.kortingPct) || 0, 0), 100);
      // "Diversen"/vrij-bedrag: enkel producten met vrijePrijs mogen een eigen
      // bedrag meesturen (kassier tikt het in). Anders altijd de vaste prijs.
      const vrij = product.vrijePrijs && Number(l.bedrag) > 0;
      const stukCent = vrij ? naarCent(Number(l.bedrag)) : naarCent(Number(product.verkoopprijs));
      const aantal = l.aantal; // bedrag is de stukprijs; aantal telt (ook bij diversen)
      // Eerst de lijnkorting, dan de verkoopbrede korting (gestapeld).
      const naLijnKortingCent = stukCent * (1 - korting / 100);
      const effUnitCent = Math.round(naLijnKortingCent * (1 - verkoopKorting / 100));
      const brutoCent = Math.round(effUnitCent * aantal);
      // BTW uit een incl.-prijs: btw = bruto - bruto / (1 + pct/100)
      const exclCent = Math.round(brutoCent / (1 + pct / 100));
      const btwCent = brutoCent - exclCent;
      totaalCent += brutoCent;

      return {
        productId: product.id,
        aantal: new Prisma.Decimal(aantal),
        eenheidsprijs: new Prisma.Decimal(naarEuro(effUnitCent)),
        inkoopprijs: product.inkoopprijs ?? null, // momentopname voor margeberekening
        kortingPct: korting > 0 ? new Prisma.Decimal(korting) : null,
        btwPercentage: product.btwTarief.percentage,
        btwBedrag: new Prisma.Decimal(naarEuro(btwCent)),
      };
    });

    const totaal = naarEuro(totaalCent);

    // Cash-limiet €3.000 (wettelijk).
    if (betaalwijze === 'CASH' && totaal > CASH_LIMIET) {
      throw new BadRequestException(
        `Cash betaling van € ${totaal.toFixed(2)} overschrijdt de wettelijke limiet van € ${CASH_LIMIET}.`,
      );
    }

    const verkoop = await this.prisma.$transaction(async (tx) => {
      const v = await tx.verkoop.create({
        data: {
          ondernemingId: onderneming.id,
          locatieId: locatie.id,
          gebruikerId: gebruikerId ?? null,
          klantId: klantId ?? null,
          kanaal: kanaal ?? 'KASSA',
          betaalwijze: betaalwijze ?? null,
          leverwijze: leverwijze ?? null,
          status: status ?? null,
          rekeningBedrijfId: rekeningBedrijfId ?? null,
          rekeningLidId: rekeningLidId ?? null,
          totaal: new Prisma.Decimal(totaal),
          kortingReden: kortingReden ?? null,
          verkoopKortingPct: verkoopKorting > 0 ? new Prisma.Decimal(verkoopKorting) : null,
          idempotencyKey: idempotencyKey ?? null,
          lijnen: { create: lijnData },
        },
        include: { lijnen: { include: { product: true } }, gebruiker: true },
      });

      // Winkelstock verlagen. Bestaat er nog geen voorraadregel voor dit
      // product op deze locatie, dan maken we ze aan (kan negatief worden —
      // dat is een signaal dat de stock niet klopte, niet een blokkering).
      for (const l of lijnen) {
        // Diversen/cadeaubon (vrijePrijs) hebben geen voorraad — overslaan.
        if (perId.get(l.productId)?.vrijePrijs) continue;
        await tx.voorraad.upsert({
          where: {
            productId_locatieId: { productId: l.productId, locatieId: locatie.id },
          },
          create: {
            productId: l.productId,
            locatieId: locatie.id,
            aantal: new Prisma.Decimal(-l.aantal),
          },
          update: { aantal: { decrement: l.aantal } },
        });
      }

      return v;
    });

    return this.metTicket(verkoop, ontvangen);
  }

  // Lijst van recente verkopen (voor het terugvinden/herafdrukken van tickets).
  async recente(datum?: string) {
    let where: Prisma.VerkoopWhereInput = {};
    if (datum) {
      const start = new Date(`${datum}T00:00:00`);
      const eind = new Date(start);
      eind.setDate(eind.getDate() + 1);
      where = { datum: { gte: start, lt: eind } };
    }
    const rows = await this.prisma.verkoop.findMany({
      where,
      include: { gebruiker: true, _count: { select: { lijnen: true } } },
      orderBy: { datum: 'desc' },
      take: 200,
    });
    return rows.map((v) => ({
      id: v.id,
      datum: v.datum,
      totaal: Number(v.totaal),
      betaalwijze: v.betaalwijze,
      kanaal: v.kanaal,
      leverwijze: v.leverwijze,
      verkoper: v.gebruiker?.naam ?? null,
      aantalLijnen: v._count.lijnen,
      afgesloten: v.afgesloten,
      geannuleerd: v.geannuleerd,
    }));
  }

  // Annuleert (schrapt) een verkoop: telt niet meer mee in de dagafsluiting of
  // omzet en de voorraad wordt teruggeboekt. Kan niet meer als de verkoop al in
  // een afgesloten dagafsluiting (Z-rapport) zit — dat is wettelijk onwijzigbaar.
  async annuleer(id: string, reden?: string) {
    const verkoop = await this.prisma.verkoop.findUnique({
      where: { id },
      include: { lijnen: { include: { product: true } } },
    });
    if (!verkoop) throw new NotFoundException('Verkoop niet gevonden.');
    if (verkoop.geannuleerd) throw new BadRequestException('Deze verkoop is al geannuleerd.');
    if (verkoop.afgesloten) throw new BadRequestException('Deze verkoop zit al in een afgesloten dagafsluiting en kan niet meer geannuleerd worden.');

    return this.prisma.$transaction(async (tx) => {
      // Voorraad terugboeken (spiegelbeeld van het afrekenen): diversen/vrijePrijs
      // hebben geen voorraad. Het teken van l.aantal (negatief bij retour) klopt vanzelf.
      for (const l of verkoop.lijnen) {
        if (l.product?.vrijePrijs) continue;
        if (!verkoop.locatieId) continue;
        await tx.voorraad.upsert({
          where: { productId_locatieId: { productId: l.productId, locatieId: verkoop.locatieId } },
          create: { productId: l.productId, locatieId: verkoop.locatieId, aantal: new Prisma.Decimal(Number(l.aantal)) },
          update: { aantal: { increment: Number(l.aantal) } },
        });
      }
      const bij = await tx.verkoop.update({
        where: { id },
        data: { geannuleerd: true, geannuleerdOp: new Date(), geannuleerdReden: reden ?? null },
        include: { lijnen: { include: { product: true } }, gebruiker: true },
      });
      return this.metTicket(bij);
    });
  }

  // Wijzigt de betaalwijze van een bestaande verkoop (bv. verkeerd aangeduid).
  // Niet toegestaan als de verkoop al in een afgesloten dagafsluiting zit.
  async wijzigBetaalwijze(id: string, betaalwijze: Betaalwijze) {
    if (!Object.values(Betaalwijze).includes(betaalwijze)) {
      throw new BadRequestException('Ongeldige betaalwijze.');
    }
    const verkoop = await this.prisma.verkoop.findUnique({ where: { id } });
    if (!verkoop) throw new NotFoundException('Verkoop niet gevonden.');
    if (verkoop.afgesloten) throw new BadRequestException('Deze verkoop zit al in een afgesloten dagafsluiting; de betaalwijze kan niet meer gewijzigd worden.');
    const bij = await this.prisma.verkoop.update({
      where: { id },
      data: { betaalwijze },
      include: { lijnen: { include: { product: true } }, gebruiker: true },
    });
    return this.metTicket(bij);
  }

  // Haalt een bestaande verkoop op om het ticket opnieuw te tonen/printen.
  async ticket(id: string) {
    const verkoop = await this.prisma.verkoop.findUnique({
      where: { id },
      include: { lijnen: { include: { product: true } }, gebruiker: true },
    });
    if (!verkoop) throw new NotFoundException('Verkoop niet gevonden.');
    return this.metTicket(verkoop);
  }

  // Bouwt het ticket-overzicht: BTW gegroepeerd per tarief + wisselgeld.
  private metTicket(
    verkoop: Prisma.VerkoopGetPayload<{
      include: { lijnen: { include: { product: true } }; gebruiker: true };
    }>,
    ontvangen?: number,
  ) {
    const perTarief = new Map<
      string,
      { percentage: number; maatstaf: number; btw: number }
    >();

    for (const l of verkoop.lijnen) {
      const pct = Number(l.btwPercentage);
      const bruto = Number(l.eenheidsprijs) * Number(l.aantal);
      const btw = Number(l.btwBedrag);
      const key = pct.toFixed(2);
      const rij = perTarief.get(key) ?? { percentage: pct, maatstaf: 0, btw: 0 };
      rij.maatstaf += bruto - btw; // bedrag excl. BTW
      rij.btw += btw;
      perTarief.set(key, rij);
    }

    const btwOverzicht = [...perTarief.values()]
      .sort((a, b) => a.percentage - b.percentage)
      .map((r) => ({
        percentage: r.percentage,
        maatstaf: Math.round(r.maatstaf * 100) / 100,
        btw: Math.round(r.btw * 100) / 100,
      }));

    const totaal = Number(verkoop.totaal);
    const teruggeven =
      verkoop.betaalwijze === 'CASH' && ontvangen != null
        ? Math.round((ontvangen - totaal) * 100) / 100
        : null;

    // De opgeslagen lijnprijzen bevatten zowel de lijnkorting als de verkoopbrede
    // korting. Voor het ticket tonen we per lijn het bedrag ná lijnkorting maar
    // vóór de verkoopbrede korting; die laatste komt apart bij het totaal.
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const saleKorting = verkoop.verkoopKortingPct != null ? Number(verkoop.verkoopKortingPct) : 0;
    const saleFactor = 1 - saleKorting / 100;
    const lijnen = verkoop.lijnen.map((l) => {
      const aantal = Number(l.aantal);
      const finalLineTotal = Number(l.eenheidsprijs) * aantal; // beide kortingen
      const naLijnTotal = saleKorting > 0 ? finalLineTotal / saleFactor : finalLineTotal; // vóór verkoopkorting
      const lineKorting = l.kortingPct != null ? Number(l.kortingPct) : 0;
      const origineelTotaal = lineKorting > 0 ? r2(naLijnTotal / (1 - lineKorting / 100)) : null;
      return {
        naam: l.product.naam,
        aantal,
        eenheidsprijs: r2(naLijnTotal / aantal),
        btwPercentage: Number(l.btwPercentage),
        totaal: r2(naLijnTotal),
        kortingPct: lineKorting > 0 ? lineKorting : null,
        origineelTotaal,
      };
    });
    const subtotaal = r2(lijnen.reduce((s, l) => s + l.totaal, 0));

    return {
      id: verkoop.id,
      datum: verkoop.datum,
      betaalwijze: verkoop.betaalwijze,
      verkoper: verkoop.gebruiker?.naam ?? null,
      kortingReden: verkoop.kortingReden ?? null,
      verkoopKortingPct: saleKorting > 0 ? saleKorting : null,
      subtotaal,
      totaal,
      ontvangen: ontvangen ?? null,
      teruggeven,
      lijnen,
      btwOverzicht,
    };
  }
}
