import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { ScradaService } from './scrada.service';
import { ScradaDagboekService, type DagboekInstellingen } from './scrada.dagboek.service';
import { Rollen } from '../auth/auth.guard';

@Controller('scrada')
export class ScradaController {
  constructor(private readonly scrada: ScradaService, private readonly dagboek: ScradaDagboekService) {}

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
  // "niet verstuurd" (na testen in de testomgeving, vóór live). Zowel de
  // dagafsluitingen (dagontvangstenboek) als de losse tickets.
  @Post('reset-status')
  @Rollen('BEHEER', 'BEHEERDER')
  async resetStatus() {
    const dagen = await this.dagboek.resetStatus();
    const tickets = await this.scrada.resetStatus();
    return { ok: true, dagen: dagen.aantal, tickets: tickets.aantal };
  }

  // ---- Dagontvangstenboek (per afgesloten dag) ----

  // GET /scrada/dagboek/instellingen  -> gekozen dagboek + koppeling BTW/betaalwijzen
  @Get('dagboek/instellingen')
  dagboekInstellingen() {
    return this.dagboek.instellingen();
  }

  // PUT /scrada/dagboek/instellingen  -> koppeling bewaren (enkel beheerder)
  @Put('dagboek/instellingen')
  @Rollen('BEHEER', 'BEHEERDER')
  zetDagboekInstellingen(@Body() body: Partial<DagboekInstellingen>) {
    return this.dagboek.zetInstellingen(body ?? {});
  }

  // Lijsten uit Scrada om de koppeling te kiezen (enkel beheerder).
  @Get('dagboek/dagboeken')
  @Rollen('BEHEER', 'BEHEERDER')
  dagboeken() {
    return this.dagboek.dagboeken();
  }
  @Get('dagboek/dagboeken/:id/categorieen')
  @Rollen('BEHEER', 'BEHEERDER')
  categorieen(@Param('id') id: string) {
    return this.dagboek.categorieen(id);
  }
  @Get('dagboek/dagboeken/:id/betaalmethoden')
  @Rollen('BEHEER', 'BEHEERDER')
  betaalmethoden(@Param('id') id: string) {
    return this.dagboek.betaalmethoden(id);
  }

  // GET /scrada/dagboek/dagen  -> afgesloten dagen met hun Scrada-status
  @Get('dagboek/dagen')
  dagen() {
    return this.dagboek.dagen();
  }

  // GET /scrada/dagboek/dagen/:id/preview  -> de dagboeking zoals ze naar Scrada gaat (verstuurt niets)
  @Get('dagboek/dagen/:id/preview')
  dagPreview(@Param('id') id: string) {
    return this.dagboek.preview(id);
  }

  // POST /scrada/dagboek/dagen/:id/verstuur  -> één dag versturen (enkel beheerder)
  @Post('dagboek/dagen/:id/verstuur')
  @Rollen('BEHEER', 'BEHEERDER')
  verstuurDag(@Param('id') id: string) {
    return this.dagboek.verstuurDag(id);
  }

  // POST /scrada/dagboek/verstuur  -> alle openstaande dagen vanaf de startdatum (enkel beheerder)
  @Post('dagboek/verstuur')
  @Rollen('BEHEER', 'BEHEERDER')
  verstuurDagen() {
    return this.dagboek.verstuurOpenstaandeDagen();
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
