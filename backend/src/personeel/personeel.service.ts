import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { versleutel, ontsleutel } from '../common/geheim';
import { effectieveRechten } from '../common/rechten';

// Personeelsdossier per medewerker (voorlopig enkel voor de beheerder).
export const STATUTEN = ['VAST', 'FLEXI', 'STUDENT', 'ZELFSTANDIG'] as const;
export const AFDELINGEN = ['WINKEL', 'RESTAURANT', 'CATERING'] as const;

export type ProfielInput = {
  voornaam?: string | null; achternaam?: string | null; telefoon?: string | null; privEmail?: string | null; adres?: string | null;
  geboortedatum?: string | null; rijksregister?: string | null; iban?: string | null;
  noodcontactNaam?: string | null; noodcontactTelefoon?: string | null;
  statuut?: string | null; ondernemingId?: string | null; functie?: string | null; afdelingen?: string[]; verantwoordelijkVoor?: string[];
  inDienst?: string | null; uitDienst?: string | null;
  urenPerWeek?: number | null; urenPerDag?: number | null; maxUrenDag?: number | null; maxUrenWeek?: number | null; maxUrenMaand?: number | null; jaarContingent?: number | null;
  verlofdagenJaar?: number | null; verlofdagenSaldo?: number | null; recupUrenSaldo?: number | null;
  notities?: string | null;
};

const DAG = /^\d{4}-\d{2}-\d{2}$/;
const tekst = (v: string | null | undefined) => (v ?? '').trim() || null;
const masker = (s: string) => (s.length <= 4 ? '••••' : '•••• ' + s.slice(-4));

// Belgisch rijksregisternummer: 11 cijfers, controlegetal 97 - (eerste 9 mod 97); wie
// geboren is vanaf 2000 rekent met een "2" vooraan.
function geldigRijksregister(nr: string) {
  if (!/^\d{11}$/.test(nr)) return false;
  const basis = Number(nr.slice(0, 9)); const ctl = Number(nr.slice(9));
  return 97 - (basis % 97) === ctl || 97 - (Number('2' + nr.slice(0, 9)) % 97) === ctl;
}
// IBAN: mod-97-controle (ISO 13616).
function geldigIban(iban: string) {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  const herschikt = iban.slice(4) + iban.slice(0, 4);
  const cijfers = herschikt.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rest = 0;
  for (const ch of cijfers) rest = (rest * 10 + Number(ch)) % 97;
  return rest === 1;
}

@Injectable()
export class PersoneelService {
  constructor(private prisma: PrismaService) {}

  private n(v: Prisma.Decimal | null | undefined) { return v != null ? Number(v) : null; }

  async profiel(id: string) {
    const u = await this.prisma.gebruiker.findUnique({ where: { id }, include: { profiel: true } });
    if (!u) throw new NotFoundException('Medewerker niet gevonden.');
    const p = u.profiel;
    let rr: string | null = null, iban: string | null = null;
    try { rr = p?.rijksregisterGeheim ? ontsleutel(p.rijksregisterGeheim) : null; } catch { rr = null; }
    try { iban = p?.ibanGeheim ? ontsleutel(p.ibanGeheim) : null; } catch { iban = null; }

    // Omzet van deze medewerker (enkel zichtbaar voor de eigenaars = beheerders).
    const nu = new Date();
    const maandStart = new Date(nu.getFullYear(), nu.getMonth(), 1);
    const jaarStart = new Date(nu.getFullYear(), 0, 1);
    const [maand, jaar, laatste] = await Promise.all([
      this.prisma.verkoop.aggregate({ _sum: { totaal: true }, _count: true, where: { gebruikerId: id, geannuleerd: false, datum: { gte: maandStart } } }),
      this.prisma.verkoop.aggregate({ _sum: { totaal: true }, _count: true, where: { gebruikerId: id, geannuleerd: false, datum: { gte: jaarStart } } }),
      this.prisma.verkoop.findFirst({ where: { gebruikerId: id, geannuleerd: false }, orderBy: { datum: 'desc' }, select: { datum: true } }),
    ]);

    return {
      account: { id: u.id, naam: u.naam, email: u.email, rol: u.rol, actief: u.actief, rechten: effectieveRechten(u.rol, u.rechten), createdAt: u.createdAt, tankkaart: u.tankkaart, tankkaartNummer: u.tankkaartNummer, tankkaartHeeftCode: !!u.tankkaartCodeGeheim },
      profiel: {
        voornaam: p?.voornaam ?? null, achternaam: p?.achternaam ?? null, telefoon: p?.telefoon ?? null, privEmail: p?.privEmail ?? null, adres: p?.adres ?? null,
        geboortedatum: p?.geboortedatum ?? null, noodcontactNaam: p?.noodcontactNaam ?? null, noodcontactTelefoon: p?.noodcontactTelefoon ?? null,
        // Gevoelig: enkel gemaskeerd; volledig via /gevoelig.
        rijksregisterMasker: rr ? masker(rr) : null, ibanMasker: iban ? masker(iban) : null,
        statuut: p?.statuut ?? null, ondernemingId: p?.ondernemingId ?? null, functie: p?.functie ?? null,
        afdelingen: p?.afdelingen ?? [], verantwoordelijkVoor: p?.verantwoordelijkVoor ?? [],
        inDienst: p?.inDienst ?? null, uitDienst: p?.uitDienst ?? null,
        urenPerWeek: this.n(p?.urenPerWeek), urenPerDag: this.n(p?.urenPerDag),
        maxUrenDag: this.n(p?.maxUrenDag), maxUrenWeek: this.n(p?.maxUrenWeek), maxUrenMaand: this.n(p?.maxUrenMaand), jaarContingent: this.n(p?.jaarContingent),
        verlofdagenJaar: this.n(p?.verlofdagenJaar), verlofdagenSaldo: this.n(p?.verlofdagenSaldo), recupUrenSaldo: this.n(p?.recupUrenSaldo),
        notities: p?.notities ?? null, updatedAt: p?.updatedAt ?? null,
      },
      omzet: {
        maand: { totaal: Number(maand._sum.totaal ?? 0), tickets: maand._count },
        jaar: { totaal: Number(jaar._sum.totaal ?? 0), tickets: jaar._count },
        laatsteVerkoop: laatste?.datum ?? null,
      },
    };
  }

