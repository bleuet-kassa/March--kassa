import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { ScradaService } from './scrada.service';
import { Rollen } from '../auth/auth.guard';

@Controller('scrada')
export class ScradaController {
  constructor(private readonly scrada: ScradaService) {}

  // GET /scrada/status  -> aantallen per status + modus (test/live) + welke instellingen aanwezig zijn
  @Get('status')
  status() {
    return this.scrada.status();
  }

  // GET /scrada/verbinding  -> test de API-sleutel/wachtwoord/bedrijf bij Scrada (enkel beheerder)
  @Get('verbinding')
  @Rollen('BEHEER', 'BEHEERDER')
  verbinding() {
    return this.scrada.verbinding();
  }

  // PUT /scrada/instellingen { vanaf: "JJJJ-MM-DD" }  -> startdatum: enkel verkopen
  // vanaf die dag gaan naar Scrada (het verleden zit al in de boekhouding).
  @Put('instellingen')
  @Rollen('BEHEER', 'BEHEERDER')
  instellingen(@Body() body: { vanaf: string }) {
    return this.scrada.zetVanaf(body?.vanaf);
  }

  // POST /scrada/reset-status  -> verzendstatus vanaf de startdatum terug op
  // "niet verstuurd" (na testen in de testomgeving, vóór live).
  @Post('reset-status')
  @Rollen('BEHEER', 'BEHEERDER')
  resetStatus() {
    return this.scrada.resetStatus();
  }

  // GET /scrada/openstaande  -> nog te versturen verkopen
  @Get('openstaande')
  openstaande() {
    return this.scrada.openstaande();
  }

  // GET /scrada/preview/:id  -> de Scrada-payload van één verkoop (verstuurt niets)
  @Get('preview/:id')
  preview(@Param('id') id: string) {
    return this.scrada.bouwPayload(id);
  }

  // POST /scrada/verstuur/:id  -> één verkoop versturen (of dry-run in testmodus)
  @Post('verstuur/:id')
  verstuurEen(@Param('id') id: string) {
    return this.scrada.verstuur(id);
  }

  // POST /scrada/verstuur  -> alle openstaande verkopen versturen
  @Post('verstuur')
  verstuurAlles() {
    return this.scrada.verstuurOpenstaande();
  }
}
