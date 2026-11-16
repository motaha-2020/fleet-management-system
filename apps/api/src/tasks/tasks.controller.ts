import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from "@nestjs/common";
import { and, asc, eq, gt, inArray, isNull, lt, ne, notInArray, or, sql } from "drizzle-orm";
import type { z } from "zod";
import { routes, type Task } from "@fleet/contracts";
import { schema, newId, type Db } from "@fleet/db";
import { branchFilter, canAccessBranch } from "@fleet/domain";
import { Ctx, Requires, type RequestContext } from "../auth/context.js";
import { ZodPipe } from "../infra/zod.pipe.js";
import { conflict, forbidden, notFound, validation } from "../infra/errors.js";
import { TenantDb, type Tx } from "../fleet/tenant-db.js";
import { MeterService } from "../m2/meter.service.js";
import { ApprovalService } from "../approvals/approval.service.js";
import { ReadinessService } from "../m4/readiness.service.js";
import { TasksService } from "./tasks.service.js";
import type { DbOrTx } from "../m2/common.js";

const S = schema;
const T = S.tasks, L = S.taskLines, R = S.meterReadings;
type TaskRow = typeof T.$inferSelect;
type LineRow = typeof L.$inferSelect;
const OPEN: TaskRow["status"][] = ["planned", "in_progress"];
const iso = (d: Date | null) => d?.toISOString() ?? null;

/**
 * Owner decisions (14 Nov 2026): the fleet manager makes a task for one customer — a trip or a period — with one or
 * more vehicles and drivers (crew lines). A breakdown or a driver change ends a line and opens a new one; the task and
 * its customer stay. Drivers start and finish their line with the odometer; once every line is finished the task is
 * done and waits for approval (unless the company made tasks automatic). No vehicle or driver works two overlapping
 * lines.
 */
@Controller()
export class TasksController {
  constructor(
    private readonly tdb: TenantDb,
    private readonly meter: MeterService,
    private readonly approvals: ApprovalService,
    private readonly readiness: ReadinessService,
    private readonly lines: TasksService,
  ) {}

  // ---------------------------------------------------------------- reading & shaping

  async dto(db: DbOrTx, rows: TaskRow[]): Promise<Task[]> {
    if (!rows.length) return [];
    const ids = rows.map((t) => t.id);
    const lines = await db.select().from(L).where(inArray(L.taskId, ids)).orderBy(asc(L.fromAt), asc(L.createdAt));
    const readingIds = lines.flatMap((l) => [l.startReadingId, l.endReadingId]).filter((x): x is string => !!x);
    const readings = readingIds.length ? await db.select({ id: R.id, value: R.value }).from(R).where(inArray(R.id, readingIds)) : [];
    const val = new Map(readings.map((r) => [r.id, r.value]));
    const customers = await db.select({ id: S.customers.id, name: S.customers.name }).from(S.customers).where(inArray(S.customers.id, [...new Set(rows.map((t) => t.customerId))]));
    const cName = new Map(customers.map((c) => [c.id, c.name]));
    return rows.map((t) => {
      const mine = lines.filter((l) => l.taskId === t.id);
      const shaped = mine.map((l) => {
        const s = l.startReadingId ? val.get(l.startReadingId) ?? null : null;
        const e = l.endReadingId ? val.get(l.endReadingId) ?? null : null;
        return {
          id: l.id, vehicleId: l.vehicleId, driverId: l.driverId, fromAt: l.fromAt.toISOString(), toAt: l.toAt.toISOString(),
          startReadingId: l.startReadingId, endReadingId: l.endReadingId,
          startedAt: iso(l.startedAt), endedAt: iso(l.endedAt), startOdometer: s, endOdometer: e, km: s != null && e != null && e >= s ? e - s : null,
          endReason: l.endReason, replacesLineId: l.replacesLineId, note: l.note,
        };
      });
      // Time without a working vehicle: from a line ending (breakdown, driver change) to its replacement starting.
      let downtime = 0;
      for (const n of mine.filter((l) => l.replacesLineId)) {
        const prev = mine.find((l) => l.id === n.replacesLineId);
        const end = prev?.endedAt;
        const start = n.startedAt;
        if (end && start && start > end) downtime += Math.round((start.getTime() - end.getTime()) / 60_000);
      }
      return {
        id: t.id, customerId: t.customerId, customerName: cName.get(t.customerId) ?? "—", branchId: t.branchId, kind: t.kind, title: t.title,
        fromPlace: t.fromPlace, toPlace: t.toPlace, startsAt: t.startsAt.toISOString(), endsAt: t.endsAt.toISOString(),
        dailyStart: t.dailyStart?.slice(0, 5) ?? null, dailyEnd: t.dailyEnd?.slice(0, 5) ?? null, notes: t.notes, status: t.status,
        startedAt: iso(t.startedAt), finishedAt: iso(t.finishedAt), decisionReason: t.decisionReason,
        lines: shaped, km: shaped.reduce((s, l) => s + (l.km ?? 0), 0), downtimeMinutes: downtime,
      };
    });
  }

