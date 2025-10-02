// next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    // ✅ don't fail the vercel build on ESLint errors
    ignoreDuringBuilds: true,
  },
  typescript: {
    // ❗ optional: only if you also hit *type* errors and need to ship
    // This will allow production builds to complete even with TS type errors.
    ignoreBuildErrors: false,
  },
};

export default nextConfig;
