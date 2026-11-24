import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { WebshopService, WEBSHOP_WHERE, type BestellingInput, type HerroepingInput } from './webshop.service';
import { LeveringService, type LeverInstellingen, type Leveradres } from './levering.service';
import { FiltersService } from './filters.service';
import { Publiek, Recht, Rollen } from '../auth/auth.guard';

// Achter Cloudflare/Render is de echte bezoeker enkel zichtbaar via deze header.
const bezoeker = (req: Request) => String(req.headers['cf-connecting-ip'] ?? req.ip ?? 'onbekend');

// Publieke (niet-ingelogde) webshop-endpoints + beheer van bestellingen.
@Controller('webshop')
export class WebshopController {
  constructor(private readonly webshop: WebshopService, private readonly levering: LeveringService, private readonly filters: FiltersService) {}

  // Publiek: de zoekfilters die de zaak zelf aanmaakte (enkel met artikels die online staan).
  @Publiek()
  @Get('filters')
  publiekeFilters() {
    return this.filters.publiek(WEBSHOP_WHERE);
  }

  // Beheer van de zoekfilters en welke artikels eronder vallen.
  @Recht('webshop', 'website')
  @Get('filters/beheer')
  filtersBeheer() {
    return this.filters.beheer();
  }

  @Recht('webshop', 'website')
  @Post('filters')
  maakFilter(@Body() body: { naam: string }) {
    return this.filters.maak(body);
  }

  @Recht('webshop', 'website')
  @Patch('filters/:id')
  wijzigFilter(@Param('id') id: string, @Body() body: { naam?: string; omhoog?: boolean; omlaag?: boolean }) {
    return this.filters.wijzig(id, body ?? {});
  }

  @Recht('webshop', 'website')
  @Delete('filters/:id')
  verwijderFilter(@Param('id') id: string) {
    return this.filters.verwijder(id);
  }

  @Recht('webshop', 'website')
  @Put('filters/:id/producten/:productId')
  zetFilterProduct(@Param('id') id: string, @Param('productId') productId: string, @Body() body: { aan: boolean }) {
    return this.filters.zetProduct(id, productId, body?.aan);
  }

  // Publiek: wat een levering naar dit adres kost (de klant ziet het nog voor de betaling).
  // Een adres uit de cache kost niets: daarvoor enkel een ruime rem. Een nieuw adres opzoeken
  // bij OpenStreetMap wel, dus daarvoor een strengere rem per bezoeker.
  @Publiek()
  @Post('leverkost')
  leverkost(@Body() body: { lijnen: BestellingInput['lijnen']; adres: Partial<Leveradres> }, @Req() req: Request) {
    const wie = bezoeker(req);
    this.webshop.rem(`lever:${wie}`, 200);
    return this.webshop.leverkost(body, () => this.webshop.rem(`adres:${wie}`, 15));
  }

  // Leverkosten instellen: vertrekadres, kilometerprijs of forfait, en uitzonderingsregels.
  @Recht('webshop', 'website')
  @Get('levering')
  async leverInstellingen() {
    const inst = await this.levering.instellingen();
    return { ...inst, klaar: this.levering.klaar(inst) };
  }

  @Recht('webshop', 'website')
  @Put('levering')
  zetLeverInstellingen(@Body() body: Partial<LeverInstellingen>) {
    return this.levering.zetInstellingen(body);
  }

  @Recht('webshop', 'website')
  @Post('levering/test')
  testLevering(@Body() body: { adres: Partial<Leveradres>; bedrag: number }) {
    return this.levering.test(body);
  }

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

  // Publiek: de dagen waarop een klant kan afhalen of laten leveren.
  @Publiek()
  @Get('dagen')
  dagen() {
    return this.webshop.beschikbareDagen();
  }

  // Webshopkalender: per dag afhalen en leveren aan of uit, en hoeveel dagen op voorhand.
  @Recht('webshop', 'website')
  @Get('kalender')
  kalender(@Query('maand') maand: string) {
    return this.webshop.kalender(maand);
  }

  @Recht('webshop', 'website')
  @Put('kalender/:datum')
  zetDag(@Param('datum') datum: string, @Body() body: { afhalen?: boolean; leveren?: boolean }) {
    return this.webshop.zetDag(datum, body ?? {});
  }

  @Recht('webshop', 'website')
  @Put('dagen-vooraf')
  zetDagenVooraf(@Body() body: { dagenVooraf: number }) {
    return this.webshop.zetDagenVooraf(body?.dagenVooraf);
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
