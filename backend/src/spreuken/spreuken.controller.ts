import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { SpreukenService } from './spreuken.service';
import { Recht } from '../auth/auth.guard';

// Spreuk van de dag: lezen mag iedereen (startscherm kassa), beheer = toegang "instellingen".
@Controller('spreuken')
export class SpreukenController {
  constructor(private readonly spreuken: SpreukenService) {}

  // GET /spreuken/vandaag -> { vandaag, carrousel[], datum }
  @Get('vandaag')
  vanDaag() {
    return this.spreuken.vanDaag();
  }

  @Recht('instellingen')
  @Get()
  lijst() {
    return this.spreuken.lijst();
  }

  @Recht('instellingen')
  @Post()
  toevoegen(@Body() body: { tekst: string; auteur?: string | null; emoji?: string | null }) {
    return this.spreuken.toevoegen(body ?? { tekst: '' });
  }

  // POST /spreuken/aanvullen { aantal? } -> nu nieuwe spreuken laten schrijven door Claude
  @Recht('instellingen')
  @Post('aanvullen')
  aanvullen(@Body() body: { aantal?: number }) {
    return this.spreuken.aanvullen(body?.aantal ?? 7, 'manueel');
  }

  @Recht('instellingen')
  @Patch(':id')
  zetActief(@Param('id') id: string, @Body() body: { actief: boolean }) {
    return this.spreuken.zetActief(id, !!body?.actief);
  }

  @Recht('instellingen')
  @Delete(':id')
  verwijder(@Param('id') id: string) {
    return this.spreuken.verwijder(id);
  }
}
