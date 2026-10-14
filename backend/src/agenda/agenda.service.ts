import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import { PrismaService } from '../prisma/prisma.service';

// Agenda van de zaak: iedereen kan er manueel bestellingen en agendapunten in
// zetten; webshopbestellingen komen er automatisch in. Export naar Excel.
export const SOORTEN = ['BESTELLING', 'AFSPRAAK', 'NOTITIE', 'LEVERING'] as const;
export const STATUSSEN = ['OPEN', 'KLAAR', 'GEANNULEERD'] as const;
export const LOCATIES = ['WINKEL', 'RESTAURANT', 'CATERING'] as const;
export const CATEGORIEEN = ['BROOD', 'CATERING', 'BOODSCHAPPEN'] as const;
const CATEGORIE_NAAM: Record<string, string> = { BROOD: 'Brood', CATERING: 'Catering', BOODSCHAPPEN: 'Boodschappen' };

export type AgendaInput = {
  dag: string; tijd?: string | null; soort?: string; titel: string; omschrijving?: string | null;
  klantNaam?: string | null; klantTelefoon?: string | null; klantEmail?: string | null;
  bedrag?: number | null; locatie?: string | null; categorie?: string | null; status?: string;
};

const DAG = /^\d{4}-\d{2}-\d{2}$/;
const TIJD = /^([01]\d|2[0-3]):[0-5]\d$/;
const r2 = (n: number) => Math.round(n * 100) / 100;

@Injectable()
export class AgendaService implements OnModuleInit {
  private readonly log = new Logger(AgendaService.name);
  constructor(private prisma: PrismaService) {}

  // Bestaande webshopbestellingen (bv. van vóór de agenda) alsnog in de agenda zetten.
  async onModuleInit() {
    try {
      const open = await this.prisma.verkoop.findMany({ where: { kanaal: 'WEBSHOP', geannuleerd: false }, select: { id: true }, orderBy: { datum: 'desc' }, take: 500 });
      let n = 0;
      for (const { id } of open) { if (await this.vanWebshop(id)) n++; }
      if (n) this.log.log(`Agenda: ${n} webshopbestelling(en) toegevoegd.`);
    } catch (e) { this.log.warn(`Agenda-backfill: ${e instanceof Error ? e.message : e}`); }
  }

  private naarBuiten(a: { id: string; dag: string; tijd: string | null; soort: string; bron: string; titel: string; omschrijving: string | null; klantNaam: string | null; klantTelefoon: string | null; klantEmail: string | null; bedrag: Prisma.Decimal | null; locatie: string | null; categorie: string | null; status: string; verkoopId: string | null; gelezen: boolean; afhaalDag: string | null; afhaalTijd: string | null; aangemaaktDoor: string | null; createdAt: Date; updatedAt: Date }) {
    return { ...a, bedrag: a.bedrag != null ? Number(a.bedrag) : null };
  }

