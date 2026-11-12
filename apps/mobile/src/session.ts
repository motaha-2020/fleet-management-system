import { fetch as expoFetch } from "expo/fetch";
import { createClient, ApiRequestError, type SessionUser, type TokenResponse, type UploadState } from "@fleet/contracts";
import { API_URL } from "./config";
import { clearRefreshToken, loadRefreshToken, saveRefreshToken } from "./secure";
import { store } from "./store";

type Listener = (u: SessionUser | null) => void;

/** Driver session: short-lived access token in memory, rotating device refresh token in the keystore. */
class DriverSession {
  private accessToken: string | null = null;
  private refreshing: Promise<string | null> | null = null;
  user: SessionUser | null = null;
  private listeners = new Set<Listener>();

  readonly api = createClient({
    baseUrl: API_URL,
    getAccessToken: () => this.accessToken,
    onUnauthorized: () => this.refresh(),
  });

  subscribe(l: Listener) {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  }

  private async apply(r: TokenResponse) {
    this.accessToken = r.accessToken;
    if (r.refreshToken) await saveRefreshToken(r.refreshToken);
    await store.saveUser(r.user);
    this.setUser(r.user);
  }

  private setUser(u: SessionUser | null) {
    this.user = u;
    for (const l of this.listeners) l(u);
  }

  async activate(username: string, code: string, deviceName: string, platform: "android" | "ios" | "web") {
    // A new device starts with an empty outbox and device sequence 1 (the old device was revoked).
    await store.wipe();
    await this.apply(await this.api.call("driverActivate", { body: { username, code, deviceName, platform } }));
  }

  /**
   * Restore on app start. Returns false if the device must be activated again. Offline (OFF-001) the driver
   * keeps working: the profile saved at the last connection is used until the server can be reached.
   */
  async restore(): Promise<boolean> {
    if ((await this.refresh()) !== null) return true;
    if (!(await loadRefreshToken())) return false;
    const cached = await store.getUser();
    if (cached) this.setUser(cached);
    return !!cached;
  }

  refresh(): Promise<string | null> {
    this.refreshing ??= (async () => {
      const token = await loadRefreshToken();
      if (!token) return null;
      try {
        const r = await this.api.call("refresh", { body: { refreshToken: token } });
        await this.apply(r);
        return r.accessToken;
      } catch (e) {
        // Revoked device / expired session: forget it and go back to activation.
        if (e instanceof ApiRequestError && e.status === 401) await this.forget();
        return null;
      }
    })().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  async forget() {
    this.accessToken = null;
    await clearRefreshToken();
    // OFF-013: nothing of this driver stays on the phone once the session is gone.
    await store.wipe().catch(() => {});
    this.setUser(null);
  }

  /**
   * One chunk of a resumable upload (OFF-008). Sent with expo/fetch because the body is raw bytes;
   * the access token is refreshed once on 401 like the typed client does.
   */
  async uploadChunk(uploadId: string, offset: number, bytes: Uint8Array): Promise<UploadState> {
    const send = (token: string | null) => expoFetch(`${API_URL}/uploads/${uploadId}`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${token ?? ""}`, "content-type": "application/octet-stream", "upload-offset": String(offset) },
      body: new Uint8Array(bytes), // a copy with its own ArrayBuffer (the chunk is a view of the whole file)
    });
    let res = await send(this.accessToken);
    if (res.status === 401) res = await send(await this.refresh());
    const text = await res.text();
    const body = text ? JSON.parse(text) : null;
    if (!res.ok) throw new ApiRequestError(res.status, body);
    return body as UploadState;
  }

  async logout() {
    const token = await loadRefreshToken();
    if (token) await this.api.call("logout", { body: { refreshToken: token } }).catch(() => {});
    await this.forget();
  }
}

export const session = new DriverSession();
