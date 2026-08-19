import { Module } from '@nestjs/common';
import { KortingenController } from './kortingen.controller';
import { KortingenService } from './kortingen.service';

@Module({
  controllers: [KortingenController],
  providers: [KortingenService],
})
export class KortingenModule {}
