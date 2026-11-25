import {
  Body,
  Controller,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { FacturenService, VerwerkInput } from './facturen.service';
import { Recht } from '../auth/auth.guard';

type MetGebruiker = { user?: { naam?: string } };

// Aankoopfacturen inlezen -> toegang "facturen".
@Recht('facturen')
@Controller('facturen')
export class FacturenController {
  constructor(private readonly facturen: FacturenService) {}

  // POST /facturen/inlezen  (multipart: veld "file" = PDF)
  // -> herkende regels ter controle, met wat de kassa er al van weet (voegt nog niets toe)
  @Post('inlezen')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  inlezen(@UploadedFile() file: { buffer: Buffer; mimetype: string } | undefined) {
    if (!file) throw new BadRequestException('Geen bestand ontvangen.');
    return this.facturen.inlezen(file.buffer);
  }

  // POST /facturen/verwerken  { sleutel, leverancierId, factuurnummer, locatieId, ontvangenOp, regels, toch? }
  // -> boekt bij op bestaande artikels, maakt nieuwe aan, onthoudt de keuzes (alles of niets)
  @Post('verwerken')
  verwerken(@Body() body: VerwerkInput, @Req() req: MetGebruiker) {
    return this.facturen.verwerken(body ?? { regels: [] }, req.user?.naam ?? null);
  }
}