  // Rijksregisternummer en IBAN volledig tonen (enkel beheerder, op een klik).
  async gevoelig(id: string) {
    const p = await this.prisma.personeelsProfiel.findUnique({ where: { gebruikerId: id }, select: { rijksregisterGeheim: true, ibanGeheim: true } });
    const lees = (v: string | null | undefined) => { if (!v) return null; try { return ontsleutel(v); } catch { return null; } };
    const rr = lees(p?.rijksregisterGeheim);
    const iban = lees(p?.ibanGeheim);
    return {
      rijksregister: rr ? `${rr.slice(0, 2)}.${rr.slice(2, 4)}.${rr.slice(4, 6)}-${rr.slice(6, 9)}.${rr.slice(9)}` : null,
      iban: iban ? iban.replace(/(.{4})/g, '$1 ').trim() : null,
    };
  }

  async zetProfiel(id: string, input: ProfielInput) {
    const u = await this.prisma.gebruiker.findUnique({ where: { id } });
    if (!u) throw new NotFoundException('Medewerker niet gevonden.');
    const d: Prisma.PersoneelsProfielUncheckedCreateInput = { gebruikerId: id };
    const zet = <K extends keyof ProfielInput>(k: K, f: (v: NonNullable<ProfielInput[K]> | null) => unknown) => {
      if (input[k] !== undefined) (d as Record<string, unknown>)[k as string] = f((input[k] ?? null) as NonNullable<ProfielInput[K]> | null);
    };
    for (const k of ['voornaam', 'achternaam', 'telefoon', 'adres', 'functie', 'noodcontactNaam', 'noodcontactTelefoon', 'notities'] as const) zet(k, (v) => tekst(v as string | null));
    zet('privEmail', (v) => {
      const e = tekst(v as string | null);
      if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw new BadRequestException('Geen geldig e-mailadres.');
      return e;
    });
    for (const k of ['geboortedatum', 'inDienst', 'uitDienst'] as const) zet(k, (v) => {
      const s = tekst(v as string | null);
      if (s && !DAG.test(s)) throw new BadRequestException('Geef een geldige datum.');
      return s;
    });
    zet('statuut', (v) => {
      const s = tekst(v as string | null);
      if (s && !(STATUTEN as readonly string[]).includes(s)) throw new BadRequestException('Onbekend statuut.');
      return s;
    });
    zet('ondernemingId', (v) => tekst(v as string | null));
    for (const k of ['afdelingen', 'verantwoordelijkVoor'] as const) zet(k, (v) => [...new Set(((v as string[] | null) ?? []).map(String))].filter((a) => (AFDELINGEN as readonly string[]).includes(a)));
    for (const k of ['urenPerWeek', 'urenPerDag', 'maxUrenDag', 'maxUrenWeek', 'maxUrenMaand', 'jaarContingent', 'verlofdagenJaar', 'verlofdagenSaldo', 'recupUrenSaldo'] as const) zet(k, (v) => {
      if (v === null || (v as unknown) === '') return null;
      const n = Number(String(v).replace(',', '.'));
      if (Number.isNaN(n) || n < -1000 || n > 10000) throw new BadRequestException('Geef een geldig getal.');
      return new Prisma.Decimal(Math.round(n * 100) / 100);
    });
    // Gevoelige gegevens: gecontroleerd en versleuteld; null/leeg = wissen.
    if (input.rijksregister !== undefined) {
      const nr = (input.rijksregister ?? '').replace(/\D/g, '');
      if (nr && !geldigRijksregister(nr)) throw new BadRequestException('Dit rijksregisternummer klopt niet (controlegetal).');
      (d as Record<string, unknown>).rijksregisterGeheim = nr ? versleutel(nr) : null;
    }
    if (input.iban !== undefined) {
      const ib = (input.iban ?? '').replace(/\s/g, '').toUpperCase();
      if (ib && !geldigIban(ib)) throw new BadRequestException('Dit IBAN-nummer klopt niet.');
      (d as Record<string, unknown>).ibanGeheim = ib ? versleutel(ib) : null;
    }
    // Sanity: de beheerder bevestigt zijn eigen grenzen, maar een dagplafond boven 24 u kan niet.
    const maxDag = (d as Record<string, unknown>).maxUrenDag as Prisma.Decimal | null | undefined;
    if (maxDag && Number(maxDag) > 24) throw new BadRequestException('Een dagplafond kan niet hoger zijn dan 24 uur.');
    const { gebruikerId: _g, ...update } = d;
    await this.prisma.personeelsProfiel.upsert({ where: { gebruikerId: id }, create: d, update });
    return this.profiel(id);
  }
}
