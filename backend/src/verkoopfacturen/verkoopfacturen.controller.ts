import { Body, Controller, Delete, Get, Param, Post, Put, Req } from '@nestjs/common';
import { VerkoopfacturenService, type FactuurInstellingen } from './verkoopfacturen.service';
import { Rollen } from '../auth/auth.guard';

// Verkoopfacturen uit de kassa (per ticket / maandfactuur per bedrijf) -> Scrada concept.
@Controller('verkoopfacturen')
export class VerkoopfacturenController {
  constructor(private readonly facturen: VerkoopfacturenService) {}

  // GET /verkoopfacturen -> lijst met betaal- en Scrada-status
  @Get()
  lijst() {
    return this.facturen.lijst();
  }

  // GET /verkoopfacturen/overzicht -> aantallen (openstaand, te versturen, tickets zonder factuur)
  @Get('overzicht')
  overzicht() {
    return this.facturen.overzicht();
  }

  // GET /verkoopfacturen/klanten -> bewaarde factuurklanten (B2B) voor de keuze aan de kassa
  @Get('klanten')
  klanten() {
    return this.facturen.klanten();
  }

  // GET /verkoopfacturen/open-rekeningen -> openstaande rekeningen per klant (alle medewerkers)
  @Get('open-rekeningen')
  openRekeningen() {
    return this.facturen.openRekeningen();
  }

  // POST /verkoopfacturen/betaling { sleutel, betalingen:[{betaalwijze,bedrag}] }
  // -> betaling van een rekening ontvangen aan de kassa (alle medewerkers)
  @Post('betaling')
  betaling(@Req() req: any, @Body() body: { sleutel: string; betalingen: { betaalwijze: string; bedrag: number }[] }) {
    return this.facturen.registreerBetaling({ sleutel: body?.sleutel, betalingen: body?.betalingen ?? [], gebruikerId: req.user?.sub });
  }

  // GET/PUT /verkoopfacturen/instellingen -> prefix nummering, verkoopdagboek in Scrada, vervaldagen
  @Get('instellingen')
  instellingen() {
    return this.facturen.instellingen();
  }
  @Put('instellingen')
  @Rollen('BEHEER', 'BEHEERDER')
  zetInstellingen(@Body() body: Partial<FactuurInstellingen> & { volgendeVolgnummer?: number }) {
    return this.facturen.zetInstellingen(body ?? {});
  }

  // GET /verkoopfacturen/:id -> detail + de Scrada-payload (verstuurt niets)
  @Get(':id')
  detail(@Param('id') id: string) {
    return this.facturen.detail(id);
  }

  // POST /verkoopfacturen/ticket/:verkoopId -> factuur maken voor één ticket
  @Post('ticket/:verkoopId')
  @Rollen('BEHEER', 'BEHEERDER')
  ticket(@Param('verkoopId') verkoopId: string) {
    return this.facturen.maakVoorVerkoop(verkoopId);
  }

  // PUT /verkoopfacturen/:id/weergave { samenvatten, omschrijving } -> enkel totalen per BTW-tarief (vóór verzending)
  @Put(':id/weergave')
  @Rollen('BEHEER', 'BEHEERDER')
  weergave(@Param('id') id: string, @Body() body: { samenvatten?: boolean; omschrijving?: string | null }) {
    return this.facturen.zetWeergave(id, body ?? {});
  }

  // DELETE /verkoopfacturen/:id -> factuur verwijderen (bv. testfacturen); tickets worden losgemaakt
  @Delete(':id')
  @Rollen('BEHEER', 'BEHEERDER')
  verwijder(@Param('id') id: string) {
    return this.facturen.verwijder(id);
  }

  // POST /verkoopfacturen/:id/verstuur -> deze factuur (als concept) naar Scrada + dagboekcorrectie
  @Post(':id/verstuur')
  @Rollen('BEHEER', 'BEHEERDER')
  verstuur(@Param('id') id: string) {
    return this.facturen.verstuurNaarScrada(id);
  }

  // POST /verkoopfacturen/verstuur -> alles wat klaarstaat (na de dagen), op vraag van de beheerder
  @Post('verstuur')
  @Rollen('BEHEER', 'BEHEERDER')
  verstuurAlles() {
    return this.facturen.verstuurOpenstaande();
  }
}
