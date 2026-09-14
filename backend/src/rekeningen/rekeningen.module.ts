import { Module } from '@nestjs/common';
import { RekeningenController } from './rekeningen.controller';
import { RekeningenService } from './rekeningen.service';
import { VerkoopfacturenModule } from '../verkoopfacturen/verkoopfacturen.module';

@Module({
  imports: [VerkoopfacturenModule], // "Factureren" = maandfactuur per bedrijf (-> Scrada concept)
  controllers: [RekeningenController],
  providers: [RekeningenService],
})
export class RekeningenModule {}
