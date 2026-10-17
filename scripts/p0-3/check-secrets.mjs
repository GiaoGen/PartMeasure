// Reuse the established scanner without overwriting earlier-phase evidence.
import { readFile, writeFile } from "node:fs/promises";
const source = (await readFile("scripts/p0-2/check-secrets.mjs", "utf8"))
  .replace('"tmp/p0-2/fixture.json",', '"tmp/p0-2/fixture.json",\n\t"tmp/p0-3/fixture.json",')
  .replace('"docs/evidence/p0-2/secret-audit.json"', '"docs/evidence/p0-3/secret-audit.json"')
  .replace("current P0-1 and P0-2 share capability", "current P0-1/P0-2/P0-3 share capabilities");
// Ignored transient module preserves normal ESM imports and shared scanner behavior.
const path = "tmp/p0-3/secret-scanner.mjs";
await writeFile(path, source);
await import(`../../${path}`);
