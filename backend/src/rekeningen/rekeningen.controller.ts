import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { RekeningenService } from './rekeningen.service';

// Lopende rekeningen ("op rekening"). Zowel het overzicht als het beheer
// (bedrijven/personeel toevoegen en aanpassen, factureren) is toegankelijk voor
// elke ingelogde medewerker — de kassa draait op een KASSA-account.
@Controller('rekeningen')
export class RekeningenController {
  constructor(private readonly rekeningen: RekeningenService) {}

  // Voor de kassa: actieve bedrijven + leden.
  @Get('kassa')
  voorKassa() {
    return this.rekeningen.voorKassa();
  }

  // Overzicht van de lopende rekeningen (openstaand per bedrijf + per persoon).
  @Get('overzicht')
  overzicht() {
    return this.rekeningen.overzicht();
  }

  @Get('bedrijven')
  bedrijven() {
    return this.rekeningen.bedrijven();
  }

  @Post('bedrijven')
  nieuwBedrijf(@Body() body: { naam: string; btwNummer?: string; adres?: string; email?: string }) {
    return this.rekeningen.nieuwBedrijf(body);
  }

  @Patch('bedrijven/:id')
  updateBedrijf(@Param('id') id: string, @Body() body: any) {
    return this.rekeningen.updateBedrijf(id, body);
  }

  @Post('leden')
  nieuwLid(@Body() body: { bedrijfId: string; naam: string; budget?: number }) {
    return this.rekeningen.nieuwLid(body);
  }

  @Patch('leden/:id')
  updateLid(@Param('id') id: string, @Body() body: any) {
    return this.rekeningen.updateLid(id, body);
  }

  // Detail van de verkopen op een bedrijf.
  @Get('bedrijven/:id/verkopen')
  verkopen(@Param('id') id: string) {
    return this.rekeningen.verkopen(id);
  }

  @Post('bedrijven/:id/factureer')
  factureer(@Param('id') id: string) {
    return this.rekeningen.factureer(id);
  }
}
