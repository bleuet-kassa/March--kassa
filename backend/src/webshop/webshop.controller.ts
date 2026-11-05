import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { WebshopService, type BestellingInput, type HerroepingInput } from './webshop.service';
import { Publiek, Recht, Rollen } from '../auth/auth.guard';

// Achter Cloudflare/Render is de echte bezoeker enkel zichtbaar via deze header.
const bezoeker = (req: Request) => String(req.headers['cf-connecting-ip'] ?? req.ip ?? 'onbekend');

// Publieke (niet-ingelogde) webshop-endpoints + beheer van bestellingen.
@Controller('webshop')
export class WebshopController {
  constructor(private readonly webshop: WebshopService) {}

  @Publiek()
  @Get('producten')
  producten(@Query('afdelingId') afdelingId?: string) {
    return this.webshop.producten(afdelingId);
  }

  @Publiek()
  @Get('afdelingen')
  afdelingen() {
    return this.webshop.afdelingen();
  }

  @Publiek()
  @Get('instellingen')
  instellingen() {
    return this.webshop.instellingen();
  }

  // Publiek: een bestelling starten; de klant gaat daarna naar de betaalpagina van Mollie.
  @Publiek()
  @Post('bestelling')
  bestelling(@Body() body: BestellingInput, @Req() req: Request) {
    this.webshop.rem(bezoeker(req));
    return this.webshop.bestelling(body);
  }

  // Publiek met geheime sleutel: de klant komt terug van Mollie en ziet de status.
  @Publiek()
  @Get('bestelling/:sleutel')
  bestelStatus(@Param('sleutel') sleutel: string) {
    return this.webshop.statusVan(sleutel);
  }

  // Webhook van Mollie: enkel het id komt binnen, de status vragen we zelf na bij Mollie.
  // Antwoord altijd 200, behalve als het verwerken mislukt: dan probeert Mollie opnieuw.
  @Publiek()
  @Post('mollie')
  @HttpCode(200)
  async mollieWebhook(@Body() body: { id?: string }) {
    await this.webshop.verwerkBetaling(String(body?.id ?? ''));
    return 'ok';
  }

  // Publiek: de herroepingsfunctie van de website.
  @Publiek()
  @Post('herroeping')
  herroeping(@Body() body: HerroepingInput, @Req() req: Request) {
    this.webshop.rem(bezoeker(req));
    return this.webshop.herroeping(body);
  }

  // Bestellingen bekijken en de status bijwerken: toegang "bestellingen" (standaard voor
  // alle kassamedewerkers) of "webshop".
  @Recht('bestellingen', 'webshop')
  @Get('bestellingen')
  bestellingen() {
    return this.webshop.bestellingen();
  }

  @Recht('bestellingen', 'webshop')
  @Get('mollie-status')
  mollieStatus() {
    return this.webshop.mollieStatus();
  }

  @Recht('bestellingen', 'webshop')
  @Patch('bestellingen/:id/status')
  updateStatus(@Param('id') id: string, @Body() body: { status: string }) {
    return this.webshop.updateStatus(id, body.status);
  }

  // Terugbetalen is echt geld dat vertrekt: enkel voor beheerders.
  @Rollen('BEHEER', 'BEHEERDER')
  @Post('bestellingen/:id/terugbetalen')
  terugbetalen(@Param('id') id: string, @Body() body: { lijnen: { productId: string; aantal: number }[] }) {
    return this.webshop.terugbetalen(id, body?.lijnen);
  }
}
