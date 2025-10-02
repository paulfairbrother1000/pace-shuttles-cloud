/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "bopvaaexicvdueidyvjd.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
      // add any other hosts you use for images:
      // { protocol: "https", hostname: "images.unsplash.com", pathname: "/**" },
    ],
    deviceSizes: [360, 414, 640, 768, 1024, 1280, 1536],
  },
};

module.exports = nextConfig;
