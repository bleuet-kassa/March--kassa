import { Injectable, UnauthorizedException, BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { GebruikerRol, Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { authSecret, signToken } from '../common/token';
import { effectieveRechten, isAdminRol, normaliseerRechten } from '../common/rechten';

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService) {}

  // Login: e-mail + wachtwoord -> verkoper-gegevens (met toegangen) + ondertekend token (JWT).
  async login(email: string, wachtwoord: string) {
    const u = await this.prisma.gebruiker.findUnique({ where: { email } });
    if (!u || !u.actief) throw new UnauthorizedException('Onbekende gebruiker.');
    const ok = await bcrypt.compare(wachtwoord ?? '', u.wachtwoordHash);
    if (!ok) throw new UnauthorizedException('Verkeerd wachtwoord.');
    const token = signToken({ sub: u.id, naam: u.naam, rol: u.rol }, authSecret());
    return { id: u.id, naam: u.naam, rol: u.rol, rechten: effectieveRechten(u.rol, u.rechten), token };
  }

  // Eigen gegevens + actuele toegangen (zodat een wijziging zonder herlogin doorkomt).
  async ik(id: string) {
    const u = await this.prisma.gebruiker.findUnique({ where: { id } });
    if (!u || !u.actief) throw new UnauthorizedException('Account niet (meer) actief.');
    return { id: u.id, naam: u.naam, rol: u.rol, rechten: effectieveRechten(u.rol, u.rechten) };
  }

  // Lijst van actieve verkopers (voor een keuzescherm aan de kassa).
  gebruikers() {
    return this.prisma.gebruiker.findMany({
      where: { actief: true },
      select: { id: true, naam: true, rol: true },
      orderBy: { naam: 'asc' },
    });
  }

  // --- Personeelsbeheer (accounts per gérante/medewerker) ---
  private naarPersoneelslid(u: { id: string; naam: string; email: string; rol: GebruikerRol; actief: boolean; rechten: unknown }) {
    return { id: u.id, naam: u.naam, email: u.email, rol: u.rol, actief: u.actief, rechten: effectieveRechten(u.rol, u.rechten), rechtenIngesteld: Array.isArray(u.rechten) };
  }
  async personeel() {
    const rows = await this.prisma.gebruiker.findMany({
      select: { id: true, naam: true, email: true, rol: true, actief: true, rechten: true },
      orderBy: [{ actief: 'desc' }, { naam: 'asc' }],
    });
    return rows.map((u) => this.naarPersoneelslid(u));
  }

  async nieuweGebruiker(input: { naam: string; email: string; wachtwoord: string; rol?: GebruikerRol; rechten?: string[] }, door?: { rol: string }) {
    if (!input.naam?.trim() || !input.email?.trim()) throw new BadRequestException('Naam en e-mail zijn vereist.');
    if (!input.wachtwoord || input.wachtwoord.length < 4) throw new BadRequestException('Kies een wachtwoord van minstens 4 tekens.');
    // Rol en toegangen kiezen mag enkel een beheerder; anderen maken enkel gewone kassa-accounts.
    const admin = isAdminRol(door?.rol);
    if (!admin && ((input.rol && input.rol !== GebruikerRol.KASSA) || input.rechten !== undefined)) {
      throw new ForbiddenException('Enkel een beheerder kan een rol of toegangen toekennen.');
    }
    const wachtwoordHash = await bcrypt.hash(input.wachtwoord, 10);
    try {
      const u = await this.prisma.gebruiker.create({
        data: {
          naam: input.naam.trim(), email: input.email.trim().toLowerCase(), wachtwoordHash, rol: input.rol ?? GebruikerRol.KASSA,
          rechten: input.rechten !== undefined ? (normaliseerRechten(input.rechten) as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
        },
      });
      return this.naarPersoneelslid(u);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new BadRequestException('Er bestaat al een account met dit e-mailadres.');
      throw e;
    }
  }

  async updateGebruiker(id: string, input: { naam?: string; rol?: GebruikerRol; actief?: boolean; wachtwoord?: string; rechten?: string[] | null }, door?: { sub?: string; rol: string }) {
    const bestaand = await this.prisma.gebruiker.findUnique({ where: { id } });
    if (!bestaand) throw new NotFoundException('Account niet gevonden.');
    const admin = isAdminRol(door?.rol);
    // Rol en toegangen wijzigen: enkel een beheerder (Yoran / Pieter-Jan).
    if (!admin && (input.rol !== undefined || input.rechten !== undefined)) {
      throw new ForbiddenException('Enkel een beheerder kan rollen en toegangen wijzigen.');
    }
    // Een niet-beheerder mag geen beheerdersaccount aanpassen (wachtwoord, deactiveren).
    if (!admin && isAdminRol(bestaand.rol)) throw new ForbiddenException('Dit account kan enkel door een beheerder aangepast worden.');
    // Jezelf niet buitensluiten.
    if (door?.sub === id && (input.actief === false || (input.rol !== undefined && !isAdminRol(input.rol) && isAdminRol(bestaand.rol)))) {
      throw new BadRequestException('Je kan je eigen account niet deactiveren of je eigen beheerdersrol afnemen.');
    }
    const data: Prisma.GebruikerUpdateInput = {};
    if (input.naam !== undefined) data.naam = input.naam.trim();
    if (input.rol !== undefined) data.rol = input.rol;
    if (input.actief !== undefined) data.actief = input.actief;
    if (input.rechten !== undefined) data.rechten = input.rechten === null ? Prisma.JsonNull : (normaliseerRechten(input.rechten) as unknown as Prisma.InputJsonValue);
    if (input.wachtwoord) {
      if (input.wachtwoord.length < 4) throw new BadRequestException('Kies een wachtwoord van minstens 4 tekens.');
      data.wachtwoordHash = await bcrypt.hash(input.wachtwoord, 10);
    }
    const u = await this.prisma.gebruiker.update({ where: { id }, data });
    return this.naarPersoneelslid(u);
  }
}
