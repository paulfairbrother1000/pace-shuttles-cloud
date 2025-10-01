// next.config.ts
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Don’t fail the Vercel build on lint issues
  eslint: { ignoreDuringBuilds: true },
  // Don’t fail the Vercel build on type errors
  typescript: { ignoreBuildErrors: true },
};

export default nextConfig;
