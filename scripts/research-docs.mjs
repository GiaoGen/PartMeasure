import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const sources = [
  ['next-install', 'https://nextjs.org/docs/app/getting-started/installation'],
  ['next-vitest', 'https://nextjs.org/docs/app/guides/testing/vitest'],
  ['next-handlers', 'https://nextjs.org/docs/app/getting-started/route-handlers'],
  ['typescript', 'https://www.typescriptlang.org/tsconfig/strict.html'],
  ['react', 'https://react.dev/versions'],
  ['vitest', 'https://vitest.dev/guide/'],
  ['playwright', 'https://playwright.dev/docs/intro'],
  ['tailwind', 'https://tailwindcss.com/docs/installation/using-postcss'],
  ['tailwind-browsers', 'https://tailwindcss.com/docs/compatibility'],
  ['zod', 'https://zod.dev/'],
  ['biome', 'https://biomejs.dev/guides/getting-started/'],
  ['konva', 'https://konvajs.org/docs/react/index.html'],
  ['konva-readme', 'https://raw.githubusercontent.com/konvajs/react-konva/master/README.md'],
  ['supabase-tls-change', 'https://supabase.com/changelog/cbc-tls-ciphers-deprecated'],
  ['supabase-api-change', 'https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically'],
  ['supabase-smtp-change', 'https://supabase.com/changelog/46599-changes-to-email-template-customisation-on-free-tier'],
  ['supabase-changelog', 'https://supabase.com/changelog.md'],
  ['supabase-ssr', 'https://supabase.com/docs/guides/auth/server-side/creating-a-client.md'],
  ['supabase-rls', 'https://supabase.com/docs/guides/database/postgres/row-level-security.md'],
  ['supabase-storage', 'https://supabase.com/docs/guides/storage/security/access-control.md'],
  ['supabase-private', 'https://supabase.com/docs/guides/storage/buckets/fundamentals.md'],
  ['supabase-tus', 'https://supabase.com/docs/guides/storage/uploads/resumable-uploads.md'],
  ['supabase-signed-upload', 'https://supabase.com/docs/reference/javascript/storage-from-createsigneduploadurl'],
  ['supabase-migrations', 'https://supabase.com/docs/guides/deployment/database-migrations.md'],
];
await mkdir('tmp/docs', { recursive: true });
const results = await Promise.all(sources.map(async ([id, url]) => {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
    const body = await r.text();
    const plain = body.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    await writeFile(`tmp/docs/${id}.txt`, plain);
    return { id, url, resolvedUrl: r.url, status: r.status, bytes: body.length };
  } catch (e) { return { id, url, error: String(e) }; }
}));
const konvaReadme = await readFile('node_modules/react-konva/README.md');
results.push({ id: 'konva-installed-official-readme', source: 'npm package react-konva@19.3.2/README.md', sha256: createHash('sha256').update(konvaReadme).digest('hex'), note: 'Installed official package documentation read after obsolete doc URLs returned 404 and GitHub raw failed.' });
await mkdir('docs/evidence', { recursive: true });
await writeFile('docs/evidence/official-docs.json', `${JSON.stringify({ checkedAt: new Date().toISOString(), sources: results }, null, 2)}\n`);
console.log(JSON.stringify(results, null, 2));
