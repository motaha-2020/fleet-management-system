import type { NextConfig } from "next";

const API_URL = process.env.API_URL ?? "http://localhost:4000";

// Next.js serves the UI only (ADR-013). /api/* is proxied to the Fleet API so the
// refresh-token cookie stays first-party and SameSite=Strict.
const config: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/:path*` }];
  },
};
export default config;
