import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Betaalwijze } from '@prisma/client';
import { SalesService, AfrekenInput } from './sales.service';
import { Rollen } from '../auth/auth.guard';

@Controller('verkopen')
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  // POST /verkopen  -> rekent de kassaverkoop af en geeft het ticket terug
  @Post()
  afrekenen(@Body() body: AfrekenInput) {
    return this.sales.afrekenen(body);
  }

  // GET /verkopen?datum=YYYY-MM-DD  -> recente verkopen (voor herafdrukken)
  @Get()
  recente(@Query('datum') datum?: string) {
    return this.sales.recente(datum);
  }

  // GET /verkopen/:id/ticket  -> ticket opnieuw ophalen/printen
  @Get(':id/ticket')
  ticket(@Param('id') id: string) {
    return this.sales.ticket(id);
  }

  // POST /verkopen/:id/annuleer  -> ticket schrappen (uit de dagafsluiting, voorraad terug)
  // Toegankelijk voor elke ingelogde medewerker (de kassa draait op een KASSA-account).
  @Post(':id/annuleer')
  annuleer(@Param('id') id: string, @Body() body: { reden?: string }) {
    return this.sales.annuleer(id, body?.reden);
  }

  // PATCH /verkopen/:id/betaalwijze  -> betaalwijze van een verkoop wijzigen
  @Patch(':id/betaalwijze')
  wijzigBetaalwijze(@Param('id') id: string, @Body() body: { betaalwijze: Betaalwijze; wachtwoord: string }) {
    return this.sales.wijzigBetaalwijze(id, body.betaalwijze, body.wachtwoord);
  }

  // DELETE /verkopen/:id  -> verkoop volledig verwijderen. Enkel voor een
  // ingelogde beheerder (server-side afgedwongen via @Rollen); geen wachtwoord.
  @Delete(':id')
  @Rollen('BEHEER', 'BEHEERDER')
  verwijder(@Param('id') id: string) {
    return this.sales.verwijder(id);
  }
}
