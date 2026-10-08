import { Controller, Get, Query } from '@nestjs/common';
import { RapportenService } from './rapporten.service';
import { Recht } from '../auth/auth.guard';

// Managementrapporten — enkel wie de toegang "rapporten" heeft (server-side afgedwongen).
@Recht('rapporten')
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
