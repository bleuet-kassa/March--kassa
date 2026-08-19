import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { GebruikerRol } from '@prisma/client';
import { AuthService } from './auth.service';
import { Publiek, Rollen } from './auth.guard';

const ADMIN = ['BEHEER', 'BEHEERDER'];

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // POST /auth/login  { email, wachtwoord } -> { id, naam, rol, token }
  @Publiek()
  @Post('login')
  login(@Body() body: { email: string; wachtwoord: string }) {
    return this.auth.login(body.email, body.wachtwoord);
  }

  // GET /auth/gebruikers -> actieve verkopers (voor keuzescherm)
  @Get('gebruikers')
  gebruikers() {
    return this.auth.gebruikers();
  }

  // --- Personeelsbeheer (enkel beheerders) ---
  @Rollen(...ADMIN)
  @Get('personeel')
  personeel() {
    return this.auth.personeel();
  }

  @Rollen(...ADMIN)
  @Post('personeel')
  nieuweGebruiker(@Body() body: { naam: string; email: string; wachtwoord: string; rol?: GebruikerRol }) {
    return this.auth.nieuweGebruiker(body);
  }

  @Rollen(...ADMIN)
  @Patch('personeel/:id')
  updateGebruiker(@Param('id') id: string, @Body() body: { naam?: string; rol?: GebruikerRol; actief?: boolean; wachtwoord?: string }) {
    return this.auth.updateGebruiker(id, body);
  }
}
