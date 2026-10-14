import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AgendaService, type AgendaInput } from './agenda.service';
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

  // GET /agenda/export.xlsx?van&tot -> Excel-bestand
  @Get('export.xlsx')
  async excel(@Query('van') van: string, @Query('tot') tot: string, @Res() res: Response) {
    const buf = await this.agenda.excel(van, tot);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="agenda-${van}-tot-${tot}.xlsx"`);
    res.send(buf);
  }

  @Post()
  maak(@Req() req: any, @Body() body: AgendaInput) {
    return this.agenda.maak(body, req.user?.naam ?? null);
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
