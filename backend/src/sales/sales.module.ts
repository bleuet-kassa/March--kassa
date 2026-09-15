import { Module } from '@nestjs/common';
import { SalesController } from './sales.controller';
import { SalesService } from './sales.service';
import { VerkoopfacturenModule } from '../verkoopfacturen/verkoopfacturen.module';

@Module({
  imports: [VerkoopfacturenModule], // factuur meteen aanmaken bij "Factuur" aan de kassa
  controllers: [SalesController],
  providers: [SalesService],
  exports: [SalesService],
})
export class SalesModule {}
