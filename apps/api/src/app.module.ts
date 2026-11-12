import { Module, type DynamicModule } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import type { AppConfig } from "./config.js";
import { InfraModule, type JobQueue } from "./infra/infra.module.js";
import { ApiExceptionFilter } from "./infra/exception.filter.js";
import { AuthGuard } from "./auth/auth.guard.js";
import { AuthService } from "./auth/auth.service.js";
import { TokenService } from "./auth/token.service.js";
import { AuthController } from "./auth/auth.controller.js";
import { TenantsController } from "./platform/tenants.controller.js";
import { TenantDb } from "./fleet/tenant-db.js";
import { BranchesController } from "./fleet/branches.controller.js";
import { VehiclesController } from "./fleet/vehicles.controller.js";
import { DriversController } from "./fleet/drivers.controller.js";
import { HealthController } from "./health.controller.js";

@Module({})
export class AppModule {
  static forRoot(config: AppConfig, overrides: { queue?: JobQueue } = {}): DynamicModule {
    return {
      module: AppModule,
      imports: [InfraModule.forRoot(config, overrides)],
      controllers: [HealthController, AuthController, TenantsController, BranchesController, VehiclesController, DriversController],
      providers: [
        TokenService,
        AuthService,
        TenantDb,
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
      ],
    };
  }
}
