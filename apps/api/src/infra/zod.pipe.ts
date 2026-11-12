import { PipeTransform } from "@nestjs/common";
import type { z } from "zod";
import { validation } from "./errors.js";

export class ZodPipe<T extends z.ZodTypeAny> implements PipeTransform<unknown, z.output<T>> {
  constructor(private readonly schema: T) {}
  transform(value: unknown): z.output<T> {
    const r = this.schema.safeParse(value ?? {});
    if (r.success) return r.data;
    const fields: Record<string, string> = {};
    for (const issue of r.error.issues) {
      const key = issue.path.join(".") || "_";
      fields[key] ??= issue.message;
    }
    throw validation(fields);
  }
}
