import { Controller, Get, Query } from '@nestjs/common';
import { RapportenService } from './rapporten.service';
import { Rollen } from '../auth/auth.guard';

// Managementrapporten — enkel beheerders (server-side afgedwongen).
@Rollen('BEHEER', 'BEHEERDER')
@Controller('rapporten')
export class RapportenController {
  constructor(private readonly rapporten: RapportenService) {}

  @Get('maandoverzicht')
  maandoverzicht() {
    return this.rapporten.maandoverzicht();
  }

  @Get('categorie')
  categorie(@Query('van') van?: string, @Query('tot') tot?: string) {
    return this.rapporten.perCategorie(van, tot);
  }

  @Get('kassa-facturen')
  kassaFacturen(@Query('van') van?: string, @Query('tot') tot?: string) {
    return this.rapporten.kassaVsFacturen(van, tot);
  }
}
