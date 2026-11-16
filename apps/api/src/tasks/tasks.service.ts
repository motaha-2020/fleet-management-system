import { Injectable } from "@nestjs/common";
import { and, eq, isNull } from "drizzle-orm";
import { schema } from "@fleet/db";
import type { RequestContext } from "../auth/context.js";
import { conflict, forbidden, notFound, validation } from "../infra/errors.js";
import { TenantDb, type Tx } from "../fleet/tenant-db.js";
import { MeterService, type ReadingCapture } from "../m2/meter.service.js";
import { ApprovalService } from "../approvals/approval.service.js";
import { canAccessBranch } from "@fleet/domain";

const S = schema;
const T = S.tasks, L = S.taskLines, R = S.meterReadings;
type TaskRow = typeof T.$inferSelect;
const OPEN: TaskRow["status"][] = ["planned", "in_progress"];

/**
 * Starting and finishing a crew line, shared by the web/API (TasksController) and the driver app's offline sync
 * (task.line events, where the reading id is the event id so the meter photo can follow as an upload).
 */
@Injectable()
export class TasksService {
  constructor(private readonly meter: MeterService, private readonly approvals: ApprovalService) {}

  async loadForLine(tx: Tx, ctx: RequestContext, taskId: string, lineId: string) {
    const [t] = await tx.select().from(T).where(eq(T.id, taskId)).for("update");
    if (!t) throw notFound("task");
    if (ctx.role !== "driver") {
      const scope = ctx.permissions["task.write"];
      if (!scope || !canAccessBranch(ctx, scope, t.branchId)) throw notFound("task");
    }
    if (!OPEN.includes(t.status)) throw conflict("invalid_transition", `A ${t.status} task cannot be worked`);
    const [line] = await tx.select().from(L).where(and(eq(L.id, lineId), eq(L.taskId, taskId))).for("update");
    if (!line) throw notFound("line");
    if (ctx.role === "driver" && line.driverId !== ctx.driverId) throw forbidden("This is another driver's line");
    return { t, line };
  }

  /** Returns the task row after the event. */
  async lineEvent(tx: Tx, ctx: RequestContext, taskId: string, lineId: string, action: "start" | "finish", odometer: number, at: Date, capture: ReadingCapture | null, readingId?: string): Promise<TaskRow> {
    const { t, line } = await this.loadForLine(tx, ctx, taskId, lineId);
    const pending = await this.approvals.needsApproval(tx, ctx, "task");
    const record = () => this.meter.record(tx, {
      id: readingId, vehicleId: line.vehicleId, value: odometer, at, sourceType: "task", sourceId: line.id, createdBy: ctx.identityId, pending,
      ...(capture ? { capture } : {}),
    });
    if (action === "start") {
      if (line.startedAt) throw conflict("line_started", "This line has already started");
      const reading = await record();
      await tx.update(L).set({ startedAt: at, startReadingId: reading.id }).where(eq(L.id, line.id));
      const [row] = t.status === "planned" ? await tx.update(T).set({ status: "in_progress", startedAt: at, updatedAt: new Date() }).where(eq(T.id, taskId)).returning() : [t];
      await TenantDb.audit(tx, ctx, "task.line_started", "task", taskId, { lineId, odometer, at }, null, t.branchId);
      return row!;
    }
    if (!line.startedAt) throw conflict("line_not_started", "Start the line first");
    if (line.endedAt) throw conflict("line_ended", "This line has already ended");
    if (at < line.startedAt) throw validation({ at: "before_start" });
    const [start] = line.startReadingId ? await tx.select({ value: R.value }).from(R).where(eq(R.id, line.startReadingId)) : [];
    if (start && odometer < start.value) throw validation({ odometer: "below_start" });
    const reading = await record();
    await tx.update(L).set({ endedAt: at, endReason: "done", endReadingId: reading.id }).where(eq(L.id, line.id));
    let row: TaskRow = t;
    const open = await tx.select({ id: L.id }).from(L).where(and(eq(L.taskId, taskId), isNull(L.endedAt)));
    if (!open.length) {
      // Every line is finished: the task is done and waits for approval (or counts at once if tasks are automatic).
      const [u] = await tx.update(T).set({ status: pending ? "done" : "approved", finishedAt: at, updatedAt: new Date() }).where(eq(T.id, taskId)).returning();
      row = u!;
      if (!pending) await TasksService.approveReadings(tx, taskId, ctx.identityId);
    }
    await TenantDb.audit(tx, ctx, "task.line_finished", "task", taskId, { lineId, odometer, at, taskStatus: row.status }, null, t.branchId);
    return row;
  }

  static async approveReadings(tx: Tx, taskId: string, by: string) {
    const lines = await tx.select({ id: L.id }).from(L).where(eq(L.taskId, taskId));
    for (const l of lines) {
      await tx.update(R).set({ approvalStatus: "approved", decidedBy: by, decidedAt: new Date() })
        .where(and(eq(R.sourceType, "task"), eq(R.sourceId, l.id), eq(R.approvalStatus, "pending")));
    }
  }
}
