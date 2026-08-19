import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { RekeningenService } from './rekeningen.service';
import { Rollen } from '../auth/auth.guard';

const ADMIN = ['BEHEER', 'BEHEERDER'];

@Controller('rekeningen')
export class RekeningenController {
  constructor(private readonly rekeningen: RekeningenService) {}

  // Voor de kassa: actieve bedrijven + leden (elke ingelogde verkoper).
  @Get('kassa')
  voorKassa() {
    return this.rekeningen.voorKassa();
  }

  // --- Beheer (enkel beheerders) ---
  @Rollen(...ADMIN)
  @Get('overzicht')
  overzicht() {
    return this.rekeningen.overzicht();
  }

  @Rollen(...ADMIN)
  @Get('bedrijven')
  bedrijven() {
    return this.rekeningen.bedrijven();
  }

  @Rollen(...ADMIN)
  @Post('bedrijven')
  nieuwBedrijf(@Body() body: { naam: string; btwNummer?: string; adres?: string; email?: string }) {
    return this.rekeningen.nieuwBedrijf(body);
  }

  @Rollen(...ADMIN)
  @Patch('bedrijven/:id')
  updateBedrijf(@Param('id') id: string, @Body() body: any) {
    return this.rekeningen.updateBedrijf(id, body);
  }

  @Rollen(...ADMIN)
  @Post('leden')
  nieuwLid(@Body() body: { bedrijfId: string; naam: string; budget?: number }) {
    return this.rekeningen.nieuwLid(body);
  }

  @Rollen(...ADMIN)
  @Patch('leden/:id')
  updateLid(@Param('id') id: string, @Body() body: any) {
    return this.rekeningen.updateLid(id, body);
  }

  @Rollen(...ADMIN)
  @Get('bedrijven/:id/verkopen')
  verkopen(@Param('id') id: string) {
    return this.rekeningen.verkopen(id);
  }

  @Rollen(...ADMIN)
  @Post('bedrijven/:id/factureer')
  factureer(@Param('id') id: string) {
    return this.rekeningen.factureer(id);
  }
}
