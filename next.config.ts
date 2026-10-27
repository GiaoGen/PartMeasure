import type { NextConfig } from 'next';
import { releaseSource } from './scripts/release/fingerprint';
import { CV_WORKER_CSP, CV_WORKER_URL } from './src/lib/cv/protocol';

const release = releaseSource();
// Public build inputs only. Per-file checksums make platform/cache transformations
// diagnosable without exposing environment variables or guessing from an opaque ID.
if (process.env.VERCEL === '1') {
  console.info(JSON.stringify({ event: 'release_build_source', digest: release.digest, buildId: release.buildId, count: release.files.length }));
  for (let index = 0; index < release.files.length; index += 15)
    console.info(JSON.stringify({ event: 'release_build_inputs', digest: release.digest, files: release.files.slice(index, index + 15) }));
}
const config: NextConfig = {
  generateBuildId: async () => release.buildId,
  env: { PM_BUILD_ID: release.buildId },
  reactStrictMode: true,
  poweredByHeader: false,
  logging: { incomingRequests: false, serverFunctions: false, browserToTerminal: false },
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
