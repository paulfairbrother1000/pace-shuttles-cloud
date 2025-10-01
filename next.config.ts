// next.config.ts
// const nextConfig = {
  // keep anything else you already had
  // outputFileTracingRoot: undefined,

  // 👇 top-level, not under `experimental`
  // allowedDevOrigins: ["http://192.168.68.106:3000"],
// };

export default nextConfig;

// next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
};

export default nextConfig;
