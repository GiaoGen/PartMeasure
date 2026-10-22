import type { NextConfig } from 'next';
import { buildId } from './src/lib/build-info';

const config: NextConfig = {
  generateBuildId: async () => buildId,
  reactStrictMode: true,
  poweredByHeader: false,
  logging: { incomingRequests: false },
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'Referrer-Policy', value: 'no-referrer' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
    ] }];
  },
};
export default config;