  private valideer(input: Partial<AgendaInput>, volledig: boolean) {
    const data: Prisma.AgendaItemUncheckedUpdateInput = {};
    if (volledig || input.dag !== undefined) {
      if (!input.dag || !DAG.test(input.dag)) throw new BadRequestException('Geef een geldige datum.');
      data.dag = input.dag;
    }
    if (input.tijd !== undefined) {
      const t = (input.tijd ?? '').trim();
      if (t && !TIJD.test(t)) throw new BadRequestException('Geef een geldig uur (bv. 14:30).');
      data.tijd = t || null;
    }
    if (volledig || input.titel !== undefined) {
      const titel = String(input.titel ?? '').trim();
      if (!titel) throw new BadRequestException('Geef een titel.');
      data.titel = titel;
    }
    if (input.soort !== undefined) {
      if (!(SOORTEN as readonly string[]).includes(String(input.soort))) throw new BadRequestException('Onbekende soort.');
      data.soort = input.soort;
    }
    if (input.status !== undefined) {
      if (!(STATUSSEN as readonly string[]).includes(String(input.status))) throw new BadRequestException('Onbekende status.');
      data.status = input.status;
    }
    if (input.locatie !== undefined) {
      const l = (input.locatie ?? '').trim();
      if (l && !(LOCATIES as readonly string[]).includes(l)) throw new BadRequestException('Onbekende locatie.');
      data.locatie = l || null;
    }
    if (input.categorie !== undefined) {
      const c = (input.categorie ?? '').trim();
      if (c && !(CATEGORIEEN as readonly string[]).includes(c)) throw new BadRequestException('Onbekende categorie.');
      data.categorie = c || null;
    }
    if (input.omschrijving !== undefined) data.omschrijving = input.omschrijving?.trim() || null;
    if (input.klantNaam !== undefined) data.klantNaam = input.klantNaam?.trim() || null;
    if (input.klantTelefoon !== undefined) data.klantTelefoon = input.klantTelefoon?.trim() || null;
    if (input.klantEmail !== undefined) data.klantEmail = input.klantEmail?.trim() || null;
    if (input.bedrag !== undefined) {
      if (input.bedrag === null || input.bedrag === ('' as unknown)) data.bedrag = null;
      else {
        const b = Number(input.bedrag);
        if (Number.isNaN(b)) throw new BadRequestException('Geef een geldig bedrag.');
        data.bedrag = new Prisma.Decimal(r2(b));
      }
    }
    return data;
  }

  // --- lezen ------------------------------------------------------------------
  async lijst(van: string, tot: string) {
    if (!DAG.test(van) || !DAG.test(tot)) throw new BadRequestException('Geef een geldige periode.');
    const rows = await this.prisma.agendaItem.findMany({ where: { dag: { gte: van, lte: tot } }, orderBy: [{ dag: 'asc' }, { tijd: 'asc' }, { createdAt: 'asc' }] });
    return rows.map((a) => this.naarBuiten(a));
  }

  // --- schrijven ------------------------------------------------------------------
  async maak(input: AgendaInput, door?: string | null) {
    const data = this.valideer(input, true) as Prisma.AgendaItemUncheckedCreateInput;
    const a = await this.prisma.agendaItem.create({ data: { ...data, dag: String(data.dag), titel: String(data.titel), bron: 'MANUEEL', gelezen: true, aangemaaktDoor: door ?? null } });
    return this.naarBuiten(a);
  }
  // "Gelezen": de webshopbestelling is gezien; ze verhuist van de besteldag naar de afhaal-/leverdag.
  async gelezen(id: string) {
    const a = await this.prisma.agendaItem.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('Agendapunt niet gevonden.');
    const bij = await this.prisma.agendaItem.update({
      where: { id },
      data: { gelezen: true, ...(a.afhaalDag ? { dag: a.afhaalDag, tijd: a.afhaalTijd ?? a.tijd } : {}) },
    });
    return this.naarBuiten(bij);
  }
  async wijzig(id: string, input: Partial<AgendaInput>) {
    const bestaand = await this.prisma.agendaItem.findUnique({ where: { id } });
    if (!bestaand) throw new NotFoundException('Agendapunt niet gevonden.');
    const data = this.valideer(input, false);
    const a = await this.prisma.agendaItem.update({ where: { id }, data });
    // Status van een webshopbestelling mee bijwerken (KLAAR -> KLAAR, GEANNULEERD -> GEANNULEERD).
    if (bestaand.verkoopId && input.status && input.status !== bestaand.status) {
      const vs = input.status === 'KLAAR' ? 'KLAAR' : input.status === 'GEANNULEERD' ? 'GEANNULEERD' : 'NIEUW';
      await this.prisma.verkoop.update({ where: { id: bestaand.verkoopId }, data: { status: vs } }).catch(() => undefined);
    }
    return this.naarBuiten(a);
  }
  async verwijder(id: string) {
    const bestaand = await this.prisma.agendaItem.findUnique({ where: { id } });
    if (!bestaand) throw new NotFoundException('Agendapunt niet gevonden.');
    if (bestaand.bron === 'WEBSHOP') throw new BadRequestException('Een webshopbestelling kan je niet uit de agenda verwijderen; zet ze op "geannuleerd" of "klaar".');
    await this.prisma.agendaItem.delete({ where: { id } });
    return { ok: true };
  }

