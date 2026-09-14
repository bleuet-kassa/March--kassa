import { Module } from '@nestjs/common';
import { VerkoopfacturenController } from './verkoopfacturen.controller';
import { VerkoopfacturenService } from './verkoopfacturen.service';
import { ScradaModule } from '../scrada/scrada.module';

// Verkoopfacturen uit de kassa -> Scrada (concept) + correctie in het dagontvangstenboek.
@Module({
  imports: [ScradaModule],
  controllers: [VerkoopfacturenController],
  providers: [VerkoopfacturenService],
  exports: [VerkoopfacturenService],
})
export class VerkoopfacturenModule {}
