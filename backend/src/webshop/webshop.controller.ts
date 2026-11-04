import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { WebshopService, type BestellingInput, type HerroepingInput } from './webshop.service';
import { Publiek, Recht } from '../auth/auth.guard';

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

  // Publiek: een bestelling plaatsen.
  @Publiek()
  @Post('bestelling')
  bestelling(@Body() body: BestellingInput, @Req() req: Request) {
    this.webshop.rem(bezoeker(req));
    return this.webshop.bestelling(body);
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
  @Patch('bestellingen/:id/status')
  updateStatus(@Param('id') id: string, @Body() body: { status: string }) {
    return this.webshop.updateStatus(id, body.status);
  }
}
