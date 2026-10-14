import { Module } from '@nestjs/common';
import { SpreukenController } from './spreuken.controller';
import { SpreukenService } from './spreuken.service';

// Spreuk van de dag op het startscherm van de kassa (wekelijks automatisch aangevuld).
@Module({
  controllers: [SpreukenController],
  providers: [SpreukenService],
})
export class SpreukenModule {}
