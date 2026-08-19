import { Body, Controller, Get, Header, Param, Post } from '@nestjs/common';
import { DagafsluitingService } from './dagafsluiting.service';

@Controller('dagafsluiting')
export class DagafsluitingController {
  constructor(private readonly dag: DagafsluitingService) {}

  // GET /dagafsluiting/overzicht -> voorbeeld dagontvangsten-rapport (sluit niets af)
  @Get('overzicht')
  overzicht() {
    return this.dag.overzicht();
  }

  // GET /dagafsluiting -> eerdere afsluitingen (geschiedenis)
  @Get()
  geschiedenis() {
    return this.dag.geschiedenis();
  }

  // GET /dagafsluiting/:id -> volledig rapport van een bewaarde afsluiting
  @Get(':id')
  rapport(@Param('id') id: string) {
    return this.dag.rapport(id);
  }

  // GET /dagafsluiting/:id/csv -> CSV-export (manuele controle/boekhouder)
  @Get(':id/csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="dagontvangsten.csv"')
  csv(@Param('id') id: string) {
    return this.dag.csv(id);
  }

  // POST /dagafsluiting -> sluit de dag af en bewaart het rapport
  @Post()
  afsluiten(@Body() body: { gebruikerId?: string }) {
    return this.dag.afsluiten(body?.gebruikerId);
  }
}
