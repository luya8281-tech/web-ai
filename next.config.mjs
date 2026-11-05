import withPWAInit from "@ducanh2912/next-pwa";

const withPWA = withPWAInit({
  dest: "public",
  disable: true,
  register: false,
  skipWaiting: true,
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: {
    ignoreDuringBuilds: true,
  },
  // Dipakai scripts/deploy.sh untuk build ke folder sementara (.next.new)
  // sementara server produksi tetap menyajikan .next yang lama. Saat runtime
  // variabel ini tidak di-set, jadi tetap memakai .next.
  distDir: process.env.NEXT_DIST_DIR || '.next',
};

export default withPWA(nextConfig);
