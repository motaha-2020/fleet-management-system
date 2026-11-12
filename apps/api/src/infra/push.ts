/** One push message to one Expo push token. */
export interface PushMessage { to: string; title: string; body: string; data?: Record<string, unknown> }
/** Per-message outcome: ok (with the provider's ticket id), or an error; `unregistered` = drop this token. */
export type PushResult = { ok: true; id: string | null } | { ok: false; error: string; unregistered: boolean };
/** NTF-001 mobile push channel. */
export interface PushSender { readonly name: string; send(messages: PushMessage[]): Promise<PushResult[]> }

/** Development / no push configured: the message is logged and counted as sent by "log". */
export class LogPushSender implements PushSender {
  readonly name = "log";
  readonly sent: PushMessage[] = [];
  async send(messages: PushMessage[]) {
    for (const m of messages) console.log(`[push:log] to=${m.to.slice(0, 22)}… title=${JSON.stringify(m.title)}`);
    this.sent.push(...messages);
    return messages.map(() => ({ ok: true as const, id: null }));
  }
}

/**
 * Expo Push Service (FCM on Android, APNs on iOS behind it). Up to 100 messages per request; the ticket says
 * per message whether it was accepted. `DeviceNotRegistered` means the app was uninstalled or the token rotated.
 */
export class ExpoPushSender implements PushSender {
  readonly name = "expo";
  constructor(private readonly accessToken: string | null, private readonly endpoint = "https://exp.host/--/api/v2/push/send") {}
  async send(messages: PushMessage[]): Promise<PushResult[]> {
    const out: PushResult[] = [];
    for (let i = 0; i < messages.length; i += 100) {
      const batch = messages.slice(i, i + 100);
      const r = await fetch(this.endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", ...(this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {}) },
        body: JSON.stringify(batch.map((m) => ({ to: m.to, title: m.title, body: m.body, data: m.data ?? {}, sound: "default", channelId: "alerts", priority: "high" }))),
        signal: AbortSignal.timeout(10_000),
      });
      if (!r.ok) throw new Error(`Expo push ${r.status}`);
      const json = (await r.json()) as { data?: { status: "ok" | "error"; id?: string; message?: string; details?: { error?: string } }[] };
      for (const t of json.data ?? []) {
        out.push(t.status === "ok" ? { ok: true, id: t.id ?? null } : { ok: false, error: t.details?.error ?? t.message ?? "error", unregistered: t.details?.error === "DeviceNotRegistered" });
      }
    }
    return out;
  }
}
