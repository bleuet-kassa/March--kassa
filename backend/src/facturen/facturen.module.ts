import { Module } from '@nestjs/common';
import { FacturenController } from './facturen.controller';
import { FacturenService } from './facturen.service';
import { ProductsModule } from '../products/products.module';

@Module({
  imports: [ProductsModule],
  controllers: [FacturenController],
  providers: [FacturenService],
})
export class FacturenModule {}