  private async one(db: DbOrTx, ctx: RequestContext, id: string, lock = false): Promise<TaskRow> {
    const q = db.select().from(T).where(eq(T.id, id));
    const [t] = lock ? await q.for("update") : await q;
    if (!t) throw notFound("task");
    if (ctx.role === "driver") {
      const [mine] = await db.select({ id: L.id }).from(L).where(and(eq(L.taskId, id), eq(L.driverId, ctx.driverId ?? ""))).limit(1);
      if (!mine) throw notFound("task");
    } else {
      const scope = ctx.permissions["task.read"] ?? ctx.permissions["task.write"];
      if (!scope || !canAccessBranch(ctx, scope, t.branchId)) throw notFound("task");
    }
    return t;
  }

  private async show(db: DbOrTx, t: TaskRow) {
    return (await this.dto(db, [t]))[0]!;
  }

  /** Lines of other open tasks that overlap [from, to) for this vehicle or driver. */
  private async busy(db: DbOrTx, from: Date, to: Date, who: { vehicleId?: string; driverId?: string }, exceptLines: string[] = []) {
    const rows = await db.select({ l: L, status: T.status }).from(L).innerJoin(T, eq(T.id, L.taskId))
      .where(and(
        inArray(T.status, OPEN), isNull(L.endedAt), lt(L.fromAt, to), gt(L.toAt, from),
        or(who.vehicleId ? eq(L.vehicleId, who.vehicleId) : sql`false`, who.driverId ? eq(L.driverId, who.driverId) : sql`false`),
        exceptLines.length ? notInArray(L.id, exceptLines) : undefined,
      ));
    return rows.map((r) => r.l);
  }

  private async assertFree(db: DbOrTx, from: Date, to: Date, vehicleId: string, driverId: string, exceptLines: string[] = []) {
    const clash = await this.busy(db, from, to, { vehicleId, driverId }, exceptLines);
    if (clash.some((l) => l.vehicleId === vehicleId)) throw conflict("vehicle_busy", "The vehicle works on another task at that time", { vehicleId: "busy" });
    if (clash.some((l) => l.driverId === driverId)) throw conflict("driver_busy", "The driver works on another task at that time", { driverId: "busy" });
  }

  private async crewMember(db: DbOrTx, ctx: RequestContext, vehicleId: string, driverId: string) {
    const [v] = await db.select().from(S.vehicles).where(eq(S.vehicles.id, vehicleId));
    if (!v || v.status !== "active" || !canAccessBranch(ctx, ctx.permissions["task.write"]!, v.branchId)) throw validation({ vehicleId: "unknown_vehicle" });
    const [d] = await db.select().from(S.drivers).where(eq(S.drivers.id, driverId));
    if (!d || d.status !== "active" || d.employmentStatus !== "active") throw validation({ driverId: "unknown_driver" });
    return { v, d };
  }

  // ---------------------------------------------------------------- routes (static paths first)

  /** Who is free in a window, so a replacement can be picked quickly (restricted vehicles shown as such). */
  @Requires("task.write") @Get(routes.taskAvailability.path)
  async availability(@Query(new ZodPipe(routes.taskAvailability.query)) q: z.output<typeof routes.taskAvailability.query>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    const from = new Date(q.from), to = new Date(q.to);
    const filter = branchFilter(ctx, ctx.scope!);
    const vehicles = (await db.select().from(S.vehicles).where(eq(S.vehicles.status, "active"))).filter((v) => !filter || filter.includes(v.branchId));
    const drivers = (await db.select().from(S.drivers).where(and(eq(S.drivers.status, "active"), eq(S.drivers.employmentStatus, "active")))).filter((d) => !filter || filter.includes(d.branchId));
    const busy = (await db.select({ l: L }).from(L).innerJoin(T, eq(T.id, L.taskId))
      .where(and(inArray(T.status, OPEN), isNull(L.endedAt), lt(L.fromAt, to), gt(L.toAt, from), q.excludeTaskId ? ne(T.id, q.excludeTaskId) : undefined))).map((r) => r.l);
    const out = [];
    for (const v of vehicles) {
      const r = await this.readiness.evaluate(db, { vehicle: v }, from);
      out.push({ id: v.id, label: `${v.fleetNumber} · ${v.registrationNumber}`, busy: busy.some((l) => l.vehicleId === v.id), restricted: r.outcome === "restricted" });
    }
    return { vehicles: out, drivers: drivers.map((d) => ({ id: d.id, name: d.fullName, busy: busy.some((l) => l.driverId === d.id) })) };
  }

