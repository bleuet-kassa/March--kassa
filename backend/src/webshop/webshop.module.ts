import { Module } from '@nestjs/common';
import { WebshopController } from './webshop.controller';
import { WebshopService } from './webshop.service';
import { MollieService } from './mollie.service';
import { LeveringService } from './levering.service';
import { FiltersService } from './filters.service';
import { LivegangService } from './livegang.service';
import { SalesModule } from '../sales/sales.module';
import { AgendaModule } from '../agenda/agenda.module';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [SalesModule, AgendaModule, MailModule], // bestellingen komen automatisch in de agenda; bevestiging per mail
  controllers: [WebshopController],
  providers: [WebshopService, MollieService, LeveringService, FiltersService, LivegangService],
})
export class WebshopModule {}
