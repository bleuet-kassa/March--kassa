import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
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

  // Detail van de verkopen op een bedrijf. Standaard enkel de openstaande;
  // ?alle=1 toont ook het verleden (gefactureerd), optioneel binnen een periode
  // (?van=YYYY-MM-DD&tot=YYYY-MM-DD) en per personeelslid (?lidId=...).
  @Get('bedrijven/:id/verkopen')
  verkopen(
    @Param('id') id: string,
    @Query('alle') alle?: string,
    @Query('van') van?: string,
    @Query('tot') tot?: string,
    @Query('lidId') lidId?: string,
  ) {
    const dag = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T00:00:00') : undefined);
    const totDag = dag(tot);
    if (totDag) totDag.setDate(totDag.getDate() + 1); // "tot" inclusief: tot het einde van die dag
    return this.rekeningen.verkopen(id, {
      alleenOpen: alle !== '1',
      van: dag(van),
      tot: totDag,
      lidId: lidId || undefined,
    });
  }

  @Post('bedrijven/:id/factureer')
  factureer(@Param('id') id: string) {
    return this.rekeningen.factureer(id);
  }

  // Een verkoop verschuiven naar een andere rekening (bedrijf + lid).
  @Patch('verkopen/:id/verplaats')
  verplaatsVerkoop(@Param('id') id: string, @Body() body: { bedrijfId: string; lidId: string }) {
    return this.rekeningen.verplaatsVerkoop(id, body.bedrijfId, body.lidId);
  }
}
