import { assertDevWeb } from "./devWeb";

/** Web (development only): localStorage stands in for the OS keystore. Anything on the page can read it. */
export const keystore = {
  async get(key: string): Promise<string | null> {
    assertDevWeb();
    return localStorage.getItem(key);
  },
  async set(key: string, value: string): Promise<void> {
    assertDevWeb();
    localStorage.setItem(key, value);
  },
  async delete(key: string): Promise<void> {
    assertDevWeb();
    localStorage.removeItem(key);
  },
};
