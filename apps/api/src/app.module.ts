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
import { AssignmentsController } from "./m2/assignments.controller.js";
import { OdometerController } from "./m2/odometer.controller.js";
import { FuelController } from "./m2/fuel.controller.js";
import { CostsController } from "./m2/costs.controller.js";
import { CorrectionsController } from "./m2/corrections.controller.js";
import { FuelPricesController } from "./platform/fuel-prices.controller.js";
import { MeterService } from "./m2/meter.service.js";
import { FuelService } from "./m2/fuel.service.js";
import { SyncController } from "./m3/sync.controller.js";
import { SyncService } from "./m3/sync.service.js";
import { UploadsController } from "./m3/uploads.controller.js";
import { FuelRecalc } from "./m2/fuel-recalc.service.js";
import { MaintenanceService } from "./m4/maintenance.service.js";
import { ReadinessService } from "./m4/readiness.service.js";
import { DefectService } from "./m4/defect.service.js";
import { MaintenanceController } from "./m4/maintenance.controller.js";
import { WorkController } from "./m4/work.controller.js";
import { ReadinessController } from "./m4/readiness.controller.js";

@Module({})
export class AppModule {
  static forRoot(config: AppConfig, overrides: { queue?: JobQueue; storage?: ObjectStorage } = {}): DynamicModule {
    return {
      module: AppModule,
      imports: [InfraModule.forRoot(config, overrides)],
      controllers: [
        HealthController, AuthController, TenantsController, UsersController, BranchesController, VendorsController,
        VehiclesController, DriversController, DocumentsController, AuditController,
        AssignmentsController, OdometerController, FuelController, CostsController, CorrectionsController, FuelPricesController, SyncController, UploadsController,
        MaintenanceController, WorkController, ReadinessController,
      ],
      providers: [
        TenantKeys,
        MeterService, FuelService, SyncService, MaintenanceService, ReadinessService, DefectService,
        FuelRecalc,
        TokenService,
        AuthService,
        TenantDb,
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
      ],
    };
  }
}
