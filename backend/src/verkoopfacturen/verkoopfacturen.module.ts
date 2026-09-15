import { Module } from '@nestjs/common';
import { VerkoopfacturenController } from './verkoopfacturen.controller';
import { VerkoopfacturenService } from './verkoopfacturen.service';
import { ScradaModule } from '../scrada/scrada.module';
import { MailModule } from '../mail/mail.module';

// Verkoopfacturen uit de kassa -> Scrada (concept) + correctie in het dagontvangstenboek;
// rekeningen van particulieren -> per e-mail vanuit de kassa.
@Module({
  imports: [ScradaModule, MailModule],
  controllers: [VerkoopfacturenController],
  providers: [VerkoopfacturenService],
  exports: [VerkoopfacturenService],
})
export class VerkoopfacturenModule {}
