import { Module } from '@nestjs/common';
import { WebshopController } from './webshop.controller';
import { WebshopService } from './webshop.service';
import { SalesModule } from '../sales/sales.module';
import { AgendaModule } from '../agenda/agenda.module';

@Module({
  imports: [SalesModule, AgendaModule], // bestellingen komen automatisch in de agenda
  controllers: [WebshopController],
  providers: [WebshopService],
})
export class WebshopModule {}
