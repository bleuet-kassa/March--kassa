import { Body, Controller, Get, Header, Param, Post, Req } from '@nestjs/common';
import { DagafsluitingService } from './dagafsluiting.service';
import { Publiek, Rollen } from '../auth/auth.guard';
import { authSecret, verifyToken } from '../common/token';

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

  // POST /dagafsluiting -> sluit de dag rechtstreeks af (enkel een ingelogde beheerder).
  // Andere medewerkers gaan via een aanvraag die de beheerder bevestigt.
  @Post()
  @Rollen('BEHEER', 'BEHEERDER')
  afsluiten(@Body() body: { gebruikerId?: string }) {
    return this.dag.afsluiten(body?.gebruikerId);
  }

  // ---- Dagafsluiting op afstand bevestigen ----

  // POST /dagafsluiting/aanvraag -> de kassa vraagt de afsluiting aan; de
  // beheerder krijgt een pushmelding op de telefoon met een bevestig-link.
  @Post('aanvraag')
  aanvraag(@Req() req: any) {
    return this.dag.aanvraag(req.user?.sub);
  }

  // GET /dagafsluiting/aanvraag/open -> de openstaande aanvraag (of null), voor het kassa-scherm
  @Get('aanvraag/open')
  async open() {
    const a = await this.dag.openAanvraag();
    return { aanvraag: a ? this.dag.aanvraagInfo(a) : null };
  }

  // GET /dagafsluiting/bevestig/:token -> (publiek, met geheime token) wat de
  // beheerder op de telefoon te zien krijgt vóór het bevestigen.
  @Publiek()
  @Get('bevestig/:token')
  viaToken(@Param('token') token: string) {
    return this.dag.aanvraagViaToken(token);
  }

  // POST /dagafsluiting/bevestig/:token -> (publiek, met geheime token) de dag
  // effectief afsluiten en registreren.
  @Publiek()
  @Post('bevestig/:token')
  bevestig(@Param('token') token: string, @Req() req: any) {
    return this.dag.bevestig(token, this.beheerderUitHeader(req));
  }

  // POST /dagafsluiting/weiger/:token -> (publiek, met geheime token) aanvraag weigeren
  @Publiek()
  @Post('weiger/:token')
  weiger(@Param('token') token: string) {
    return this.dag.weiger(token);
  }

  // Herkent optioneel een ingelogde beheerder (telefoon met kassa-sessie), zodat
  // de bevestiging op naam komt. Geen sessie = ook goed: de token volstaat.
  private beheerderUitHeader(req: any): string | undefined {
    const auth: string = req?.headers?.['authorization'] || '';
    const t = auth.startsWith('Bearer ') ? auth.slice(7) : undefined;
    const p = verifyToken(t, authSecret());
    return p && (p.rol === 'BEHEER' || p.rol === 'BEHEERDER') ? p.sub : undefined;
  }
}
