import { Module } from '@nestjs/common';
import { PushModule } from '../push/push.module';
import { VoorraadController } from './voorraad.controller';
import { VoorraadService } from './voorraad.service';

@Module({
  imports: [PushModule],
  controllers: [VoorraadController],
  providers: [VoorraadService],
  exports: [VoorraadService],
})
export class VoorraadModule {}
