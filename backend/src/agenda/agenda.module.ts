import { Module } from '@nestjs/common';
import { AgendaController } from './agenda.controller';
import { AgendaService } from './agenda.service';
import { SalesModule } from '../sales/sales.module';

// Agenda van de zaak (manuele bestellingen/agendapunten + webshopbestellingen).
@Module({
  imports: [SalesModule], // een webshopbestelling annuleren boekt de stock terug
  controllers: [AgendaController],
  providers: [AgendaService],
  exports: [AgendaService],
})
export class AgendaModule {}
