import { Module } from '@nestjs/common';
import { PersoneelController } from './personeel.controller';
import { PersoneelService } from './personeel.service';

// Personeelsdossier per medewerker (individuele pagina, voorlopig enkel beheerder).
@Module({
  controllers: [PersoneelController],
  providers: [PersoneelService],
})
export class PersoneelModule {}
