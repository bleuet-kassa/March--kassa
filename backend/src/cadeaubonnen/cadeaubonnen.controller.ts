import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CadeaubonnenService, NieuweBon } from './cadeaubonnen.service';

@Controller('cadeaubonnen')
export class CadeaubonnenController {
  constructor(private readonly bonnen: CadeaubonnenService) {}

  // GET /cadeaubonnen?zoek=  -> register (lijst)
  @Get()
  lijst(@Query('zoek') zoek?: string) {
    return this.bonnen.lijst(zoek);
  }

  // GET /cadeaubonnen/nieuw-nummer -> voorstel voor het volgende nummer
  @Get('nieuw-nummer')
  nieuwNummer() {
    return this.bonnen.volgendNummer().then((nummer) => ({ nummer }));
  }

  // POST /cadeaubonnen -> nieuwe cadeaubon registreren
  @Post()
  nieuw(@Body() body: NieuweBon) {
    return this.bonnen.nieuw(body);
  }

  // POST /cadeaubonnen/:id/inwisselen -> als ingewisseld markeren
  @Post(':id/inwisselen')
  inwisselen(@Param('id') id: string) {
    return this.bonnen.inwisselen(id);
  }
}
