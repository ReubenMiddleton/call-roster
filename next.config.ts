import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The interactive core (roster grid, preference form, swap workflow) is built as
  // client components against a JSON API rather than Server Components with Server
  // Actions. That keeps a future Vite + Capacitor lift viable without a rewrite —
  // see docs/architecture/decisions/0009-pwa-first-no-native-wrapper.md.
  reactStrictMode: true,
};

export default nextConfig;
