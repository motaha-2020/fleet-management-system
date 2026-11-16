import { HttpStatus, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { schema } from "@fleet/db";
import { canAccessBranch } from "@fleet/domain";
import type { RequestContext } from "../auth/context.js";
import { AppError, forbidden } from "../infra/errors.js";
import type { DbOrTx } from "../m2/common.js";

export const APPROVAL_TYPES = ["odometer", "fuel", "cost", "maintenance"] as const;
export type ApprovalType = (typeof APPROVAL_TYPES)[number];

/**
 * Owner decision (14 Nov 2026): odometer readings, fuel entries, costs/invoices and maintenance count only after
 * approval.
 *  - Required by default; the company admin can make a type automatic (approval_settings).
 *  - What the company admin records is approved at once: nobody above them would approve it.
 *  - Drivers' records are approved by the fleet manager of the branch (approval.decide) or the company admin.
 *  - What office staff record (e.g. the fleet manager) is approved by the company admin.
 *  - Never by the person who recorded it (GEN-004).
 */
@Injectable()
export class ApprovalService {
  async mode(db: DbOrTx, type: ApprovalType): Promise<"manual" | "auto"> {
    const [s] = await db.select().from(schema.approvalSettings).where(eq(schema.approvalSettings.type, type));
    return s?.mode ?? "manual";
  }

  /** Does a record of this type, made by this person now, wait for approval? */
  async needsApproval(db: DbOrTx, ctx: RequestContext, type: ApprovalType): Promise<boolean> {
    if (ctx.role === "company_admin") return false;
    return (await this.mode(db, type)) === "manual";
  }

  async isDriver(db: DbOrTx, identityId: string): Promise<boolean> {
    const [d] = await db.select({ id: schema.drivers.id }).from(schema.drivers).where(eq(schema.drivers.identityId, identityId)).limit(1);
    return !!d;
  }

  /** Throws unless this person may approve or reject a record made by `createdBy` in `branchId`. */
  async assertDecider(db: DbOrTx, ctx: RequestContext, item: { createdBy: string; branchId: string }) {
    const scope = ctx.permissions["approval.decide"];
    if (!scope || !canAccessBranch(ctx, scope, item.branchId)) throw forbidden();
    if (item.createdBy === ctx.identityId) throw new AppError(HttpStatus.FORBIDDEN, "maker_checker", "You cannot approve a record you created");
    if (ctx.role !== "company_admin" && !(await this.isDriver(db, item.createdBy))) {
      throw new AppError(HttpStatus.FORBIDDEN, "admin_approval_required", "Records made by office staff are approved by the company admin");
    }
  }

  /** Can this person decide it (for the inbox: shows the buttons only where they work)? */
  async canDecide(db: DbOrTx, ctx: RequestContext, item: { createdBy: string; branchId: string }, driverMade?: boolean): Promise<boolean> {
    const scope = ctx.permissions["approval.decide"];
    if (!scope || !canAccessBranch(ctx, scope, item.branchId) || item.createdBy === ctx.identityId) return false;
    return ctx.role === "company_admin" || (driverMade ?? (await this.isDriver(db, item.createdBy)));
  }

  async setMode(db: DbOrTx, ctx: RequestContext, type: ApprovalType, mode: "manual" | "auto") {
    const S = schema.approvalSettings;
    await db.insert(S).values({ type, mode, updatedBy: ctx.identityId }).onConflictDoUpdate({ target: S.type, set: { mode, updatedBy: ctx.identityId, updatedAt: new Date() } });
  }

  async all(db: DbOrTx) {
    const rows = await db.select().from(schema.approvalSettings);
    return APPROVAL_TYPES.map((type) => ({ type, mode: rows.find((r) => r.type === type)?.mode ?? ("manual" as const) }));
  }
}

