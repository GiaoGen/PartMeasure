// Latest targeted coverage does not erase failures in a full run or imply stage acceptance.
import { readFile, writeFile } from 'node:fs/promises';
const sources = ['browser.json', 'browser-recovery.json', 'browser-files.json'];
const byCheck = new Map();
for (const source of sources) {
 const report = JSON.parse(await readFile(`docs/evidence/p0-2/${source}`, 'utf8'));
 for (const result of report.results) byCheck.set(result.check, { ...result, source, checkedAt: report.checkedAt });
}
const report = {
 generatedAt: new Date().toISOString(),
 scope: 'Latest functional browser coverage across three real production-build runs; not one all-green full run.',
 stageAccepted: false,
 historicalFailuresRetained: true,
 stability: 'OPEN: historical real 401 and intermittent 503 not root-caused',
 manualExperience: 'PENDING_USER',
 physicalPhone: 'PENDING_EXTERNAL',
 newRegistrationOtp: 'USER_DEFERRED',
 mainlandNetwork: 'DEFERRED_UNTIL_P0_EXIT',
 results: [...byCheck.values()],
};
await writeFile('docs/evidence/p0-2/browser-summary.json', `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`latest functional checks: ${report.results.filter(r=>r.status==='PASS').length}/${report.results.length} PASS; stage acceptance pending\n`);
if (report.results.some(r=>r.status==='FAIL')) process.exitCode = 1;
