import { Module } from '@nestjs/common';
import { FacturenController } from './facturen.controller';
import { FacturenService } from './facturen.service';
import { ProductsModule } from '../products/products.module';
import { StockModule } from '../stock/stock.module';

@Module({
  imports: [ProductsModule, StockModule],
  controllers: [FacturenController],
  providers: [FacturenService],
})
export class FacturenModule {}
