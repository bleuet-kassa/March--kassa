import { Module } from '@nestjs/common';
import { RekeningenController } from './rekeningen.controller';
import { RekeningenService } from './rekeningen.service';

@Module({
  controllers: [RekeningenController],
  providers: [RekeningenService],
})
export class RekeningenModule {}
