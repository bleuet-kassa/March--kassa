import { Body, Controller, Delete, Get, Post, Req } from '@nestjs/common';
import { PushService } from './push.service';
import { Rollen } from '../auth/auth.guard';

// Pushmeldingen (Web Push) — abonnementen van de beheerder-telefoon(s).
@Controller('push')
export class PushController {
  constructor(private readonly push: PushService) {}

  // GET /push/vapid -> publieke VAPID-sleutel om een abonnement te maken
  @Get('vapid')
  async vapid() {
    return { publicKey: await this.push.publiekeSleutel() };
  }

  // GET /push/status -> aantal toestellen van mij / in totaal
  @Get('status')
  async status(@Req() req: any) {
    return {
      mijnToestellen: await this.push.aantalAbonnementen(req.user?.sub),
      totaal: await this.push.aantalAbonnementen(),
    };
  }

  // POST /push/abonneer -> dit toestel abonneren (enkel beheerders)
  @Post('abonneer')
  @Rollen('BEHEER', 'BEHEERDER')
  abonneer(@Req() req: any, @Body() body: { abonnement: { endpoint: string; keys: { p256dh: string; auth: string } }; toestel?: string }) {
    return this.push.abonneer(req.user.sub, body?.abonnement, body?.toestel);
  }

  // DELETE /push/abonneer -> dit toestel afmelden
  @Delete('abonneer')
  @Rollen('BEHEER', 'BEHEERDER')
  verwijder(@Body() body: { endpoint: string }) {
    return this.push.verwijderAbonnement(body?.endpoint);
  }

  // POST /push/test -> testmelding naar alle beheerder-toestellen
  @Post('test')
  @Rollen('BEHEER', 'BEHEERDER')
  test() {
    return this.push.naarBeheerders({
      titel: 'Marché kassa',
      tekst: 'Testmelding — pushmeldingen werken op dit toestel.',
      url: '/kassa',
      tag: 'test',
    });
  }
}
