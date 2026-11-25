import { Body, Controller, Get, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { VoorraadService } from './voorraad.service';
import { Recht, Rollen } from '../auth/auth.guard';

type MetGebruiker = { user?: { naam?: string } };

// Voorraad: centrale lijst, per artikel, ontvangen (met datum en THT), afboeken en tellen.
// Zelfde toegang als het beheer van artikels (daar ontving je al voorraad).
@Recht('beheer')
@Controller('voorraad')
export class VoorraadController {
  constructor(private readonly voorraad: VoorraadService) {}

  // GET /voorraad?zoek=&afdelingId=&filter=alarm|voorraad|negatief|zonderTht
  @Get()
  lijst(@Query('zoek') zoek?: string, @Query('afdelingId') afdelingId?: string, @Query('filter') filter?: string) {
    return this.voorraad.lijst({ zoek, afdelingId, filter });
  }

  // GET /voorraad/alarm -> aantallen voor het belletje in de menubalk + laatste controle
  @Get('alarm')
  async alarm() {
    const [a, laatste] = await Promise.all([this.voorraad.alarmen(), this.voorraad.laatsteControle()]);
    return { verlopen: a.verlopen.length, bijna: a.bijna.length, alarmDagen: a.alarmDagen, laatsteControle: laatste };
  }

  @Get('artikel/:id')
  artikel(@Param('id') id: string) {
    return this.voorraad.artikel(id);
  }

  // Ook { bestaand: true }: de THT registreren van wat er al ligt, zonder de voorraad te verhogen.
  // Body zonder 'bron': die bepaalt de server (een factuur boekt via de factuur-import).
  @Post('ontvangst')
  ontvangst(@Body() body: Parameters<VoorraadService['ontvangst']>[0], @Req() req: MetGebruiker) {
    return this.voorraad.ontvangst({ ...(body ?? {}), bron: undefined }, req.user?.naam ?? null);
  }

  // Een ontvangst verbeteren: THT, ontvangstdatum, opmerking (de voorraad verandert niet).
  @Patch('ontvangst/:id')
  wijzigOntvangst(@Param('id') id: string, @Body() body: Parameters<VoorraadService['wijzigOntvangst']>[1], @Req() req: MetGebruiker) {
    return this.voorraad.wijzigOntvangst(id, body ?? {}, req.user?.naam ?? null);
  }

  // Een ontvangst annuleren (de voorraad gaat terug omlaag): enkel een beheerder.
  @Rollen('BEHEER', 'BEHEERDER')
  @Post('ontvangst/:id/annuleer')
  annuleerOntvangst(@Param('id') id: string, @Req() req: MetGebruiker) {
    return this.voorraad.annuleerOntvangst(id, req.user?.naam ?? null);
  }

  @Post('afboeken')
  afboeken(@Body() body: Parameters<VoorraadService['afboeken']>[0], @Req() req: MetGebruiker) {
    return this.voorraad.afboeken(body, req.user?.naam ?? null);
  }

  @Post('tellen')
  tellen(@Body() body: Parameters<VoorraadService['tellen']>[0], @Req() req: MetGebruiker) {
    return this.voorraad.tellen(body, req.user?.naam ?? null);
  }

  // THT nodig bij ontvangst: per artikel aan of uit.
  @Patch('artikel/:id/tht')
  tht(@Param('id') id: string, @Body() body: { thtNodig: boolean }) {
    return this.voorraad.zetThtNodig(id, body?.thtNodig);
  }

  @Get('instellingen')
  instellingen() {
    return this.voorraad.instellingen();
  }

  // Hoeveel dagen vooraf het THT-alarm afgaat: enkel een beheerder.
  @Rollen('BEHEER', 'BEHEERDER')
  @Put('instellingen')
  zetInstellingen(@Body() body: { alarmDagen: number }) {
    return this.voorraad.zetInstellingen(body ?? {});
  }

  // De THT-controle nu meteen uitvoeren (en een melding sturen als er iets is): enkel een beheerder.
  @Rollen('BEHEER', 'BEHEERDER')
  @Post('controleer')
  controleer() {
    return this.voorraad.controleer(true);
  }
}
