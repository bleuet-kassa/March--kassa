import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { WebshopService, type BestellingInput } from './webshop.service';
import { Publiek, Recht } from '../auth/auth.guard';

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
  bestelling(@Body() body: BestellingInput) {
    return this.webshop.bestelling(body);
  }

  // Betaling afronden — testmodus-simulatie (in LIVE via Axepta-webhook).
  @Publiek()
  @Post('betaling/:id/afronden')
  betalingAfronden(@Param('id') id: string, @Body() body: { gelukt: boolean }) {
    return this.webshop.betalingAfronden(id, body.gelukt);
  }

  // Beheer: bestellingen bekijken en de status bijwerken (enkel beheerders).
  @Recht('webshop')
  @Get('bestellingen')
  bestellingen() {
    return this.webshop.bestellingen();
  }

  @Recht('webshop')
  @Patch('bestellingen/:id/status')
  updateStatus(@Param('id') id: string, @Body() body: { status: string }) {
    return this.webshop.updateStatus(id, body.status);
  }
}
