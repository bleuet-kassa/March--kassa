import { Module } from '@nestjs/common';
import { ScradaController } from './scrada.controller';
import { ScradaService } from './scrada.service';
import { ScradaSync } from './scrada.sync';
import { ScradaDagboekService } from './scrada.dagboek.service';
import { PushModule } from '../push/push.module';

@Module({
  imports: [PushModule], // herinnering om 23:59 via pushmelding naar de beheerder
  controllers: [ScradaController],
  // ScradaDagboekService = dagontvangstenboek (per afgesloten dag); ScradaSync = herinnering om 23:59
  providers: [ScradaService, ScradaDagboekService, ScradaSync],
  exports: [ScradaService, ScradaDagboekService], // gebruikt door de dagafsluiting (bevestigen op de telefoon)
})
export class ScradaModule {}
