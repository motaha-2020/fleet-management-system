import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Injectable, Logger } from "@nestjs/common";
import type { Request, Response } from "express";
import { OpsLog } from "./ops-log.js";

@Catch()
@Injectable()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly log = new Logger("API");
  constructor(private readonly ops: OpsLog) {}
  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      const status = exception.getStatus();
      if (typeof body === "object" && body && "error" in body) return res.status(status).json(body);
      const message = typeof body === "string" ? body : ((body as { message?: string }).message ?? exception.message);
      return res.status(status).json({ error: { code: status === 404 ? "not_found" : "http_error", message: String(message) } });
    }
    this.log.error(exception instanceof Error ? exception.stack : String(exception));
    const req = host.switchToHttp().getRequest<Request & { ctx?: { tenantId: string | null } }>();
    void this.ops.record({ tenantId: req.ctx?.tenantId ?? null, kind: "api_error", severity: "error", code: exception instanceof Error ? exception.name : "unknown",
      detail: { method: req.method, path: req.path, message: exception instanceof Error ? exception.message.slice(0, 300) : String(exception).slice(0, 300) } });
    return res.status(500).json({ error: { code: "internal_error", message: "Something went wrong" } });
  }
}
