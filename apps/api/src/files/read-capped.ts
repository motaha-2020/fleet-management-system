import { HttpStatus } from "@nestjs/common";
import type { Request } from "express";
import { AppError } from "../infra/errors.js";

/** Reads at most `max` bytes. Past the cap the rest is drained (not stored) so a clean 413 can be sent. */
export function readCapped(req: Request, max: number): Promise<Buffer> {
  const declared = Number(req.headers["content-length"] ?? 0);
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = declared > max;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > max) tooLarge = true;
      else if (!tooLarge) chunks.push(chunk);
    });
    req.on("end", () => (tooLarge
      ? reject(new AppError(HttpStatus.PAYLOAD_TOO_LARGE, "file_too_large", "Files must be 10 MB or smaller"))
      : resolve(Buffer.concat(chunks))));
    req.on("error", reject);
  });
}
