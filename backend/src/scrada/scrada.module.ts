import { Module } from '@nestjs/common';
import { ScradaController } from './scrada.controller';
import { ScradaService } from './scrada.service';
import { ScradaSync } from './scrada.sync';

@Module({
  controllers: [ScradaController],
  providers: [ScradaService, ScradaSync], // ScradaSync = dagelijkse automatische synchronisatie om 23:59
})
export class ScradaModule {}
