import { Module } from '@nestjs/common';
import { DagafsluitingController } from './dagafsluiting.controller';
import { DagafsluitingService } from './dagafsluiting.service';
import { RapportenController } from './rapporten.controller';
import { RapportenService } from './rapporten.service';

@Module({
  controllers: [DagafsluitingController, RapportenController],
  providers: [DagafsluitingService, RapportenService],
})
export class DagafsluitingModule {}
