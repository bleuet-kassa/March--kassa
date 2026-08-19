import { Module } from '@nestjs/common';
import { WebshopController } from './webshop.controller';
import { WebshopService } from './webshop.service';
import { SalesModule } from '../sales/sales.module';

@Module({
  imports: [SalesModule],
  controllers: [WebshopController],
  providers: [WebshopService],
})
export class WebshopModule {}
