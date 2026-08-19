import { Module } from '@nestjs/common';
import { ScradaController } from './scrada.controller';
import { ScradaService } from './scrada.service';

@Module({
  controllers: [ScradaController],
  providers: [ScradaService],
})
export class ScradaModule {}
