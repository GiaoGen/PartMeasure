// Read-only official registry research. This does not install or change package.json.
import { mkdir, writeFile } from 'node:fs/promises';
const names = ['next', 'react', 'react-dom', 'typescript', '@types/node', '@types/react', '@types/react-dom', 'vitest', '@playwright/test', 'react-konva', 'konva', '@supabase/supabase-js', '@supabase/ssr', 'zod', 'tailwindcss', '@tailwindcss/postcss', '@biomejs/biome', 'supabase'];
const packages = await Promise.all(names.map(async (name) => {
  const url = `https://registry.npmjs.org/${encodeURIComponent(name)}/latest`;
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`${name}: ${response.status}`);
  const p = await response.json();
  return { name, version: p.version, license: p.license, engines: p.engines, peerDependencies: p.peerDependencies, repository: p.repository, source: url };
}));
await mkdir('docs/evidence', { recursive: true });
await writeFile('docs/evidence/registry.json', `${JSON.stringify({ checkedAt: new Date().toISOString(), packages }, null, 2)}\n`);
for (const p of packages) console.log(JSON.stringify(p));
