import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { MetaService } from './meta.service';
import { Rollen } from '../auth/auth.guard';

const ADMIN = ['BEHEER', 'BEHEERDER'];

@Controller('meta')
export class MetaController {
  constructor(private readonly meta: MetaService) {}

  // GET /meta -> { btwTarieven, categorieen, leveranciers, locaties }
  @Get()
  alles() {
    return this.meta.alles();
  }

  @Post('afdeling')
  afdeling(@Body() body: { naam: string }) {
    return this.meta.afdeling(body.naam);
  }

  @Post('categorie')
  categorie(@Body() body: { naam: string; afdelingId?: string | null }) {
    return this.meta.categorie(body.naam, body.afdelingId ?? null);
  }

  // Verplaats een bestaande categorie naar een afdeling.
  @Post('categorie/afdeling')
  categorieAfdeling(@Body() body: { categorieId: string; afdelingId: string | null }) {
    return this.meta.categorieNaarAfdeling(body.categorieId, body.afdelingId);
  }

  @Post('leverancier')
  leverancier(@Body() body: { naam: string }) {
    return this.meta.leverancier(body.naam);
  }

  // POST /meta/onderneming -> winkel-onderneming bijwerken (naam, BTW-nr, adres)
  @Rollen(...ADMIN)
  @Post('onderneming')
  onderneming(@Body() body: { naam?: string; btwNummer?: string; adres?: string }) {
    return this.meta.updateOnderneming(body);
  }

  // GET /meta/ondernemingen -> alle ondernemingen (voor instellingen)
  @Rollen(...ADMIN)
  @Get('ondernemingen')
  ondernemingen() {
    return this.meta.ondernemingen();
  }

  // POST /meta/onderneming/:id -> één onderneming bijwerken
  @Rollen(...ADMIN)
  @Post('onderneming/:id')
  updateOnderneming(
    @Param('id') id: string,
    @Body() body: { naam?: string; ondernemingsnummer?: string; btwNummer?: string; adres?: string },
  ) {
    return this.meta.updateOndernemingById(id, body);
  }
}
