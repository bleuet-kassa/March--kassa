import { Module } from '@nestjs/common';
import { CadeaubonnenController } from './cadeaubonnen.controller';
import { CadeaubonnenService } from './cadeaubonnen.service';

@Module({
  controllers: [CadeaubonnenController],
  providers: [CadeaubonnenService],
})
export class CadeaubonnenModule {}
