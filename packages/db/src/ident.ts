/** Postgres identifiers derived from a tenant slug; validated so they are safe to interpolate. */
const SAFE = /^[a-z_][a-z0-9_]{0,62}$/;
export function tenantDbName(slug: string) { return assertIdent(`fleet_t_${slug.replace(/-/g, "_")}`); }
export function tenantRoleName(slug: string) { return assertIdent(`fleet_t_${slug.replace(/-/g, "_")}_app`); }
export function assertIdent(name: string): string {
  if (!SAFE.test(name)) throw new Error(`unsafe identifier: ${name}`);
  return name;
}
export const q = (ident: string) => `"${assertIdent(ident)}"`;
