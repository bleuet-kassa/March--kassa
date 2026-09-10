import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from '../push/push.service';

// Verkoop met lijnen + product-categorie + klant + betalingen (voor het rapport).
type VerkoopVol = Prisma.VerkoopGetPayload<{
  include: { lijnen: { include: { product: { include: { categorie: true } } } }; klant: true; betalingen: true };
}>;

const LIJN_INCLUDE = { lijnen: { include: { product: { include: { categorie: true } } } }, klant: true, betalingen: true } as const;

const r2 = (n: number) => Math.round(n * 100) / 100;

@Injectable()
export class DagafsluitingService {
  constructor(private prisma: PrismaService, private push: PushService) {}

  private async winkelLocatie() {
    const locatie = await this.prisma.stockLocatie.findFirst({
      where: { type: 'WINKEL', actief: true },
    });
    if (!locatie) throw new NotFoundException('Geen actieve winkellocatie.');
    return locatie;
  }
  private winkelOnderneming() {
    return this.prisma.onderneming.findFirst({ where: { isImporteur: false } });
  }

  private openVerkopen(locatieId: string) {
    return this.prisma.verkoop.findMany({
      where: { locatieId, kanaal: 'KASSA', afgesloten: false, geannuleerd: false },
      include: LIJN_INCLUDE,
      orderBy: { datum: 'asc' },
    });
  }

  // BTW per lijn: eenheidsprijs is incl. BTW; btwBedrag is de BTW van de lijn.
  private lijnBedragen(v: VerkoopVol) {
    let incl = 0;
    let btw = 0;
    const perTarief = new Map<string, { percentage: number; maatstaf: number; btw: number }>();
    for (const l of v.lijnen) {
      const pct = Number(l.btwPercentage);
      // Gebruik het exact aangerekende lijntotaal; enkel voor oudere lijnen zonder
      // dat veld herberekenen (en per lijn op de cent afronden), zodat de totalen
      // exact op het echt betaalde dagbedrag uitkomen.
      const lijnIncl = l.lijnTotaal != null ? Number(l.lijnTotaal) : r2(Number(l.eenheidsprijs) * Number(l.aantal));
      const lijnBtw = Number(l.btwBedrag);
      incl += lijnIncl;
      btw += lijnBtw;
      const key = pct.toFixed(2);
      const rij = perTarief.get(key) ?? { percentage: pct, maatstaf: 0, btw: 0 };
      rij.maatstaf += lijnIncl - lijnBtw;
      rij.btw += lijnBtw;
      perTarief.set(key, rij);
    }
    return { incl, btw, perTarief };
  }

