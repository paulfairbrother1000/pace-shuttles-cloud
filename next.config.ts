// next.config.ts
const nextConfig = {
  // keep anything else you already had
  outputFileTracingRoot: undefined,

  // 👇 top-level, not under `experimental`
  allowedDevOrigins: ["http://192.168.68.106:3000"],
};

export default nextConfig;
