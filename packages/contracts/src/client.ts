import type { z } from "zod";
import { routes, type Routes, type RouteName } from "./routes.js";
import type { ApiError } from "./schemas.js";

type BodyOf<R> = R extends { body: infer B extends z.ZodTypeAny } ? z.input<B> : undefined;
type ResponseOf<R> = R extends { response: infer S extends z.ZodTypeAny } ? z.output<S> : never;
type ParamsOf<P extends string> = P extends `${string}:${infer K}/${infer Rest}`
  ? { [k in K]: string } & ParamsOf<`/${Rest}`>
  : P extends `${string}:${infer K}`
    ? { [k in K]: string }
    : {};

export type CallArgs<N extends RouteName> = (Routes[N] extends { body: z.ZodTypeAny } ? { body: BodyOf<Routes[N]> } : { body?: undefined }) &
  (Routes[N]["path"] extends `${string}:${string}` ? { params: ParamsOf<Routes[N]["path"]> } : { params?: undefined });

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: ApiError | null,
  ) {
    super(body?.error.message ?? `HTTP ${status}`);
  }
  get code() { return this.body?.error.code ?? "http_error"; }
  get fields() { return this.body?.error.fields ?? {}; }
}

export interface ClientOptions {
  baseUrl: string;
  getAccessToken?: () => string | null | undefined;
  /** Called once on 401; return a new access token to retry, or null to give up. */
  onUnauthorized?: () => Promise<string | null>;
  fetch?: typeof fetch;
  credentials?: RequestCredentials;
}

export function buildPath(path: string, params?: Record<string, string>): string {
  return path.replace(/:([a-zA-Z]+)/g, (_, k: string) => {
    const v = params?.[k];
    if (v === undefined) throw new Error(`missing path param ${k}`);
    return encodeURIComponent(v);
  });
}

export function createClient(opts: ClientOptions) {
  const f = opts.fetch ?? fetch;
  async function call<N extends RouteName>(name: N, ...args: Routes[N] extends { body: z.ZodTypeAny } ? [CallArgs<N>] : Routes[N]["path"] extends `${string}:${string}` ? [CallArgs<N>] : [CallArgs<N>?]): Promise<ResponseOf<Routes[N]>> {
    const route = routes[name];
    const a = (args[0] ?? {}) as { body?: unknown; params?: Record<string, string> };
    const url = opts.baseUrl.replace(/\/$/, "") + buildPath(route.path, a.params);
    const send = async (token: string | null | undefined) => {
      const headers: Record<string, string> = { accept: "application/json" };
      if (a.body !== undefined) headers["content-type"] = "application/json";
      if (token) headers.authorization = `Bearer ${token}`;
      return f(url, {
        method: route.method,
        headers,
        body: a.body !== undefined ? JSON.stringify(a.body) : undefined,
        credentials: opts.credentials,
      });
    };
    let res = await send(opts.getAccessToken?.());
    if (res.status === 401 && !("public" in route && route.public) && opts.onUnauthorized) {
      const fresh = await opts.onUnauthorized();
      if (fresh) res = await send(fresh);
    }
    const text = await res.text();
    const json: unknown = text ? JSON.parse(text) : null;
    if (!res.ok) throw new ApiRequestError(res.status, (json as ApiError) ?? null);
    return json as ResponseOf<Routes[N]>;
  }
  return { call };
}
export type ApiClient = ReturnType<typeof createClient>;
