import { createClient, ApiRequestError, type SessionUser, type TokenResponse } from "@fleet/contracts";
import { API_URL } from "./config";
import { clearRefreshToken, loadRefreshToken, saveRefreshToken } from "./secure";

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
    this.setUser(r.user);
  }

  private setUser(u: SessionUser | null) {
    this.user = u;
    for (const l of this.listeners) l(u);
  }

  async activate(username: string, code: string, deviceName: string, platform: "android" | "ios" | "web") {
    await this.apply(await this.api.call("driverActivate", { body: { username, code, deviceName, platform } }));
  }

  /** Restore on app start. Returns false if the device must be activated again. */
  async restore(): Promise<boolean> {
    return (await this.refresh()) !== null;
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
    this.setUser(null);
  }

  async logout() {
    const token = await loadRefreshToken();
    if (token) await this.api.call("logout", { body: { refreshToken: token } }).catch(() => {});
    await this.forget();
  }
}

export const session = new DriverSession();
