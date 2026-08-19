import { CanActivate, ExecutionContext, Injectable, SetMetadata, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { authSecret, verifyToken } from '../common/token';

// Markeer een route als publiek (geen token nodig): @Publiek()
export const PUBLIEK_KEY = 'publiek';
export const Publiek = () => SetMetadata(PUBLIEK_KEY, true);

// Beperk een route tot bepaalde rollen: @Rollen('BEHEER', 'BEHEERDER')
export const ROLLEN_KEY = 'rollen';
export const Rollen = (...rollen: string[]) => SetMetadata(ROLLEN_KEY, rollen);

// Globale guard: elke route vereist een geldig token, behalve @Publiek().
// @Rollen(...) dwingt bovendien de rol af (server-side).
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
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
    return true;
  }
}
