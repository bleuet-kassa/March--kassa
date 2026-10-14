import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AgendaService, type AgendaInput, type HerhalingInput } from './agenda.service';
import { Recht } from '../auth/auth.guard';

// Agenda: voor iedereen met de toegang "agenda" (standaard aan).
@Recht('agenda')
@Controller('agenda')
export class AgendaController {
  constructor(private readonly agenda: AgendaService) {}

  // GET /agenda?van=YYYY-MM-DD&tot=YYYY-MM-DD
  @Get()
  lijst(@Query('van') van: string, @Query('tot') tot: string) {
    return this.agenda.lijst(van, tot);
  }

  // GET /agenda/export.xlsx?van&tot[&categorie=BROOD|CATERING|BOODSCHAPPEN] -> Excel-bestand
  // (zonder categorie: tabblad per categorie + "Alles")
  @Get('export.xlsx')
  async excel(@Query('van') van: string, @Query('tot') tot: string, @Query('categorie') categorie: string | undefined, @Res() res: Response) {
    const buf = await this.agenda.excel(van, tot, categorie || undefined);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="agenda${categorie ? '-' + categorie.toLowerCase() : ''}-${van}-tot-${tot}.xlsx"`);
    res.send(buf);
  }

  // Terugkerende activiteiten (statische paden vóór de :id-routes).
  @Get('herhalingen')
  herhalingen() {
    return this.agenda.herhalingen();
  }
  @Post('herhalingen')
  maakHerhaling(@Body() body: HerhalingInput) {
    return this.agenda.maakHerhaling(body);
  }
  @Patch('herhalingen/:id')
  wijzigHerhaling(@Param('id') id: string, @Body() body: Partial<HerhalingInput>) {
    return this.agenda.wijzigHerhaling(id, body ?? {});
  }
  @Delete('herhalingen/:id')
  verwijderHerhaling(@Param('id') id: string) {
    return this.agenda.verwijderHerhaling(id);
  }

  @Post()
  maak(@Req() req: any, @Body() body: AgendaInput) {
    return this.agenda.maak(body, req.user?.naam ?? null);
  }

  // POST /agenda/:id/gelezen -> webshopbestelling gezien; verhuist naar de afhaal-/leverdag
  @Post(':id/gelezen')
  gelezen(@Param('id') id: string) {
    return this.agenda.gelezen(id);
  }

  @Patch(':id')
  wijzig(@Param('id') id: string, @Body() body: Partial<AgendaInput>) {
    return this.agenda.wijzig(id, body ?? {});
  }

  @Delete(':id')
  verwijder(@Param('id') id: string) {
    return this.agenda.verwijder(id);
  }
}
