import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { PlanningService, type DienstInput } from './planning.service';
import { Recht } from '../auth/auth.guard';

@Controller('planning')
export class PlanningController {
  constructor(private readonly planning: PlanningService) {}

  // GET /planning/mijn?weken=4 -> eigen rooster (elke ingelogde medewerker)
  @Get('mijn')
  mijn(@Req() req: any, @Query('weken') weken?: string) {
    return this.planning.mijn(req.user?.sub, Number(weken) || 4);
  }

  // --- Roosters maken: toegang "planning" ---
  @Recht('planning')
  @Get()
  week(@Query('van') van: string, @Query('tot') tot: string) {
    return this.planning.week(van, tot);
  }

  @Recht('planning')
  @Post('kopieer-week')
  kopieer(@Body() body: { van: string; naar: string }) {
    return this.planning.kopieerWeek(body?.van, body?.naar);
  }

  @Recht('planning')
  @Post()
  maak(@Body() body: DienstInput) {
    return this.planning.maak(body);
  }

  @Recht('planning')
  @Patch(':id')
  wijzig(@Param('id') id: string, @Body() body: Partial<DienstInput>) {
    return this.planning.wijzig(id, body ?? {});
  }

  @Recht('planning')
  @Delete(':id')
  verwijder(@Param('id') id: string) {
    return this.planning.verwijder(id);
  }
}
