import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { PersoneelService, type ProfielInput } from './personeel.service';
import { Rollen } from '../auth/auth.guard';

// Personeelsdossier per medewerker — voorlopig ENKEL voor beheerders (eigenaars).
@Rollen('BEHEER', 'BEHEERDER')
@Controller('personeel')
export class PersoneelController {
  constructor(private readonly personeel: PersoneelService) {}

  // GET /personeel/:id -> account + dossier (gevoelige velden gemaskeerd) + omzet
  @Get(':id')
  profiel(@Param('id') id: string) {
    return this.personeel.profiel(id);
  }

  // GET /personeel/:id/gevoelig -> rijksregisternummer en IBAN volledig
  @Get(':id/gevoelig')
  gevoelig(@Param('id') id: string) {
    return this.personeel.gevoelig(id);
  }

  // PUT /personeel/:id -> dossier bijwerken (enkel meegestuurde velden)
  @Put(':id')
  zet(@Param('id') id: string, @Body() body: ProfielInput) {
    return this.personeel.zetProfiel(id, body ?? {});
  }
}
