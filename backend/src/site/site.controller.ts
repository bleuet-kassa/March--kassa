import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { SiteService } from './site.service';
import { Publiek, Recht } from '../auth/auth.guard';

@Controller('site')
export class SiteController {
  constructor(private readonly site: SiteService) {}

  // Publiek: alle inhoud voor de website.
  @Publiek()
  @Get('inhoud')
  inhoud() {
    return this.site.inhoud();
  }

  // Beheer (enkel beheerders): teksten, openingsuren en partners.
  @Recht('website')
  @Put('teksten')
  zetTeksten(@Body() body: Record<string, string>) {
    return this.site.zetTeksten(body);
  }

  @Recht('website')
  @Put('openingsuren')
  zetOpeningsuren(@Body() body: { openingsuren: { dag: number; gesloten: boolean; van?: string | null; tot?: string | null }[] }) {
    return this.site.zetOpeningsuren(body.openingsuren);
  }

  @Recht('website')
  @Post('partners')
  nieuwePartner(@Body() body: { naam: string; website?: string | null; volgorde?: number }) {
    return this.site.nieuwePartner(body);
  }

  @Recht('website')
  @Patch('partners/:id')
  updatePartner(@Param('id') id: string, @Body() body: { naam?: string; website?: string | null; logoUrl?: string | null; volgorde?: number }) {
    return this.site.updatePartner(id, body);
  }

  @Recht('website')
  @Delete('partners/:id')
  verwijderPartner(@Param('id') id: string) {
    return this.site.verwijderPartner(id);
  }

  // Afbeelding uploaden -> { id, url } (enkel beheerders)
  @Recht('website')
  @Post('afbeelding')
  @UseInterceptors(FileInterceptor('bestand'))
  upload(@UploadedFile() file: { buffer: Buffer; mimetype: string } | undefined) {
    return this.site.bewaarAfbeelding(file);
  }

  // Afbeelding serveren (publiek — nodig voor de website).
  @Publiek()
  @Get('afbeelding/:id')
  async afbeelding(@Param('id') id: string, @Res() res: Response) {
    const a = await this.site.afbeelding(id);
    if (!a) { res.status(404).end(); return; }
    res.setHeader('Content-Type', a.mimetype);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.end(a.data);
  }
}
