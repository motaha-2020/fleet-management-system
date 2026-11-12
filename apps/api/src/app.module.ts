import { Module, type DynamicModule } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import type { AppConfig } from "./config.js";
import { InfraModule, type JobQueue } from "./infra/infra.module.js";
import type { ObjectStorage } from "./files/storage.js";
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
import { UsersController } from "./users/users.controller.js";
import { VendorsController } from "./fleet/vendors.controller.js";
import { DocumentsController } from "./documents/documents.controller.js";
import { AuditController } from "./audit/audit.controller.js";
import { TenantKeys } from "./infra/tenant-keys.js";

@Module({})
export class AppModule {
  static forRoot(config: AppConfig, overrides: { queue?: JobQueue; storage?: ObjectStorage } = {}): DynamicModule {
    return {
      module: AppModule,
      imports: [InfraModule.forRoot(config, overrides)],
      controllers: [
        HealthController, AuthController, TenantsController, UsersController, BranchesController, VendorsController,
        VehiclesController, DriversController, DocumentsController, AuditController,
      ],
      providers: [
        TenantKeys,
        TokenService,
        AuthService,
        TenantDb,
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
      ],
    };
  }
}
