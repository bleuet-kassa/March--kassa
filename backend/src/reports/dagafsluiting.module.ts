import { Module } from '@nestjs/common';
import { DagafsluitingController } from './dagafsluiting.controller';
import { DagafsluitingService } from './dagafsluiting.service';
import { RapportenController } from './rapporten.controller';
import { RapportenService } from './rapporten.service';
import { PushModule } from '../push/push.module';
import { ScradaModule } from '../scrada/scrada.module';

@Module({
  imports: [PushModule, ScradaModule], // pushmelding bij een afsluit-aanvraag; Scrada-versturen bevestigen op de telefoon
  controllers: [DagafsluitingController, RapportenController],
  providers: [DagafsluitingService, RapportenService],
})
export class DagafsluitingModule {}
