import { Module } from '@nestjs/common';
import { DagafsluitingController } from './dagafsluiting.controller';
import { DagafsluitingService } from './dagafsluiting.service';
import { RapportenController } from './rapporten.controller';
import { RapportenService } from './rapporten.service';
import { PushModule } from '../push/push.module';
import { ScradaModule } from '../scrada/scrada.module';
import { VerkoopfacturenModule } from '../verkoopfacturen/verkoopfacturen.module';

@Module({
  // pushmelding bij een afsluit-aanvraag; Scrada-versturen (dag + facturen) bevestigen op de telefoon
  imports: [PushModule, ScradaModule, VerkoopfacturenModule],
  controllers: [DagafsluitingController, RapportenController],
  providers: [DagafsluitingService, RapportenService],
})
export class DagafsluitingModule {}
