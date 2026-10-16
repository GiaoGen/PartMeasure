import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const manifest = JSON.parse(await readFile('package.json', 'utf8'));
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const direct = new Set(Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }));
const packages = [];
for (const [path, p] of Object.entries(lock.packages)) {
  if (!path) continue;
  const name = path.slice(path.lastIndexOf('node_modules/') + 13);
  const notices = [];
  let installed = true;
  try {
    for (const file of await readdir(path)) {
      if (/^(licen[cs]e|copying|notice)([.-]|$)/i.test(file)) {
        try {
          const body = await readFile(`${path}/${file}`);
          notices.push({ file, sha256: createHash('sha256').update(body).digest('hex') });
        } catch { /* A directory named license is not a license file. */ }
      }
    }
  } catch { installed = false; }
  let license = p.license ?? 'UNDECLARED';
  let licenseSource = p.license ? 'package-lock metadata' : 'missing';
  // Some older packages omit package.json SPDX but explicitly license their distributed README.
  if (license === 'UNDECLARED' && installed) {
    try {
      const body = await readFile(`${path}/Readme.md`);
      const match = body.toString('utf8').match(/^## License\s+\n?(MIT|Apache-2\.0|ISC)\s*$/m);
      if (match) {
        license = match[1]; licenseSource = 'distributed Readme.md License section';
        notices.push({ file: 'Readme.md#License', sha256: createHash('sha256').update(body).digest('hex') });
      }
    } catch { /* An undeclared license remains a failing inventory item. */ }
  }
  packages.push({ name, version: p.version, license, licenseSource, direct: direct.has(name), path, installed, notices });
}
await writeFile('docs/evidence/licenses.json', `${JSON.stringify({ checkedAt: new Date().toISOString(), packages }, null, 2)}\n`);
const licenses = [...new Set(packages.map((p) => p.license))].sort();
const missing = packages.filter((p) => p.license === 'UNDECLARED');
console.log(JSON.stringify({ packages: packages.length, licenses, missingLicense: missing.map((p) => `${p.name}@${p.version}`), directLicenseFilesMissing: packages.filter((p) => p.direct && p.installed && p.notices.length === 0).map((p) => p.name) }, null, 2));
if (missing.length) process.exitCode = 1;