  // Bouwt het volledige dagontvangsten-rapport uit een set verkopen.
  // Splitst wettelijk: particuliere ontvangsten (dagontvangstenboek) vs.
  // uitgereikte B2B-facturen (facturenboek) — die laatste apart, niet dubbel.
  private bouwRapport(
    verkopen: VerkoopVol[],
    meta: {
      volgnummer: number | null;
      vanaf: Date | null;
      tot: Date;
      verkoper: string | null;
      onderneming: { naam: string; ondernemingsnummer: string; btwNummer: string | null; adres: string | null } | null;
      locatie: string;
    },
  ) {
    const perBetaalwijze: Record<string, number> = {};
    const perBtw = new Map<string, { percentage: number; maatstaf: number; btw: number }>();
    const perCat = new Map<string, number>(); // categorie -> omzet incl. BTW (voor op het ticket; GEEN marge)
    let ontvExcl = 0, ontvBtw = 0, ontvIncl = 0, ontvAantal = 0;
    // "Eigen rekening" (eigen gebruik): apart bijgehouden, telt NIET als ontvangst/omzet.
    let eigenAantal = 0, eigenIncl = 0;

    const facturen: { ref: string; datum: string; klant: string; btwNummer: string | null; excl: number; btw: number; incl: number }[] = [];
    const facExcl = 0, facBtw = 0, facIncl = 0;

    // Eén dagontvangsten-ticket: alle winkelverkopen samen, met de BTW gewoon
    // uitgesplitst per tarief (6% / 21%) en de omzet per categorie.
    for (const v of verkopen) {
      const { incl, btw, perTarief } = this.lijnBedragen(v);
      // Eigen gebruik ("Eigen rekening"): apart, niet in de ontvangsten/omzet/BTW.
      if (v.betaalwijze === 'EIGEN_REKENING') {
        eigenAantal++; eigenIncl += incl;
        continue;
      }
      ontvAantal++;
      ontvIncl += incl; ontvBtw += btw; ontvExcl += incl - btw;
      // Per betaalwijze: bij een gesplitste betaling elk deelbedrag bij de juiste
      // betaalwijze; anders het volledige bedrag. Verkopen zonder betaling(en) én
      // zonder betaalwijze zijn "op rekening" (later gefactureerd).
      if (v.betalingen && v.betalingen.length) {
        for (const b of v.betalingen) {
          perBetaalwijze[b.betaalwijze] = r2((perBetaalwijze[b.betaalwijze] ?? 0) + Number(b.bedrag));
        }
      } else {
        const bw = v.betaalwijze ?? (v.rekeningBedrijfId ? 'OP_REKENING' : 'ONBEKEND');
        perBetaalwijze[bw] = r2((perBetaalwijze[bw] ?? 0) + incl);
      }
      for (const t of perTarief.values()) {
        const k = t.percentage.toFixed(2);
        const rij = perBtw.get(k) ?? { percentage: t.percentage, maatstaf: 0, btw: 0 };
        rij.maatstaf += t.maatstaf; rij.btw += t.btw;
        perBtw.set(k, rij);
      }
      for (const l of v.lijnen) {
        const cat = l.product.categorie?.naam ?? 'Overig';
        perCat.set(cat, (perCat.get(cat) ?? 0) + (l.lijnTotaal != null ? Number(l.lijnTotaal) : r2(Number(l.eenheidsprijs) * Number(l.aantal))));
      }
    }

    const perBtwTarief = [...perBtw.values()]
      .sort((a, b) => a.percentage - b.percentage)
      .map((t) => ({ percentage: t.percentage, maatstaf: r2(t.maatstaf), btw: r2(t.btw) }));
    const perCategorie = [...perCat.entries()]
      .map(([categorie, omzetIncl]) => ({ categorie, omzetIncl: r2(omzetIncl) }))
      .sort((a, b) => b.omzetIncl - a.omzetIncl);

    return {
      volgnummer: meta.volgnummer,
      onderneming: meta.onderneming,
      locatie: meta.locatie,
      verkoper: meta.verkoper,
      vanaf: meta.vanaf,
      tot: meta.tot,
      dagontvangsten: {
        aantal: ontvAantal,
        perBetaalwijze,
        perBtwTarief,
        perCategorie,
        totaalExcl: r2(ontvExcl),
        totaalBtw: r2(ontvBtw),
        totaalIncl: r2(ontvIncl),
      },
      // Eigen gebruik: apart vermeld, telt niet mee in de dagontvangsten hierboven.
      eigenGebruik: { aantal: eigenAantal, incl: r2(eigenIncl) },
      facturen,
      facturenTotaal: { aantal: facturen.length, excl: r2(facExcl), btw: r2(facBtw), incl: r2(facIncl) },
      algemeenTotaalIncl: r2(ontvIncl + facIncl),
    };
  }

  // Voorbeeld van het dagontvangsten-rapport (nog niet afgesloten).
  async overzicht() {
    const [locatie, onderneming] = await Promise.all([this.winkelLocatie(), this.winkelOnderneming()]);
    const verkopen = await this.openVerkopen(locatie.id);
    return this.bouwRapport(verkopen, {
      volgnummer: null,
      vanaf: verkopen[0]?.datum ?? null,
      tot: new Date(),
      verkoper: null,
      onderneming: onderneming ? { naam: onderneming.naam, ondernemingsnummer: onderneming.ondernemingsnummer, btwNummer: onderneming.btwNummer, adres: onderneming.adres } : null,
      locatie: locatie.naam,
    });
  }

