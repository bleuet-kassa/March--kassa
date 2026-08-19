import { Injectable, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { GebruikerRol, Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { authSecret, signToken } from '../common/token';

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService) {}

  // Login: e-mail + wachtwoord -> verkoper-gegevens + ondertekend token (JWT).
  async login(email: string, wachtwoord: string) {
    const u = await this.prisma.gebruiker.findUnique({ where: { email } });
    if (!u || !u.actief) throw new UnauthorizedException('Onbekende gebruiker.');
    const ok = await bcrypt.compare(wachtwoord ?? '', u.wachtwoordHash);
    if (!ok) throw new UnauthorizedException('Verkeerd wachtwoord.');
    const token = signToken({ sub: u.id, naam: u.naam, rol: u.rol }, authSecret());
    return { id: u.id, naam: u.naam, rol: u.rol, token };
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
  personeel() {
    return this.prisma.gebruiker.findMany({
      select: { id: true, naam: true, email: true, rol: true, actief: true },
      orderBy: [{ actief: 'desc' }, { naam: 'asc' }],
    });
  }

  async nieuweGebruiker(input: { naam: string; email: string; wachtwoord: string; rol?: GebruikerRol }) {
    if (!input.naam?.trim() || !input.email?.trim()) throw new BadRequestException('Naam en e-mail zijn vereist.');
    if (!input.wachtwoord || input.wachtwoord.length < 4) throw new BadRequestException('Kies een wachtwoord van minstens 4 tekens.');
    const wachtwoordHash = await bcrypt.hash(input.wachtwoord, 10);
    try {
      const u = await this.prisma.gebruiker.create({
        data: { naam: input.naam.trim(), email: input.email.trim().toLowerCase(), wachtwoordHash, rol: input.rol ?? GebruikerRol.KASSA },
      });
      return { id: u.id, naam: u.naam, email: u.email, rol: u.rol, actief: u.actief };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new BadRequestException('Er bestaat al een account met dit e-mailadres.');
      throw e;
    }
  }

  async updateGebruiker(id: string, input: { naam?: string; rol?: GebruikerRol; actief?: boolean; wachtwoord?: string }) {
    const data: Prisma.GebruikerUpdateInput = {};
    if (input.naam !== undefined) data.naam = input.naam.trim();
    if (input.rol !== undefined) data.rol = input.rol;
    if (input.actief !== undefined) data.actief = input.actief;
    if (input.wachtwoord) {
      if (input.wachtwoord.length < 4) throw new BadRequestException('Kies een wachtwoord van minstens 4 tekens.');
      data.wachtwoordHash = await bcrypt.hash(input.wachtwoord, 10);
    }
    const u = await this.prisma.gebruiker.update({ where: { id }, data });
    return { id: u.id, naam: u.naam, email: u.email, rol: u.rol, actief: u.actief };
  }
}
