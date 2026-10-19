import { Module } from '@nestjs/common';
import { PlanningController } from './planning.controller';
import { PlanningService } from './planning.service';

// Uurroosters: planning maken (toegang "planning") en "Mijn rooster" voor elke medewerker.
@Module({
  controllers: [PlanningController],
  providers: [PlanningService],
})
export class PlanningModule {}
