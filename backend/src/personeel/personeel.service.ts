import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { versleutel, ontsleutel } from '../common/geheim';
import { effectieveRechten } from '../common/rechten';

// Personeelsdossier per medewerker (voorlopig enkel voor de beheerder).
export const STATUTEN = ['VAST', 'FLEXI', 'STUDENT', 'ZELFSTANDIG'] as const;
// Waar een ploeg werkt; de ploegen (categorieën) zelf beheert de zaak (Personeelscategorie).
export const LOCATIES = ['WINKEL', 'RESTAURANT', 'CATERING'] as const;
export type CategorieInput = { naam?: string; locatie?: string; volgorde?: number; actief?: boolean };

export type ProfielInput = {
  voornaam?: string | null; achternaam?: string | null; telefoon?: string | null; privEmail?: string | null; adres?: string | null;
  geboortedatum?: string | null; rijksregister?: string | null; iban?: string | null;
  noodcontactNaam?: string | null; noodcontactTelefoon?: string | null;
  statuut?: string | null; ondernemingId?: string | null; functie?: string | null; afdelingen?: string[]; verantwoordelijkVoor?: string[];
  inDienst?: string | null; uitDienst?: string | null;
  urenPerWeek?: number | null; urenPerDag?: number | null; maxUrenDag?: number | null; maxUrenWeek?: number | null; maxUrenMaand?: number | null; jaarContingent?: number | null;
  verlofdagenJaar?: number | null; verlofdagenSaldo?: number | null; recupUrenSaldo?: number | null;
  maatBovenstuk?: string | null; maatBroek?: string | null; maatJas?: string | null; maatSchort?: string | null; maatSchoenen?: string | null; kledijOpmerking?: string | null;
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

  // --- categorieën (ploegen): Winkel, Keuken restaurant, Zaal restaurant, Flexi restaurant... -----
  // Met het aantal medewerkers per categorie (om te zien wat nog gebruikt wordt).
  async categorieen() {
    const [lijst, profielen] = await Promise.all([
      this.prisma.personeelscategorie.findMany({ orderBy: [{ volgorde: 'asc' }, { naam: 'asc' }] }),
      this.prisma.personeelsProfiel.findMany({ select: { afdelingen: true, verantwoordelijkVoor: true } }),
    ]);
    return lijst.map((c) => ({
      ...c,
      medewerkers: profielen.filter((p) => p.afdelingen.includes(c.id)).length,
      verantwoordelijken: profielen.filter((p) => p.verantwoordelijkVoor.includes(c.id)).length,
    }));
  }

  private leesCategorie(input: CategorieInput, volledig: boolean) {
    const data: Prisma.PersoneelscategorieUncheckedUpdateInput = {};
    if (volledig || input.naam !== undefined) {
      const naam = String(input.naam ?? '').trim().replace(/\s+/g, ' ');
      if (!naam) throw new BadRequestException('Geef een naam (bv. Keuken restaurant).');
      if (naam.length > 60) throw new BadRequestException('De naam is te lang (hoogstens 60 tekens).');
      data.naam = naam;
    }
    if (volledig || input.locatie !== undefined) {
      const l = String(input.locatie ?? '').trim().toUpperCase();
      if (!(LOCATIES as readonly string[]).includes(l)) throw new BadRequestException('Kies waar deze ploeg werkt: winkel, restaurant of catering.');
      data.locatie = l;
    }
    if (input.volgorde !== undefined) {
      const v = Number(input.volgorde);
      if (!Number.isInteger(v) || v < 0 || v > 100000) throw new BadRequestException('Ongeldige volgorde.');
      data.volgorde = v;
    }
    if (input.actief !== undefined) {
      if (typeof input.actief !== 'boolean') throw new BadRequestException('Ongeldige waarde.');
      data.actief = input.actief;
    }
    return data;
  }

  // Zelfde naam (hoofdletters tellen niet)? De lijst is klein: vergelijken in code, zodat tekens
  // als _ % \ in een naam gewoon tekens blijven (een ILIKE zou ze als jokers lezen).
  private async naamVrij(naam: string | undefined, zonderId?: string) {
    if (!naam) return;
    const alle = await this.prisma.personeelscategorie.findMany({ select: { id: true, naam: true } });
    const zelfde = alle.find((c) => c.id !== zonderId && c.naam.toLocaleLowerCase('nl') === naam.toLocaleLowerCase('nl'));
    if (zelfde) throw new BadRequestException(`Er bestaat al een categorie "${zelfde.naam}".`);
  }

  async maakCategorie(input: CategorieInput) {
    const data = this.leesCategorie(input ?? {}, true) as { naam: string; locatie: string; volgorde?: number; actief?: boolean };
    await this.naamVrij(data.naam);
    const laatste = await this.prisma.personeelscategorie.aggregate({ _max: { volgorde: true } });
    try {
      await this.prisma.personeelscategorie.create({ data: { naam: data.naam, locatie: data.locatie, volgorde: data.volgorde ?? (laatste._max.volgorde ?? 0) + 10, actief: data.actief ?? true } });
    } catch (e) {
      this.dubbeleNaam(e, data.naam);
    }
    return this.categorieen();
  }

  async wijzigCategorie(id: string, input: CategorieInput) {
    const c = await this.prisma.personeelscategorie.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Categorie niet gevonden.');
    const data = this.leesCategorie(input ?? {}, false);
    await this.naamVrij(data.naam as string | undefined, id);
    try {
      await this.prisma.personeelscategorie.update({ where: { id }, data });
    } catch (e) {
      this.dubbeleNaam(e, String(data.naam ?? c.naam));
    }
    return this.categorieen();
  }

  // Twee keer tegelijk dezelfde naam (bv. dubbel geklikt): de database weigert de tweede.
  private dubbeleNaam(e: unknown, naam: string): never {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new BadRequestException(`Er bestaat al een categorie "${naam}".`);
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') throw new NotFoundException('Categorie niet gevonden.');
    throw e;
  }

  // Verwijderen kan enkel als niemand er nog in zit; anders: uitzetten (blijft in de dossiers staan).
  async verwijderCategorie(id: string) {
    const c = await this.prisma.personeelscategorie.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Categorie niet gevonden.');
    const inGebruik = await this.prisma.personeelsProfiel.count({ where: { OR: [{ afdelingen: { has: id } }, { verantwoordelijkVoor: { has: id } }] } });
    if (inGebruik) throw new BadRequestException(`"${c.naam}" staat nog bij ${inGebruik} medewerker${inGebruik === 1 ? '' : 's'}. Haal ze er eerst uit, of zet de categorie uit.`);
    await this.prisma.personeelscategorie.delete({ where: { id } });
    return this.categorieen();
  }

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
        maatBovenstuk: p?.maatBovenstuk ?? null, maatBroek: p?.maatBroek ?? null, maatJas: p?.maatJas ?? null, maatSchort: p?.maatSchort ?? null, maatSchoenen: p?.maatSchoenen ?? null, kledijOpmerking: p?.kledijOpmerking ?? null,
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
    for (const k of ['voornaam', 'achternaam', 'telefoon', 'adres', 'functie', 'noodcontactNaam', 'noodcontactTelefoon', 'notities',
      'maatBovenstuk', 'maatBroek', 'maatJas', 'maatSchort', 'maatSchoenen', 'kledijOpmerking'] as const) zet(k, (v) => tekst(v as string | null));
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
    // Categorieën: enkel bestaande (ook uitgezette, zodat een oude toewijzing blijft staan).
    const bestaande = new Set((await this.prisma.personeelscategorie.findMany({ select: { id: true } })).map((c) => c.id));
    for (const k of ['afdelingen', 'verantwoordelijkVoor'] as const) zet(k, (v) => [...new Set(((v as string[] | null) ?? []).map(String))].filter((a) => bestaande.has(a)));
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
