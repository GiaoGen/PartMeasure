import {readFile,writeFile} from 'node:fs/promises';
const raw=JSON.parse(await readFile('tmp/konva-report.json','utf8'));
const tests=[];
for(const suite of raw.suites)for(const spec of suite.specs??[])for(const t of spec.tests){
  tests.push({name:spec.title,project:t.projectName,status:t.status,results:t.results.map(r=>({status:r.status,durationMs:r.duration,retry:r.retry,errorCount:r.errors.length}))});
}
const projects=(raw.config.filteredProjects??raw.config.projects).map(p=>({name:p.name,viewport:p.use?.viewport,deviceScaleFactor:p.use?.deviceScaleFactor,userAgent:p.use?.userAgent}));
await writeFile('docs/evidence/closeout/konva-browser.json',`${JSON.stringify({scope:'independent Konva/EXIF experiment; not application acceptance',startTime:raw.stats.startTime,durationMs:raw.stats.duration,passed:raw.stats.expected,failed:raw.stats.unexpected,skipped:raw.stats.skipped,flaky:raw.stats.flaky,projects,tests},null,2)}\n`);
console.log(JSON.stringify({recorded:tests.length,passed:raw.stats.expected,failed:raw.stats.unexpected}));
if(raw.stats.unexpected)process.exitCode=1;