  // Sluit de dag af: bewaart het rapport onwijzigbaar (met volgnummer) en
  // koppelt de verkopen eraan. Geeft het volledige ticket terug om af te drukken.
  async afsluiten(gebruikerId?: string) {
    const [locatie, onderneming] = await Promise.all([this.winkelLocatie(), this.winkelOnderneming()]);
    const verkoperNaam = gebruikerId
      ? (await this.prisma.gebruiker.findUnique({ where: { id: gebruikerId } }))?.naam ?? null
      : null;

    return this.prisma.$transaction(async (tx) => {
      const verkopen = (await tx.verkoop.findMany({
        where: { locatieId: locatie.id, kanaal: 'KASSA', afgesloten: false, geannuleerd: false },
        include: LIJN_INCLUDE,
        orderBy: { datum: 'asc' },
      })) as VerkoopVol[];

      const nu = new Date();
      const vanaf = verkopen[0]?.datum ?? nu;
      const volgnummer = (await tx.dagafsluiting.count()) + 1;

      const rapport = this.bouwRapport(verkopen, {
        volgnummer,
        vanaf,
        tot: nu,
        verkoper: verkoperNaam,
        onderneming: onderneming ? { naam: onderneming.naam, ondernemingsnummer: onderneming.ondernemingsnummer, btwNummer: onderneming.btwNummer, adres: onderneming.adres } : null,
        locatie: locatie.naam,
      });

      // Dagtotaal = de echte ontvangsten; eigen gebruik ("Eigen rekening") telt niet mee.
      const totaalIncl = verkopen
        .filter((v) => v.betaalwijze !== 'EIGEN_REKENING')
        .reduce((s, v) => s + Number(v.totaal), 0);
      const afsluiting = await tx.dagafsluiting.create({
        data: {
          volgnummer,
          locatieId: locatie.id,
          ondernemingId: onderneming?.id ?? null,
          gebruikerId: gebruikerId ?? null,
          vanaf,
          tot: nu,
          aantalVerkopen: verkopen.length,
          totaal: new Prisma.Decimal(r2(totaalIncl)),
          perBetaalwijze: rapport.dagontvangsten.perBetaalwijze as Prisma.InputJsonValue,
          perBtwTarief: rapport.dagontvangsten.perBtwTarief as Prisma.InputJsonValue,
        },
      });

      if (verkopen.length) {
        await tx.verkoop.updateMany({
          where: { id: { in: verkopen.map((v) => v.id) } },
          data: { afgesloten: true, dagafsluitingId: afsluiting.id },
        });
      }

      return { id: afsluiting.id, ...rapport };
    });
  }

  // ---- Dagafsluiting op afstand bevestigen ----
  // De kassa vraagt de afsluiting aan; de beheerder krijgt een pushmelding op
  // de telefoon en bevestigt via een geheime link (of als ingelogde beheerder).
  // Pas bij die bevestiging wordt de echte Dagafsluiting geregistreerd.

