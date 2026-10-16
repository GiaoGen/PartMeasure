// Local audit: reports file names only, never matching values. No network requests.
import {execFileSync} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
const needles=new Set();
const add=value=>{if(typeof value==='string'&&value.length>=16)needles.add(value);};
for(const file of ['.env.local','tmp/p0-1/generated-env.local']){
 const text=await readFile(file,'utf8');
 for(const line of text.split(/\r?\n/)){
  const m=line.match(/^([^#=]+)=(.*)$/);if(!m||m[1].startsWith('NEXT_PUBLIC_'))continue;
  const value=m[2].replace(/^['"]|['"]$/g,'');
  if(/KEY|SECRET|DATABASE_URL/.test(m[1])){
   add(value);
   if(m[1].includes('DATABASE_URL')){try{add(decodeURIComponent(new URL(value).password));}catch{}}
  }
 }
}
for(const file of ['secret-key.txt','admin-database-url.txt'])add((await readFile(`tmp/p0-1/${file}`,'utf8')).trim());
const accounts=JSON.parse(await readFile('tmp/p0-1/test-accounts.json','utf8'));
for(const account of Object.values(accounts))add(account.password);
const fixture=JSON.parse(await readFile('tmp/p0-1/business-fixtures.json','utf8'));
add(fixture.shareUrl);add(fixture.shareUrl?.split('/').pop());
const files=[...new Set(execFileSync('git',['-c','safe.directory=D:/PartMeasure','ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8'}).split('\0').filter(Boolean))];
const flagged=[];
for(const file of files){
 const bytes=await readFile(file);
 if([...needles].some(value=>bytes.includes(Buffer.from(value)))||/sb_secret_[A-Za-z0-9_-]{16,}/.test(bytes.toString('utf8')))flagged.push(file);
}
const report={checkedAt:new Date().toISOString(),status:flagged.length?'FAIL':'PASS',filesScanned:files.length,flaggedFiles:flagged,scope:'Exact local configured keys/passwords and current fixture capability; sb_secret pattern. Not a complete historical secret detector; screenshots reviewed separately.'};
await writeFile('docs/evidence/p0-1/secret-audit.json',`${JSON.stringify(report,null,2)}\n`);
process.stdout.write(`${JSON.stringify(report)}\n`);if(flagged.length)process.exitCode=1;
