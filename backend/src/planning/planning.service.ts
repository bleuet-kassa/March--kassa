import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Uurroosters: geplande diensten. Het Planning-scherm (toegang "planning") maakt ze;
// elke medewerker ziet zijn eigen diensten bij "Mijn rooster".
export const LOCATIES = ['WINKEL', 'RESTAURANT', 'CATERING'] as const;
export type DienstInput = { gebruikerId: string; dag: string; start: string; eind: string; pauzeMin?: number; locatie?: string | null; opmerking?: string | null };

const DAG = /^\d{4}-\d{2}-\d{2}$/;
const TIJD = /^([01]\d|2[0-3]):[0-5]\d$/;
const min = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
// Duur in uren (pauze eraf); een eind vóór de start loopt door na middernacht.
export function dienstUren(d: { start: string; eind: string; pauzeMin: number }) {
  let m = min(d.eind) - min(d.start);
  if (m <= 0) m += 24 * 60;
  return Math.max(0, Math.round(((m - (d.pauzeMin || 0)) / 60) * 100) / 100);
}
const plusDagen = (s: string, n: number) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const maandag = (s: string) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
const vandaagBrussel = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Brussels' }).format(new Date());

@Injectable()
export class PlanningService {
  constructor(private prisma: PrismaService) {}

  private naarBuiten(d: { id: string; gebruikerId: string; dag: string; start: string; eind: string; pauzeMin: number; locatie: string | null; opmerking: string | null }) {
    return { id: d.id, gebruikerId: d.gebruikerId, dag: d.dag, start: d.start, eind: d.eind, pauzeMin: d.pauzeMin, locatie: d.locatie, opmerking: d.opmerking, uren: dienstUren(d) };
  }

  // Planning-scherm: alle diensten in de periode + de actieve medewerkers met hun regime.
  async week(van: string, tot: string) {
    if (!DAG.test(van) || !DAG.test(tot)) throw new BadRequestException('Geef een geldige periode.');
    const [diensten, mensen] = await Promise.all([
      this.prisma.dienst.findMany({ where: { dag: { gte: van, lte: tot } }, orderBy: [{ dag: 'asc' }, { start: 'asc' }] }),
      this.prisma.gebruiker.findMany({ where: { actief: true }, include: { profiel: true }, orderBy: { naam: 'asc' } }),
    ]);
    return {
      diensten: diensten.map((d) => this.naarBuiten(d)),
      medewerkers: mensen.map((u) => ({
        id: u.id, naam: [u.profiel?.voornaam, u.profiel?.achternaam].filter(Boolean).join(' ') || u.naam,
        afdelingen: u.profiel?.afdelingen ?? [], statuut: u.profiel?.statuut ?? null,
        urenPerWeek: u.profiel?.urenPerWeek != null ? Number(u.profiel.urenPerWeek) : null,
        maxUrenDag: u.profiel?.maxUrenDag != null ? Number(u.profiel.maxUrenDag) : 11,
        maxUrenWeek: u.profiel?.maxUrenWeek != null ? Number(u.profiel.maxUrenWeek) : 50,
      })),
    };
  }

  private valideer(input: Partial<DienstInput>, volledig: boolean) {
    const data: Record<string, unknown> = {};
    if (volledig || input.gebruikerId !== undefined) { if (!input.gebruikerId) throw new BadRequestException('Kies een medewerker.'); data.gebruikerId = input.gebruikerId; }
    if (volledig || input.dag !== undefined) { if (!input.dag || !DAG.test(input.dag)) throw new BadRequestException('Geef een geldige datum.'); data.dag = input.dag; }
    if (volledig || input.start !== undefined) { if (!input.start || !TIJD.test(input.start)) throw new BadRequestException('Geef een geldig beginuur (bv. 08:30).'); data.start = input.start; }
    if (volledig || input.eind !== undefined) { if (!input.eind || !TIJD.test(input.eind)) throw new BadRequestException('Geef een geldig einduur (bv. 17:00).'); data.eind = input.eind; }
    if (input.pauzeMin !== undefined) { const p = Math.round(Number(input.pauzeMin) || 0); if (p < 0 || p > 240) throw new BadRequestException('Pauze tussen 0 en 240 minuten.'); data.pauzeMin = p; }
    if (input.locatie !== undefined) { const l = (input.locatie ?? '').trim(); if (l && !(LOCATIES as readonly string[]).includes(l)) throw new BadRequestException('Onbekende locatie.'); data.locatie = l || null; }
    if (input.opmerking !== undefined) data.opmerking = input.opmerking?.trim() || null;
    return data;
  }
  // Harde grens: een dienst mag het dagplafond van de medewerker (standaard 11 u) niet overschrijden.
  private async controleerPlafond(gebruikerId: string, dag: string, start: string, eind: string, pauzeMin: number, zonderId?: string) {
    const prof = await this.prisma.personeelsProfiel.findUnique({ where: { gebruikerId }, select: { maxUrenDag: true } });
    const max = prof?.maxUrenDag != null ? Number(prof.maxUrenDag) : 11;
    const anderen = await this.prisma.dienst.findMany({ where: { gebruikerId, dag, ...(zonderId ? { id: { not: zonderId } } : {}) } });
    const totaal = anderen.reduce((s, d) => s + dienstUren(d), 0) + dienstUren({ start, eind, pauzeMin });
    if (totaal > max + 0.001) throw new BadRequestException(`Dat wordt ${totaal.toFixed(2).replace('.', ',')} u op ${dag.split('-').reverse().join('/')}: meer dan het dagplafond van ${max} u voor deze medewerker.`);
  }

