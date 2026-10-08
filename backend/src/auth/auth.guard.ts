import { CanActivate, ExecutionContext, Injectable, SetMetadata, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { authSecret, verifyToken } from '../common/token';
import { PrismaService } from '../prisma/prisma.service';
import { effectieveRechten, isAdminRol, type Recht as RechtSleutel } from '../common/rechten';

// Markeer een route als publiek (geen token nodig): @Publiek()
export const PUBLIEK_KEY = 'publiek';
export const Publiek = () => SetMetadata(PUBLIEK_KEY, true);

// Beperk een route tot bepaalde rollen: @Rollen('BEHEER', 'BEHEERDER')
export const ROLLEN_KEY = 'rollen';
export const Rollen = (...rollen: string[]) => SetMetadata(ROLLEN_KEY, rollen);

// Beperk een route tot wie (minstens één van) deze toegangen heeft: @Recht('boekhouding').
// Een beheerder heeft altijd alles. De toegangen worden per verzoek uit de database
// gelezen, zodat een wijziging op het Personeel-scherm meteen geldt.
export const RECHT_KEY = 'recht';
export const Recht = (...rechten: RechtSleutel[]) => SetMetadata(RECHT_KEY, rechten);

// Globale guard: elke route vereist een geldig token, behalve @Publiek().
// @Rollen(...) en @Recht(...) dwingen bovendien rol/toegang af (server-side).
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private reflector: Reflector, private prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const publiek = this.reflector.getAllAndOverride<boolean>(PUBLIEK_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (publiek) return true;

    const req = ctx.switchToHttp().getRequest();
    const auth: string = req.headers['authorization'] || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : undefined;
    const payload = verifyToken(token, authSecret());
    if (!payload) throw new UnauthorizedException('Niet ingelogd of sessie verlopen.');
    req.user = payload;

    const rollen = this.reflector.getAllAndOverride<string[]>(ROLLEN_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (rollen && rollen.length && !rollen.includes(payload.rol)) {
      throw new ForbiddenException('Onvoldoende rechten.');
    }

    const rechten = this.reflector.getAllAndOverride<RechtSleutel[]>(RECHT_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (rechten && rechten.length && !isAdminRol(payload.rol)) {
      const u = await this.prisma.gebruiker.findUnique({ where: { id: payload.sub }, select: { rol: true, rechten: true, actief: true } });
      if (!u || !u.actief) throw new UnauthorizedException('Account niet (meer) actief.');
      const eigen = effectieveRechten(u.rol, u.rechten);
      if (!rechten.some((r) => eigen.includes(r))) {
        throw new ForbiddenException('Je hebt geen toegang tot dit onderdeel. Vraag de beheerder om je toegangen aan te passen.');
      }
    }
    return true;
  }
}
