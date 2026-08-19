import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { StockService } from './stock.service';

@Controller('stock')
export class StockController {
  constructor(private readonly stock: StockService) {}

  // GET /stock?locatieId=...  -> voorraad op een locatie
  @Get()
  voorraad(@Query('locatieId') locatieId: string) {
    return this.stock.voorraadPerLocatie(locatieId);
  }

  // POST /stock/ontvangst  { productId, locatieId, aantal }  -> voorraad bijboeken
  @Post('ontvangst')
  ontvangst(@Body() body: { productId: string; locatieId: string; aantal: number }) {
    return this.stock.ontvangst(body);
  }

  // POST /stock/verplaats  -> voorraad tussen locaties verplaatsen
  @Post('verplaats')
  verplaats(
    @Body()
    body: {
      productId: string;
      vanLocatieId: string;
      naarLocatieId: string;
      aantal: number;
      gebruikerId?: string;
    },
  ) {
    return this.stock.verplaats(body);
  }
}
