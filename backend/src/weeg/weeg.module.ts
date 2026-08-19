import { Module } from '@nestjs/common';
import { WeegController } from './weeg.controller';
import { WeegService } from './weeg.service';

@Module({
  controllers: [WeegController],
  providers: [WeegService],
})
export class WeegModule {}
