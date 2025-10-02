
/** @type {import('next').NextConfig} */
const nextConfig = {
  // you already had these:
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },

  // ADD THIS:
  images: {
    remotePatterns: [
      // Supabase buckets (adjust if yours differ)
      { protocol: 'https', hostname: '**.supabase.co', pathname: '/storage/v1/object/public/**' },
      // add any other hosts you actually use:
      // { protocol: 'https', hostname: 'res.cloudinary.com', pathname: '/**' },
      // { protocol: 'https', hostname: 'images.unsplash.com', pathname: '/**' },
    ],
    formats: ['image/avif', 'image/webp'],
  },
};

export default nextConfig;