  @Requires("task.read") @Get(routes.listTasks.path)
  async list(@Query(new ZodPipe(routes.listTasks.query)) q: z.output<typeof routes.listTasks.query>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    const where = [];
    if (q.status) where.push(eq(T.status, q.status));
    if (q.customerId) where.push(eq(T.customerId, q.customerId));
    if (q.from) where.push(gt(T.endsAt, new Date(q.from)));
    if (q.to) where.push(lt(T.startsAt, new Date(q.to)));
    const lineWho = ctx.role === "driver" ? eq(L.driverId, ctx.driverId ?? "") : q.driverId ? eq(L.driverId, q.driverId) : q.vehicleId ? eq(L.vehicleId, q.vehicleId) : null;
    if (lineWho) where.push(inArray(T.id, db.select({ id: L.taskId }).from(L).where(lineWho)));
    let rows = await db.select().from(T).where(and(...where)).orderBy(asc(T.startsAt)).limit(500);
    if (ctx.role !== "driver") {
      const filter = branchFilter(ctx, ctx.scope!);
      if (filter) rows = rows.filter((t) => filter.includes(t.branchId));
    }
    return { items: await this.dto(db, rows) };
  }

  @Requires("task.read") @Get(routes.getTask.path)
  async get(@Param("id", ParseUUIDPipe) id: string, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    return this.show(db, await this.one(db, ctx, id));
  }

  @Requires("task.write") @Post(routes.createTask.path) @HttpCode(201)
  async create(@Body(new ZodPipe(routes.createTask.body)) b: z.output<typeof routes.createTask.body>, @Ctx() ctx: RequestContext) {
    const startsAt = new Date(b.startsAt), endsAt = new Date(b.endsAt);
    if (endsAt <= startsAt) throw validation({ endsAt: "before_start" });
    if (b.kind === "trip" && (!b.fromPlace || !b.toPlace)) throw validation({ [b.fromPlace ? "toPlace" : "fromPlace"]: "required" });
    if (!!b.dailyStart !== !!b.dailyEnd) throw validation({ dailyEnd: "required" });
    const db = await this.tdb.for(ctx);
    return db.transaction(async (tx) => {
      if (b.id) {
        const [existing] = await tx.select().from(T).where(eq(T.id, b.id));
        if (existing) return this.show(tx, existing);
      }
      const [c] = await tx.select().from(S.customers).where(eq(S.customers.id, b.customerId));
      if (!c || c.status !== "active") throw validation({ customerId: "unknown_customer" });
      const crew = [];
      for (const m of b.crew) crew.push(await this.crewMember(tx, ctx, m.vehicleId, m.driverId));
      const vehicles = new Set(b.crew.map((m) => m.vehicleId)), drivers = new Set(b.crew.map((m) => m.driverId));
      if (vehicles.size !== b.crew.length) throw validation({ crew: "vehicle_twice" });
      if (drivers.size !== b.crew.length) throw validation({ crew: "driver_twice" });
      for (const m of b.crew) await this.assertFree(tx, startsAt, endsAt, m.vehicleId, m.driverId);
      const id = b.id ?? newId();
      const [t] = await tx.insert(T).values({
        id, customerId: c.id, branchId: crew[0]!.v.branchId, kind: b.kind, title: b.title, fromPlace: b.fromPlace ?? null, toPlace: b.toPlace ?? null,
        startsAt, endsAt, dailyStart: b.dailyStart ?? null, dailyEnd: b.dailyEnd ?? null, notes: b.notes ?? null, createdBy: ctx.identityId,
      }).returning();
      await tx.insert(L).values(b.crew.map((m) => ({ id: newId(), taskId: id, vehicleId: m.vehicleId, driverId: m.driverId, fromAt: startsAt, toAt: endsAt, createdBy: ctx.identityId })));
      await TenantDb.audit(tx, ctx, "task.created", "task", id, { customerId: c.id, kind: b.kind, title: b.title, startsAt, endsAt, crew: b.crew }, null, t!.branchId);
      return this.show(tx, t!);
    });
  }

