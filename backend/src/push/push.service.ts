import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { GebruikerRol } from '@prisma/client';
import * as webpush from 'web-push';
import { PrismaService } from '../prisma/prisma.service';

// Pushmeldingen naar de smartphone van de beheerder(s) (Web Push / VAPID).
// De VAPID-sleutels maakt de server eenmalig zelf aan en bewaart ze in de
// tabel Instelling — er hoeft dus geen geheim via omgevingsvariabelen.
@Injectable()
export class PushService {
  private readonly log = new Logger(PushService.name);
  private sleutels: { publicKey: string; privateKey: string } | null = null;

  constructor(private prisma: PrismaService) {}

  // Laadt (of maakt) de VAPID-sleutels en configureert web-push.
  private async vapid() {
    if (this.sleutels) return this.sleutels;
    const [pub, priv] = await Promise.all([
      this.prisma.instelling.findUnique({ where: { sleutel: 'vapid.public' } }),
      this.prisma.instelling.findUnique({ where: { sleutel: 'vapid.private' } }),
    ]);
    let publicKey = pub?.waarde;
    let privateKey = priv?.waarde;
    if (!publicKey || !privateKey) {
      const k = webpush.generateVAPIDKeys();
      publicKey = k.publicKey;
      privateKey = k.privateKey;
      await this.prisma.instelling.upsert({ where: { sleutel: 'vapid.public' }, create: { sleutel: 'vapid.public', waarde: publicKey }, update: { waarde: publicKey } });
      await this.prisma.instelling.upsert({ where: { sleutel: 'vapid.private' }, create: { sleutel: 'vapid.private', waarde: privateKey }, update: { waarde: privateKey } });
      this.log.log('Nieuwe VAPID-sleutels voor pushmeldingen aangemaakt.');
    }
    webpush.setVapidDetails(process.env.VAPID_CONTACT || 'mailto:info@marche.eu', publicKey, privateKey);
    this.sleutels = { publicKey, privateKey };
    return this.sleutels;
  }

  async publiekeSleutel() {
    return (await this.vapid()).publicKey;
  }

  // Dit toestel (browser) van een beheerder abonneren. Eén rij per endpoint.
  async abonneer(gebruikerId: string, sub: { endpoint: string; keys: { p256dh: string; auth: string } }, toestel?: string) {
    if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) throw new BadRequestException('Ongeldig push-abonnement.');
    await this.prisma.pushAbonnement.upsert({
      where: { endpoint: sub.endpoint },
      create: { gebruikerId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, toestel: toestel ?? null },
      update: { gebruikerId, p256dh: sub.keys.p256dh, auth: sub.keys.auth, toestel: toestel ?? null },
    });
    return { ok: true };
  }

  async verwijderAbonnement(endpoint: string) {
    await this.prisma.pushAbonnement.deleteMany({ where: { endpoint } });
    return { ok: true };
  }

  aantalAbonnementen(gebruikerId?: string) {
    return this.prisma.pushAbonnement.count({ where: gebruikerId ? { gebruikerId } : {} });
  }

  // Stuurt een melding naar alle actieve beheerders (al hun toestellen).
  // Verlopen/ingetrokken abonnementen (404/410) worden meteen opgeruimd.
  async naarBeheerders(payload: { titel: string; tekst: string; url: string; tag?: string }) {
    await this.vapid();
    const abos = await this.prisma.pushAbonnement.findMany({
      where: { gebruiker: { actief: true, rol: { in: [GebruikerRol.BEHEER, GebruikerRol.BEHEERDER] } } },
    });
    let verstuurd = 0;
    for (const a of abos) {
      try {
        await webpush.sendNotification(
          { endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } },
          JSON.stringify(payload),
          { TTL: 6 * 3600, urgency: 'high' },
        );
        verstuurd++;
      } catch (e: any) {
        const code = e?.statusCode;
        if (code === 404 || code === 410) {
          await this.prisma.pushAbonnement.delete({ where: { id: a.id } }).catch(() => undefined);
        } else {
          this.log.warn(`Pushmelding mislukt (${code ?? e?.message ?? 'onbekend'})`);
        }
      }
    }
    return { verstuurd, toestellen: abos.length };
  }
}
