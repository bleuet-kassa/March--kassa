import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { KortingenService } from './kortingen.service';
import { Rollen } from '../auth/auth.guard';

@Rollen('BEHEER', 'BEHEERDER')
@Controller('kortingen')
export class KortingenController {
  constructor(private readonly kortingen: KortingenService) {}

  @Get('regelingen')
  regelingen() {
    return this.kortingen.regelingen();
  }

  @Post('regelingen')
  nieuweRegeling(@Body() body: { naam: string; pct: number }) {
    return this.kortingen.nieuweRegeling(body);
  }

  @Get('begunstigden')
  begunstigden(@Query('zoek') zoek?: string) {
    return this.kortingen.begunstigden(zoek);
  }

  @Post('begunstigden')
  nieuweBegunstigde(@Body() body: { email: string; naam?: string; regelingId: string }) {
    return this.kortingen.nieuweBegunstigde(body);
  }

  @Delete('begunstigden/:id')
  verwijderBegunstigde(@Param('id') id: string) {
    return this.kortingen.verwijderBegunstigde(id);
  }

  // Webshop-voorbereiding: korting voor een e-mailadres.
  @Get('voor-email')
  voorEmail(@Query('email') email: string) {
    return this.kortingen.voorEmail(email);
  }
}