  @Requires("task.write") @Patch(routes.updateTask.path)
  async update(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(routes.updateTask.body)) b: z.output<typeof routes.updateTask.body>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    return db.transaction(async (tx) => {
      const t = await this.one(tx, ctx, id, true);
      if (t.status !== "planned") throw conflict("task_started", "Only a planned task can be changed");
      const startsAt = b.startsAt ? new Date(b.startsAt) : t.startsAt, endsAt = b.endsAt ? new Date(b.endsAt) : t.endsAt;
      if (endsAt <= startsAt) throw validation({ endsAt: "before_start" });
      const lines = await tx.select().from(L).where(eq(L.taskId, id));
      for (const l of lines) await this.assertFree(tx, startsAt, endsAt, l.vehicleId, l.driverId, lines.map((x) => x.id));
      const [row] = await tx.update(T).set({
        title: b.title ?? t.title, fromPlace: b.fromPlace !== undefined ? b.fromPlace : t.fromPlace, toPlace: b.toPlace !== undefined ? b.toPlace : t.toPlace,
        startsAt, endsAt, dailyStart: b.dailyStart !== undefined ? b.dailyStart : t.dailyStart, dailyEnd: b.dailyEnd !== undefined ? b.dailyEnd : t.dailyEnd,
        notes: b.notes !== undefined ? b.notes : t.notes, updatedAt: new Date(),
      }).where(eq(T.id, id)).returning();
      if (b.startsAt || b.endsAt) await tx.update(L).set({ fromAt: startsAt, toAt: endsAt }).where(eq(L.taskId, id));
      await TenantDb.audit(tx, ctx, "task.updated", "task", id, b, { title: t.title, startsAt: t.startsAt, endsAt: t.endsAt }, t.branchId);
      return this.show(tx, row!);
    });
  }

  @Requires("task.write") @Post(routes.cancelTask.path) @HttpCode(200)
  async cancel(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(routes.cancelTask.body)) b: z.output<typeof routes.cancelTask.body>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    return db.transaction(async (tx) => {
      const t = await this.one(tx, ctx, id, true);
      if (!OPEN.includes(t.status)) throw conflict("invalid_transition", `A ${t.status} task cannot be cancelled`);
      const now = new Date();
      await tx.update(L).set({ endedAt: now, endReason: "cancelled", note: b.reason }).where(and(eq(L.taskId, id), isNull(L.endedAt)));
      const [row] = await tx.update(T).set({ status: "cancelled", decisionReason: b.reason, updatedAt: now }).where(eq(T.id, id)).returning();
      await TenantDb.audit(tx, ctx, "task.cancelled", "task", id, { reason: b.reason }, { status: t.status }, t.branchId);
      return this.show(tx, row!);
    });
  }

  @Requires("task.write") @Post(routes.addTaskCrew.path) @HttpCode(200)
  async addCrew(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(routes.addTaskCrew.body)) b: z.output<typeof routes.addTaskCrew.body>, @Ctx() ctx: RequestContext) {
    const db = await this.tdb.for(ctx);
    return db.transaction(async (tx) => {
      const t = await this.one(tx, ctx, id, true);
      if (!OPEN.includes(t.status)) throw conflict("invalid_transition", `A ${t.status} task cannot get more crew`);
      await this.crewMember(tx, ctx, b.vehicleId, b.driverId);
      const fromAt = b.fromAt ? new Date(b.fromAt) : (t.startsAt > new Date() ? t.startsAt : new Date());
      if (fromAt >= t.endsAt) throw validation({ fromAt: "after_end" });
      await this.assertFree(tx, fromAt, t.endsAt, b.vehicleId, b.driverId);
      await tx.insert(L).values({ id: newId(), taskId: id, vehicleId: b.vehicleId, driverId: b.driverId, fromAt, toAt: t.endsAt, createdBy: ctx.identityId });
      await TenantDb.audit(tx, ctx, "task.crew_added", "task", id, { vehicleId: b.vehicleId, driverId: b.driverId, fromAt }, null, t.branchId);
      return this.show(tx, t);
    });
  }

  /**
   * Breakdown or driver change: the line ends now (with the odometer of the vehicle leaving, when given) and a new
   * line starts for the rest of the window. The task, its customer and its other lines do not change.
   */
  @Requires("task.write") @Post(routes.swapTaskCrew.path) @HttpCode(200)
  async swap(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(routes.swapTaskCrew.body)) b: z.output<typeof routes.swapTaskCrew.body>, @Ctx() ctx: RequestContext) {
    if (!b.vehicleId && !b.driverId) throw validation({ vehicleId: "required" });
    const db = await this.tdb.for(ctx);
    return db.transaction(async (tx) => {
      const t = await this.one(tx, ctx, id, true);
      if (!OPEN.includes(t.status)) throw conflict("invalid_transition", `A ${t.status} task cannot change crew`);
      const [line] = await tx.select().from(L).where(and(eq(L.id, b.lineId), eq(L.taskId, id))).for("update");
      if (!line) throw notFound("line");
      if (line.endedAt) throw conflict("line_ended", "This line has already ended");
      const at = b.at ? new Date(b.at) : new Date();
      if (at >= line.toAt) throw validation({ at: "after_end" });
      const vehicleId = b.vehicleId ?? line.vehicleId, driverId = b.driverId ?? line.driverId;
      if (vehicleId === line.vehicleId && driverId === line.driverId) throw validation({ vehicleId: "no_change" });
      await this.crewMember(tx, ctx, vehicleId, driverId);
      // The same driver (vehicle swap) or vehicle (driver swap) stays on the new line: only the newcomer must be free.
      await this.assertFree(tx, at, line.toAt, vehicleId, driverId, [line.id]);
      let endReadingId: string | null = null;
      if (b.odometer != null && line.startedAt) {
        const pending = await this.approvals.needsApproval(tx, ctx, "task");
        endReadingId = (await this.meter.record(tx, { vehicleId: line.vehicleId, value: b.odometer, at, sourceType: "task", sourceId: line.id, createdBy: ctx.identityId, pending })).id;
      }
      await tx.update(L).set({ endedAt: at, endReason: b.reason, endReadingId, note: b.note ?? line.note }).where(eq(L.id, line.id));
      await tx.insert(L).values({ id: newId(), taskId: id, vehicleId, driverId, fromAt: at, toAt: line.toAt, replacesLineId: line.id, note: b.note ?? null, createdBy: ctx.identityId });
      await TenantDb.audit(tx, ctx, "task.crew_swapped", "task", id, { lineId: line.id, reason: b.reason, vehicleId, driverId, at }, { vehicleId: line.vehicleId, driverId: line.driverId }, t.branchId);
      return this.show(tx, t);
    });
  }

  @Requires("task.drive", "task.write") @Post(routes.startTaskLine.path) @HttpCode(200)
  async start(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(routes.startTaskLine.body)) b: z.output<typeof routes.startTaskLine.body>, @Ctx() ctx: RequestContext) {
    return this.lineEvent(ctx, id, "start", b);
  }

  @Requires("task.drive", "task.write") @Post(routes.finishTaskLine.path) @HttpCode(200)
  async finish(@Param("id", ParseUUIDPipe) id: string, @Body(new ZodPipe(routes.finishTaskLine.body)) b: z.output<typeof routes.finishTaskLine.body>, @Ctx() ctx: RequestContext) {
    return this.lineEvent(ctx, id, "finish", b);
  }

  private async lineEvent(ctx: RequestContext, id: string, action: "start" | "finish", b: z.output<typeof routes.startTaskLine.body>) {
    const db = await this.tdb.for(ctx);
    return db.transaction(async (tx) => {
      const capture = b.location ? { location: b.location, locationStatus: "ok" as const } : null;
      const row = await this.lines.lineEvent(tx, ctx, id, b.lineId, action, b.odometer, b.at ? new Date(b.at) : new Date(), capture);
      return this.show(tx, row);
    });
  }

  static async approveReadings(tx: DbOrTx, taskId: string, by: string) {
    const lines = await tx.select({ id: L.id }).from(L).where(eq(L.taskId, taskId));
    if (!lines.length) return;
    await tx.update(R).set({ approvalStatus: "approved", decidedBy: by, decidedAt: new Date() })
      .where(and(eq(R.sourceType, "task"), inArray(R.sourceId, lines.map((l) => l.id)), eq(R.approvalStatus, "pending")));
  }

  static async rejectReadings(tx: DbOrTx, taskId: string, by: string, reason: string) {
    const lines = await tx.select({ id: L.id }).from(L).where(eq(L.taskId, taskId));
    if (!lines.length) return;
    await tx.update(R).set({ approvalStatus: "rejected", decidedBy: by, decidedAt: new Date(), decisionReason: reason })
      .where(and(eq(R.sourceType, "task"), inArray(R.sourceId, lines.map((l) => l.id)), eq(R.approvalStatus, "pending")));
  }

  /** The identity of the driver of the task's last line: the task is "recorded" by its drivers for approval rules. */
  static async lastDriverIdentity(db: Db | Tx, taskId: string) {
    const [l] = await db.select({ identityId: S.drivers.identityId }).from(L).innerJoin(S.drivers, eq(S.drivers.id, L.driverId))
      .where(eq(L.taskId, taskId)).orderBy(sql`${L.endedAt} DESC NULLS LAST`).limit(1);
    return l?.identityId ?? null;
  }
}

