import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { PersoneelService, type CategorieInput, type ProfielInput } from './personeel.service';
import { Rollen } from '../auth/auth.guard';

// Personeelsdossier per medewerker — voorlopig ENKEL voor beheerders (eigenaars).
@Rollen('BEHEER', 'BEHEERDER')
@Controller('personeel')
export class PersoneelController {
  constructor(private readonly personeel: PersoneelService) {}

  // Categorieën (ploegen) van het personeel. Deze routes staan vóór ':id', anders vangt die ze op.
  @Get('categorieen')
  categorieen() {
    return this.personeel.categorieen();
  }

  @Post('categorieen')
  maakCategorie(@Body() body: CategorieInput) {
    return this.personeel.maakCategorie(body ?? {});
  }

  @Patch('categorieen/:id')
  wijzigCategorie(@Param('id') id: string, @Body() body: CategorieInput) {
    return this.personeel.wijzigCategorie(id, body ?? {});
  }

  @Delete('categorieen/:id')
  verwijderCategorie(@Param('id') id: string) {
    return this.personeel.verwijderCategorie(id);
  }

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
