import { Module } from '@nestjs/common';
import { DagafsluitingController } from './dagafsluiting.controller';
import { DagafsluitingService } from './dagafsluiting.service';
import { RapportenController } from './rapporten.controller';
import { RapportenService } from './rapporten.service';
import { PushModule } from '../push/push.module';

@Module({
  imports: [PushModule], // pushmelding naar de beheerder bij een afsluit-aanvraag
  controllers: [DagafsluitingController, RapportenController],
  providers: [DagafsluitingService, RapportenService],
})
export class DagafsluitingModule {}
