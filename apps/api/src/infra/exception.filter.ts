import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from "@nestjs/common";
import type { Response } from "express";

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly log = new Logger("API");
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
    return res.status(500).json({ error: { code: "internal_error", message: "Something went wrong" } });
  }
}
