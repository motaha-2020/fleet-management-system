import { Inject, Injectable, Logger } from "@nestjs/common";
import { schema, type Db } from "@fleet/db";
type OpsKind = schema.OpsKind;
import { CONTROL_DB } from "./tokens.js";

/**
 * NFR-008: one place where operational failures are recorded, with the tenant and the reason. Each event is
 * also a structured JSON log line (`ops=`), so log-based alerting works without querying the database.
 * Recording never breaks the operation that failed.
 */
@Injectable()
export class OpsLog {
  private readonly log = new Logger("ops");
  constructor(@Inject(CONTROL_DB) private readonly db: Db) {}

  async record(e: { tenantId: string | null; kind: OpsKind; severity: "info" | "warning" | "error" | "critical"; code: string; detail?: Record<string, unknown> }) {
    const line = JSON.stringify({ ops: e.kind, severity: e.severity, tenant: e.tenantId, code: e.code, ...e.detail });
    if (e.severity === "error" || e.severity === "critical") this.log.error(line); else this.log.warn(line);
    try {
      await this.db.insert(schema.opsEvents).values({ tenantId: e.tenantId, kind: e.kind, severity: e.severity, code: e.code.slice(0, 120), detail: e.detail ?? {} });
    } catch (err) {
      this.log.error(`could not record ops event: ${(err as Error).message}`);
    }
  }
}
