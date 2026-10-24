import type { NextConfig } from 'next';
import { buildId } from './src/lib/build-info';
import { CV_WORKER_CSP, CV_WORKER_URL } from './src/lib/cv/protocol';

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
    ] }, { source: CV_WORKER_URL, headers: [
      { key: 'Content-Security-Policy', value: CV_WORKER_CSP },
      { key: 'Cache-Control', value: 'no-store' },
    ] }, { source: '/cv/opencv-4.12.0-bd0c3e644804.js', headers: [
      { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
    ] }];
  },
};
export default config;
