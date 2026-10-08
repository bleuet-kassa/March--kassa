import { Body, Controller, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { GebruikerRol } from '@prisma/client';
import { AuthService } from './auth.service';
import { Publiek, Recht } from './auth.guard';
import { RECHTEN } from '../common/rechten';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // POST /auth/login  { email, wachtwoord } -> { id, naam, rol, rechten, token }
  @Publiek()
  @Post('login')
  login(@Body() body: { email: string; wachtwoord: string }) {
    return this.auth.login(body.email, body.wachtwoord);
  }

  // GET /auth/ik -> eigen gegevens met de actuele toegangen
  @Get('ik')
  ik(@Req() req: any) {
    return this.auth.ik(req.user?.sub);
  }

  // GET /auth/rechten -> alle mogelijke toegangen (voor het Personeel-scherm)
  @Get('rechten')
  rechten() {
    return RECHTEN;
  }

  // GET /auth/gebruikers -> actieve verkopers (voor keuzescherm)
  @Get('gebruikers')
  gebruikers() {
    return this.auth.gebruikers();
  }

  // --- Personeelsbeheer: toegang "personeel"; rol en toegangen wijzigen blijft beheerder ---
  @Recht('personeel')
  @Get('personeel')
  personeel() {
    return this.auth.personeel();
  }

  @Recht('personeel')
  @Post('personeel')
  nieuweGebruiker(@Req() req: any, @Body() body: { naam: string; email: string; wachtwoord: string; rol?: GebruikerRol; rechten?: string[] }) {
    return this.auth.nieuweGebruiker(body, req.user);
  }

  @Recht('personeel')
  @Patch('personeel/:id')
  updateGebruiker(@Req() req: any, @Param('id') id: string, @Body() body: { naam?: string; rol?: GebruikerRol; actief?: boolean; wachtwoord?: string; rechten?: string[] | null }) {
    return this.auth.updateGebruiker(id, body, req.user);
  }
}
