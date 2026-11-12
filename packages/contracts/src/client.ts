import type { z } from "zod";
import { routes, type Routes, type RouteName } from "./routes.js";
import type { ApiError } from "./schemas.js";

type BodyOf<R> = R extends { body: infer B extends z.ZodTypeAny } ? z.input<B> : undefined;
type QueryOf<R> = R extends { query: infer Q extends z.ZodTypeAny } ? z.input<Q> : undefined;
type ResponseOf<R> = R extends { response: infer S extends z.ZodTypeAny } ? z.output<S> : never;
type ParamsOf<P extends string> = P extends `${string}:${infer K}/${infer Rest}`
  ? { [k in K]: string } & ParamsOf<`/${Rest}`>
  : P extends `${string}:${infer K}`
    ? { [k in K]: string }
    : {};

type HasParams<N extends RouteName> = Routes[N]["path"] extends `${string}:${string}` ? true : false;
type HasBody<N extends RouteName> = Routes[N] extends { body: z.ZodTypeAny } ? true : false;

export type CallArgs<N extends RouteName> = (HasBody<N> extends true ? { body: BodyOf<Routes[N]> } : { body?: undefined }) &
  (HasParams<N> extends true ? { params: ParamsOf<Routes[N]["path"]> } : { params?: undefined }) &
  (Routes[N] extends { query: z.ZodTypeAny } ? { query?: QueryOf<Routes[N]> } : { query?: undefined });

type ArgsTuple<N extends RouteName> = HasBody<N> extends true ? [CallArgs<N>] : HasParams<N> extends true ? [CallArgs<N>] : [CallArgs<N>?];

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

export function buildQuery(query?: Record<string, unknown>): string {
  if (!query) return "";
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  const s = q.toString();
  return s ? `?${s}` : "";
}

export function createClient(opts: ClientOptions) {
  const f = opts.fetch ?? fetch;

  async function send(name: RouteName, a: { params?: Record<string, string>; query?: Record<string, unknown> }, init: { body?: BodyInit; headers?: Record<string, string> }) {
    const route = routes[name];
    const url = opts.baseUrl.replace(/\/$/, "") + buildPath(route.path, a.params) + buildQuery(a.query);
    const go = (token: string | null | undefined) =>
      f(url, {
        method: route.method,
        headers: { accept: "application/json", ...init.headers, ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: init.body,
        credentials: opts.credentials,
      });
    let res = await go(opts.getAccessToken?.());
    if (res.status === 401 && !("public" in route && route.public) && opts.onUnauthorized) {
      const fresh = await opts.onUnauthorized();
      if (fresh) res = await go(fresh);
    }
    return res;
  }

  async function fail(res: Response): Promise<never> {
    const text = await res.text();
    let body: ApiError | null = null;
    try { body = text ? (JSON.parse(text) as ApiError) : null; } catch { body = null; }
    throw new ApiRequestError(res.status, body);
  }

  async function call<N extends RouteName>(name: N, ...args: ArgsTuple<N>): Promise<ResponseOf<Routes[N]>> {
    const a = (args[0] ?? {}) as { body?: unknown; params?: Record<string, string>; query?: Record<string, unknown> };
    const res = await send(name, a, a.body !== undefined ? { body: JSON.stringify(a.body), headers: { "content-type": "application/json" } } : {});
    if (!res.ok) return fail(res);
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as ResponseOf<Routes[N]>;
  }

  /** Binary routes: upload a file body, or download and get the raw Response. */
  async function upload<N extends RouteName>(name: N, params: Record<string, string>, file: Blob, fileName: string): Promise<ResponseOf<Routes[N]>> {
    const res = await send(name, { params }, {
      body: file,
      headers: { "content-type": file.type || "application/octet-stream", "x-file-name": encodeURIComponent(fileName) },
    });
    if (!res.ok) return fail(res);
    return (await res.json()) as ResponseOf<Routes[N]>;
  }
  async function download(name: RouteName, params: Record<string, string>): Promise<Response> {
    const res = await send(name, { params }, {});
    if (!res.ok) return fail(res);
    return res;
  }

  return { call, upload, download };
}
export type ApiClient = ReturnType<typeof createClient>;
