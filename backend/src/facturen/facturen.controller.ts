import {
  Body,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { FacturenService, VerwerkRegel } from './facturen.service';

@Controller('facturen')
export class FacturenController {
  constructor(private readonly facturen: FacturenService) {}

  // POST /facturen/inlezen  (multipart: veld "file" = PDF)
  // -> herkende regels ter controle (voegt nog niets toe)
  @Post('inlezen')
  @UseInterceptors(FileInterceptor('file'))
  inlezen(@UploadedFile() file: { buffer: Buffer; mimetype: string } | undefined) {
    if (!file) throw new BadRequestException('Geen bestand ontvangen.');
    return this.facturen.inlezen(file.buffer);
  }

  // POST /facturen/verwerken  { regels, locatieId }  -> maakt producten + boekt voorraad
  @Post('verwerken')
  verwerken(@Body() body: { regels: VerwerkRegel[]; locatieId: string }) {
    return this.facturen.verwerken(body.regels, body.locatieId);
  }
}
