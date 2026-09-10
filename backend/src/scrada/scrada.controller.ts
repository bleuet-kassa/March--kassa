import { Controller, Get, Param, Post } from '@nestjs/common';
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
