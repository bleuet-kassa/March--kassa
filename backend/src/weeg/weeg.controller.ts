import { Body, Controller, Post } from '@nestjs/common';
import { WeegService } from './weeg.service';

@Controller('weeg')
export class WeegController {
  constructor(private readonly weeg: WeegService) {}

  // POST /weeg/etiket { productId, gewicht }  -> etiketgegevens + barcode + ZPL
  @Post('etiket')
  etiket(@Body() body: { productId: string; gewicht: number }) {
    return this.weeg.etiket(body.productId, body.gewicht);
  }
}
