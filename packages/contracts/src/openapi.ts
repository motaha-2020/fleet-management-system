import { z } from "zod";
import { routes } from "./routes.js";

/** Generate an OpenAPI 3.1 document from the contract (Zod 4 → JSON Schema). */
export function buildOpenApi() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const [name, route] of Object.entries(routes)) {
    const p = route.path.replace(/:([a-zA-Z]+)/g, "{$1}");
    const params = [...route.path.matchAll(/:([a-zA-Z]+)/g)].map((m) => ({ name: m[1], in: "path", required: true, schema: { type: "string" } }));
    paths[p] ??= {};
    paths[p][route.method.toLowerCase()] = {
      operationId: name,
      summary: route.summary,
      ...(params.length ? { parameters: params } : {}),
      ...("public" in route && route.public ? { security: [] } : {}),
      ...("body" in route && route.body
        ? { requestBody: { required: true, content: { "application/json": { schema: z.toJSONSchema(route.body, { io: "input" }) } } } }
        : {}),
      responses: { "200": { description: "OK", content: { "application/json": { schema: z.toJSONSchema(route.response) } } } },
    };
  }
  return {
    openapi: "3.1.0",
    info: { title: "Fleet API", version: "0.1.0" },
    components: { securitySchemes: { bearer: { type: "http", scheme: "bearer" } } },
    security: [{ bearer: [] }],
    paths,
  };
}