  async maak(input: DienstInput) {
    const data = this.valideer(input, true) as unknown as DienstInput & { pauzeMin?: number };
    const u = await this.prisma.gebruiker.findUnique({ where: { id: data.gebruikerId } });
    if (!u) throw new NotFoundException('Medewerker niet gevonden.');
    await this.controleerPlafond(data.gebruikerId, data.dag, data.start, data.eind, data.pauzeMin ?? 0);
    return this.naarBuiten(await this.prisma.dienst.create({ data: { gebruikerId: data.gebruikerId, dag: data.dag, start: data.start, eind: data.eind, pauzeMin: data.pauzeMin ?? 0, locatie: (data.locatie as string | null) ?? null, opmerking: (data.opmerking as string | null) ?? null } }));
  }
  async wijzig(id: string, input: Partial<DienstInput>) {
    const b = await this.prisma.dienst.findUnique({ where: { id } });
    if (!b) throw new NotFoundException('Dienst niet gevonden.');
    const data = this.valideer(input, false);
    const n = { ...b, ...data } as typeof b;
    await this.controleerPlafond(n.gebruikerId, n.dag, n.start, n.eind, n.pauzeMin, id);
    return this.naarBuiten(await this.prisma.dienst.update({ where: { id }, data }));
  }
  async verwijder(id: string) {
    const b = await this.prisma.dienst.findUnique({ where: { id } });
    if (!b) throw new NotFoundException('Dienst niet gevonden.');
    await this.prisma.dienst.delete({ where: { id } });
    return { ok: true };
  }
  // Een hele week kopiëren naar een andere week (bestaande, identieke diensten worden overgeslagen).
  async kopieerWeek(bron: string, doel: string) {
    if (!DAG.test(bron) || !DAG.test(doel)) throw new BadRequestException('Geef geldige weken.');
    const b = maandag(bron), d = maandag(doel);
    if (b === d) throw new BadRequestException('Kies een andere week om naartoe te kopiëren.');
    const verschil = Math.round((new Date(d + 'T12:00:00Z').getTime() - new Date(b + 'T12:00:00Z').getTime()) / 86_400_000);
    const bronDiensten = await this.prisma.dienst.findMany({ where: { dag: { gte: b, lte: plusDagen(b, 6) } } });
    const bestaand = await this.prisma.dienst.findMany({ where: { dag: { gte: d, lte: plusDagen(d, 6) } }, select: { gebruikerId: true, dag: true, start: true } });
    const sleutel = (x: { gebruikerId: string; dag: string; start: string }) => `${x.gebruikerId}|${x.dag}|${x.start}`;
    const al = new Set(bestaand.map(sleutel));
    const nieuw = bronDiensten
      .map((x) => ({ gebruikerId: x.gebruikerId, dag: plusDagen(x.dag, verschil), start: x.start, eind: x.eind, pauzeMin: x.pauzeMin, locatie: x.locatie, opmerking: x.opmerking }))
      .filter((x) => !al.has(sleutel(x)));
    if (nieuw.length) await this.prisma.dienst.createMany({ data: nieuw });
    return { gekopieerd: nieuw.length, overgeslagen: bronDiensten.length - nieuw.length };
  }

  // Mijn rooster: de eigen diensten vanaf de maandag van deze week, voor N weken.
  async mijn(gebruikerId: string, weken = 4) {
    const n = Math.min(Math.max(Math.round(weken) || 4, 1), 12);
    const van = maandag(vandaagBrussel());
    const tot = plusDagen(van, n * 7 - 1);
    const [u, diensten] = await Promise.all([
      this.prisma.gebruiker.findUnique({ where: { id: gebruikerId }, include: { profiel: true } }),
      this.prisma.dienst.findMany({ where: { gebruikerId, dag: { gte: van, lte: tot } }, orderBy: [{ dag: 'asc' }, { start: 'asc' }] }),
    ]);
    if (!u) throw new NotFoundException('Account niet gevonden.');
    return {
      naam: [u.profiel?.voornaam, u.profiel?.achternaam].filter(Boolean).join(' ') || u.naam,
      van, tot, vandaag: vandaagBrussel(),
      urenPerWeek: u.profiel?.urenPerWeek != null ? Number(u.profiel.urenPerWeek) : null,
      diensten: diensten.map((d) => this.naarBuiten(d)),
    };
  }
}