  // --- webshop ----------------------------------------------------------------------
  // Maakt (één keer) het agenda-item voor een webshopbestelling; geeft true als nieuw.
  async vanWebshop(verkoopId: string): Promise<boolean> {
    const bestaat = await this.prisma.agendaItem.findUnique({ where: { verkoopId } });
    if (bestaat) return false;
    const v = await this.prisma.verkoop.findUnique({ where: { id: verkoopId }, include: { klant: true, lijnen: { include: { product: true } } } });
    if (!v || v.kanaal !== 'WEBSHOP') return false;
    const dag = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(v.datum); // YYYY-MM-DD
    const lever = v.leverwijze === 'LEVEREN' ? 'leveren' : 'afhalen';
    const artikels = v.lijnen.map((l) => `${Number(l.aantal)}× ${l.product.naam}`).join(', ');
    const status = v.geannuleerd || v.status === 'GEANNULEERD' ? 'GEANNULEERD' : ['KLAAR', 'AFGEHAALD', 'GELEVERD'].includes(v.status ?? '') ? 'KLAAR' : 'OPEN';
    const afhaalDag = v.gewensteDag ?? null;
    const afhaalNl = afhaalDag ? `${afhaalDag.slice(8, 10)}/${afhaalDag.slice(5, 7)}${v.gewensteTijd ? ' ' + v.gewensteTijd : ''}` : null;
    // Bestelling staat eerst op de besteldag (ongelezen); na "Gelezen" verhuist ze naar de afhaal-/leverdag.
    await this.prisma.agendaItem.create({
      data: {
        dag, soort: v.leverwijze === 'LEVEREN' ? 'LEVERING' : 'BESTELLING', bron: 'WEBSHOP', gelezen: false,
        afhaalDag, afhaalTijd: v.gewensteTijd ?? null,
        titel: `Webshop: ${v.klant?.naam ?? 'klant'} · ${lever}${afhaalNl ? ' op ' + afhaalNl : ''}`,
        omschrijving: `${artikels}${v.klant?.adres && v.leverwijze === 'LEVEREN' ? ` · ${v.klant.adres}` : ''}${v.betaald ? ' · online betaald' : ' · betalen bij ' + lever}`,
        klantNaam: v.klant?.naam ?? null, klantEmail: v.klant?.email ?? null, klantTelefoon: v.klant?.telefoon ?? null,
        bedrag: v.totaal, locatie: 'WINKEL', categorie: 'BOODSCHAPPEN', status, verkoopId: v.id, aangemaaktDoor: 'webshop',
      },
    });
    return true;
  }
  // Status vanuit het Bestellingen-scherm doorzetten naar de agenda.
  async syncWebshopStatus(verkoopId: string, status: string) {
    const s = status === 'GEANNULEERD' ? 'GEANNULEERD' : ['KLAAR', 'AFGEHAALD', 'GELEVERD'].includes(status) ? 'KLAAR' : 'OPEN';
    await this.prisma.agendaItem.updateMany({ where: { verkoopId }, data: { status: s } });
  }