  private publiekeUrl() {
    return (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
  }

  // Compacte weergave van een aanvraag voor de schermen (zonder de geheime token).
  aanvraagInfo(a: {
    id: string; status: string; totaal: Prisma.Decimal | number; aantalVerkopen: number;
    createdAt: Date; verlooptOp: Date; bevestigdOp: Date | null; dagafsluitingId: string | null;
    aangevraagdDoor?: { naam: string } | null;
  }) {
    return {
      id: a.id, status: a.status, totaal: Number(a.totaal), aantalVerkopen: a.aantalVerkopen,
      aangevraagdDoor: a.aangevraagdDoor?.naam ?? null, aangevraagdOp: a.createdAt,
      verlooptOp: a.verlooptOp, bevestigdOp: a.bevestigdOp, dagafsluitingId: a.dagafsluitingId,
    };
  }

  // De openstaande aanvraag (verlopen aanvragen worden eerst als VERLOPEN gemarkeerd).
  async openAanvraag() {
    await this.prisma.dagafsluitingAanvraag.updateMany({
      where: { status: 'OPEN', verlooptOp: { lt: new Date() } },
      data: { status: 'VERLOPEN' },
    });
    return this.prisma.dagafsluitingAanvraag.findFirst({
      where: { status: 'OPEN' },
      orderBy: { createdAt: 'desc' },
      include: { aangevraagdDoor: { select: { naam: true } } },
    });
  }

  // Nieuwe aanvraag (of de bestaande openstaande) + pushmelding naar de beheerders.
  async aanvraag(gebruikerId?: string) {
    const bestaand = await this.openAanvraag();
    if (bestaand) {
      // Al aangevraagd: melding nog eens sturen (herinnering), geen dubbele aanvraag.
      const push = await this.push.naarBeheerders(this.melding(bestaand));
      return { ...this.aanvraagInfo(bestaand), push, herinnering: true };
    }
    const overzicht = await this.overzicht();
    const aantal = overzicht.dagontvangsten.aantal + overzicht.facturen.length;
    if (aantal === 0) throw new BadRequestException('Er zijn vandaag nog geen verkopen om af te sluiten.');
    const token = randomBytes(24).toString('base64url');
    const a = await this.prisma.dagafsluitingAanvraag.create({
      data: {
        token,
        aangevraagdDoorId: gebruikerId ?? null,
        totaal: new Prisma.Decimal(r2(overzicht.algemeenTotaalIncl)),
        aantalVerkopen: aantal,
        verlooptOp: new Date(Date.now() + 6 * 60 * 60 * 1000), // 6 uur geldig
      },
      include: { aangevraagdDoor: { select: { naam: true } } },
    });
    const push = await this.push.naarBeheerders(this.melding(a));
    return { ...this.aanvraagInfo(a), push, herinnering: false };
  }

  private melding(a: { token: string; totaal: Prisma.Decimal | number; aantalVerkopen: number; aangevraagdDoor?: { naam: string } | null }) {
    return {
      titel: 'Dagafsluiting bevestigen',
      tekst: `${a.aangevraagdDoor?.naam ?? 'De kassa'} vraagt de dag af te sluiten: € ${Number(a.totaal).toFixed(2)} (${a.aantalVerkopen} verkopen). Tik om te bekijken en te bevestigen.`,
      url: `${this.publiekeUrl()}/bevestig-afsluiting/${a.token}`,
      tag: 'dagafsluiting',
    };
  }

  // Publiek (met geheime token): wat de beheerder op de telefoon te zien krijgt.
  async aanvraagViaToken(token: string) {
    const a = await this.prisma.dagafsluitingAanvraag.findUnique({
      where: { token },
      include: { aangevraagdDoor: { select: { naam: true } } },
    });
    if (!a) throw new NotFoundException('Aanvraag niet gevonden.');
    if (a.status === 'OPEN' && a.verlooptOp < new Date()) {
      await this.prisma.dagafsluitingAanvraag.update({ where: { id: a.id }, data: { status: 'VERLOPEN' } });
      a.status = 'VERLOPEN';
    }
    // Zolang de aanvraag openstaat: het actuele voorbeeldrapport meegeven.
    const rapport = a.status === 'OPEN' ? await this.overzicht() : null;
    return { ...this.aanvraagInfo(a), rapport };
  }

  // Bevestigen = de dag effectief afsluiten (registreren) en de aanvraag afronden.
  async bevestig(token: string, beheerderId?: string) {
    const a = await this.prisma.dagafsluitingAanvraag.findUnique({ where: { token } });
    if (!a) throw new NotFoundException('Aanvraag niet gevonden.');
    if (a.status !== 'OPEN') throw new BadRequestException(`Deze aanvraag is al ${a.status.toLowerCase()}.`);
    if (a.verlooptOp < new Date()) {
      await this.prisma.dagafsluitingAanvraag.update({ where: { id: a.id }, data: { status: 'VERLOPEN' } });
      throw new BadRequestException('Deze aanvraag is verlopen. Vraag aan de kassa een nieuwe aan.');
    }
    const rapport = await this.afsluiten(beheerderId ?? a.aangevraagdDoorId ?? undefined);
    const bij = await this.prisma.dagafsluitingAanvraag.update({
      where: { id: a.id },
      data: { status: 'BEVESTIGD', bevestigdOp: new Date(), bevestigdDoorId: beheerderId ?? null, dagafsluitingId: rapport.id },
      include: { aangevraagdDoor: { select: { naam: true } } },
    });
    return { ...this.aanvraagInfo(bij), rapport };
  }

  async weiger(token: string) {
    const a = await this.prisma.dagafsluitingAanvraag.findUnique({ where: { token } });
    if (!a) throw new NotFoundException('Aanvraag niet gevonden.');
    if (a.status !== 'OPEN') throw new BadRequestException(`Deze aanvraag is al ${a.status.toLowerCase()}.`);
    const bij = await this.prisma.dagafsluitingAanvraag.update({
      where: { id: a.id },
      data: { status: 'GEWEIGERD' },
      include: { aangevraagdDoor: { select: { naam: true } } },
    });
    return this.aanvraagInfo(bij);
  }

  // Toont een bewaarde afsluiting ONVERANDERLIJK: exact de cijfers die bij het
  // afsluiten geregistreerd werden (totaal, per betaalwijze, per BTW-tarief).
  // Zo verandert een reeds officieel geregistreerde dagontvangst nooit meer,
  // ook niet na latere codewijzigingen. Enkel de categorie-uitsplitsing en het
  // "eigen gebruik" (louter informatief, niet-officieel) worden herberekend.
  async rapport(id: string) {
    const a = await this.prisma.dagafsluiting.findUnique({
      where: { id },
      include: { onderneming: true, locatie: true, gebruiker: true },
    });
    if (!a) throw new NotFoundException('Afsluiting niet gevonden.');

    const perBetaalwijze = ((a.perBetaalwijze as unknown) as Record<string, number>) ?? {};
    const perBtwTarief = ((a.perBtwTarief as unknown) as { percentage: number; maatstaf: number; btw: number }[]) ?? [];
    const totaalBtw = r2(perBtwTarief.reduce((s, t) => s + Number(t.btw), 0));
    const totaalExcl = r2(perBtwTarief.reduce((s, t) => s + Number(t.maatstaf), 0));
    const totaalIncl = Number(a.totaal);

    // Niet-officiële extra's (informatief) herberekenen uit de gekoppelde verkopen.
    const verkopen = (await this.prisma.verkoop.findMany({
      where: { dagafsluitingId: id },
      include: LIJN_INCLUDE,
      orderBy: { datum: 'asc' },
    })) as VerkoopVol[];
    const perCat = new Map<string, number>();
    let eigenAantal = 0, eigenIncl = 0;
    for (const v of verkopen) {
      if (v.betaalwijze === 'EIGEN_REKENING') {
        eigenAantal++;
        eigenIncl += this.lijnBedragen(v).incl;
        continue;
      }
      for (const l of v.lijnen) {
        const cat = l.product.categorie?.naam ?? 'Overig';
        perCat.set(cat, (perCat.get(cat) ?? 0) + (l.lijnTotaal != null ? Number(l.lijnTotaal) : r2(Number(l.eenheidsprijs) * Number(l.aantal))));
      }
    }
    const perCategorie = [...perCat.entries()]
      .map(([categorie, omzetIncl]) => ({ categorie, omzetIncl: r2(omzetIncl) }))
      .sort((x, y) => y.omzetIncl - x.omzetIncl);

    return {
      id: a.id,
      volgnummer: a.volgnummer,
      onderneming: a.onderneming
        ? { naam: a.onderneming.naam, ondernemingsnummer: a.onderneming.ondernemingsnummer, btwNummer: a.onderneming.btwNummer, adres: a.onderneming.adres }
        : null,
      locatie: a.locatie.naam,
      verkoper: a.gebruiker?.naam ?? null,
      vanaf: a.vanaf,
      tot: a.tot,
      dagontvangsten: {
        aantal: a.aantalVerkopen,
        perBetaalwijze,
        perBtwTarief,
        perCategorie,
        totaalExcl,
        totaalBtw,
        totaalIncl,
      },
      eigenGebruik: { aantal: eigenAantal, incl: r2(eigenIncl) },
      facturen: [] as { ref: string; datum: string; klant: string; btwNummer: string | null; excl: number; btw: number; incl: number }[],
      facturenTotaal: { aantal: 0, excl: 0, btw: 0, incl: 0 },
      algemeenTotaalIncl: totaalIncl,
    };
  }

  // CSV-export van één afsluiting (manuele controle / handmatige invoer boekhouder).
  async csv(id: string): Promise<string> {
    const verkopen = (await this.prisma.verkoop.findMany({
      where: { dagafsluitingId: id },
      include: LIJN_INCLUDE,
      orderBy: { datum: 'asc' },
    })) as VerkoopVol[];
    const kop = ['Datum', 'Ticket/Factuur', 'Type', 'Klant', 'BTW-nr', 'Betaalwijze', 'Excl. BTW', 'BTW', 'Incl. BTW'];
    const rijen = verkopen.map((v) => {
      const { incl, btw } = this.lijnBedragen(v);
      const factuur = !!v.klant?.btwNummer;
      return [
        v.datum.toISOString(),
        v.scradaRef || v.id,
        factuur ? 'Factuur (B2B)' : 'Kasticket',
        v.klant?.naam ?? 'Particulier',
        v.klant?.btwNummer ?? '',
        v.betaalwijze ?? '',
        r2(incl - btw).toFixed(2),
        r2(btw).toFixed(2),
        r2(incl).toFixed(2),
      ];
    });
    return [kop, ...rijen].map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  }

  geschiedenis() {
    return this.prisma.dagafsluiting.findMany({
      orderBy: { tot: 'desc' },
      take: 60,
      select: { id: true, volgnummer: true, tot: true, totaal: true, aantalVerkopen: true },
    });
  }
}
