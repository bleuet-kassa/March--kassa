import { Module } from '@nestjs/common';
import { ScradaController } from './scrada.controller';
import { ScradaService } from './scrada.service';
import { ScradaSync } from './scrada.sync';
import { ScradaDagboekService } from './scrada.dagboek.service';

@Module({
  controllers: [ScradaController],
  // ScradaDagboekService = dagontvangstenboek (per afgesloten dag); ScradaSync = dagelijks om 23:59
  providers: [ScradaService, ScradaDagboekService, ScradaSync],
})
export class ScradaModule {}