  // --- Excel ------------------------------------------------------------------------
  // Excel: één tabblad per categorie (Brood, Catering, Boodschappen, Zonder categorie) + "Alles";
  // met `categorie` enkel dat ene tabblad.
  async excel(van: string, tot: string, categorie?: string): Promise<Buffer> {
    const alle = await this.lijst(van, tot);
    if (categorie && !(CATEGORIEEN as readonly string[]).includes(categorie)) throw new BadRequestException('Onbekende categorie.');
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Marché kassa';
    const naamNl: Record<string, string> = { ...CATEGORIE_NAAM, BESTELLING: 'Bestelling', AFSPRAAK: 'Afspraak', NOTITIE: 'Notitie', LEVERING: 'Levering', OPEN: 'Open', KLAAR: 'Klaar', GEANNULEERD: 'Geannuleerd', MANUEEL: 'Manueel', WEBSHOP: 'Webshop', WINKEL: 'Winkel', RESTAURANT: 'Restaurant' };
    const blad = (naam: string, items: typeof alle) => {
      const ws = wb.addWorksheet(naam, { views: [{ state: 'frozen', ySplit: 1 }] });
      ws.columns = [
        { header: 'Datum', key: 'dag', width: 12 },
        { header: 'Uur', key: 'tijd', width: 7 },
        { header: 'Categorie', key: 'categorie', width: 14 },
        { header: 'Soort', key: 'soort', width: 12 },
        { header: 'Afhaal/levering', key: 'afhaal', width: 16 },
        { header: 'Titel', key: 'titel', width: 36 },
        { header: 'Klant', key: 'klantNaam', width: 22 },
        { header: 'Telefoon', key: 'klantTelefoon', width: 14 },
        { header: 'E-mail', key: 'klantEmail', width: 24 },
        { header: 'Bedrag', key: 'bedrag', width: 10 },
        { header: 'Locatie', key: 'locatie', width: 12 },
        { header: 'Status', key: 'status', width: 12 },
        { header: 'Bron', key: 'bron', width: 10 },
        { header: 'Omschrijving', key: 'omschrijving', width: 60 },
        { header: 'Ingezet door', key: 'aangemaaktDoor', width: 16 },
      ];
      ws.getRow(1).font = { bold: true };
      for (const a of items) {
        const [j, m, d] = a.dag.split('-');
        ws.addRow({
          dag: new Date(Number(j), Number(m) - 1, Number(d)), tijd: a.tijd ?? '', categorie: a.categorie ? naamNl[a.categorie] ?? a.categorie : '', soort: naamNl[a.soort] ?? a.soort,
          afhaal: a.afhaalDag ? `${a.afhaalDag.slice(8, 10)}/${a.afhaalDag.slice(5, 7)}/${a.afhaalDag.slice(0, 4)}${a.afhaalTijd ? ' ' + a.afhaalTijd : ''}` : '', titel: a.titel,
          klantNaam: a.klantNaam ?? '', klantTelefoon: a.klantTelefoon ?? '', klantEmail: a.klantEmail ?? '',
          bedrag: a.bedrag ?? null, locatie: a.locatie ? naamNl[a.locatie] ?? a.locatie : '', status: naamNl[a.status] ?? a.status,
          bron: naamNl[a.bron] ?? a.bron, omschrijving: a.omschrijving ?? '', aangemaaktDoor: a.aangemaaktDoor ?? '',
        });
      }
      if (items.length) {
        const tot = ws.addRow({ titel: `Totaal (${items.length})`, bedrag: items.reduce((s, a) => s + (a.bedrag ?? 0), 0) });
        tot.font = { bold: true };
      }
      ws.getColumn('dag').numFmt = 'dd/mm/yyyy';
      ws.getColumn('bedrag').numFmt = '€ #,##0.00';
      ws.autoFilter = { from: 'A1', to: 'O1' };
    };
    if (categorie) {
      blad(CATEGORIE_NAAM[categorie], alle.filter((a) => a.categorie === categorie));
    } else {
      blad('Alles', alle);
      for (const c of CATEGORIEEN) blad(CATEGORIE_NAAM[c], alle.filter((a) => a.categorie === c));
      const zonder = alle.filter((a) => !a.categorie);
      if (zonder.length) blad('Zonder categorie', zonder);
    }
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
}
