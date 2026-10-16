import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { config, client, loadSession, evidence, safeError } from './cloud-common.mjs';

async function main() {
const c = await config();
const sessions = { A: await loadSession('A'), B: await loadSession('B') };
const clients = { A: client(c, sessions.A), B: client(c, sessions.B), anon: client(c) };
const checks = [];
const records = [];
const objects = [];
const cleanup = [];
const bucket = 'p0-0-service-lab';
const run = randomUUID();
const ids = {};
async function check(name, fn) {
  try { await fn(); checks.push({ name, status: 'PASS' }); }
  catch (error) { checks.push({ name, status: 'FAIL', error: safeError(error) }); }
}
function ok(result) { if (result.error) throw result.error; return result.data; }
function denied(result) { assert.ok(result.error, 'Must be denied, not successful'); }
try {
  for (const actor of ['A','B']) {
    await check(`Auth ${actor}: server validates real session`, async () => {
      const { data, error } = await clients[actor].auth.getUser(sessions[actor].access_token);
      if (error) throw error;
      assert.equal(data.user.email.toLowerCase(), c.emails[actor].toLowerCase());
      ids[actor] = data.user.id;
    });
  }
  if (!ids.A || !ids.B) throw new Error('Verified sessions required');
  assert.notEqual(ids.A, ids.B);
  for (const actor of ['A','B']) await check(`${actor}: own record insert/read`, async () => {
    const row = ok(await clients[actor].from('p0_lab_records').insert({ owner_id: ids[actor], label: `${actor}-${run}` }).select().single());
    records.push({ actor, id: row.id });
    const rows = ok(await clients[actor].from('p0_lab_records').select('id').eq('id',row.id));
    assert.equal(rows.length,1);
  });
  for (const [actor, other] of [['A','B'],['B','A']]) {
    const otherRecord = records.find(r=>r.actor===other);
    if (!otherRecord) throw new Error('Seed record required');
    await check(`${actor}: cannot read ${other} record by known ID`, async () => assert.equal(ok(await clients[actor].from('p0_lab_records').select('id').eq('id',otherRecord.id)).length,0));
    await check(`${actor}: cannot mutate ${other} record`, async () => assert.equal(ok(await clients[actor].from('p0_lab_records').update({ label:'forged' }).eq('id',otherRecord.id).select()).length,0));
    await check(`${actor}: cannot forge ${other} owner_id`, async () => denied(await clients[actor].from('p0_lab_records').insert({ owner_id:ids[other],label:'forged' })));
    const self = records.find(r=>r.actor===actor);
    await check(`${actor}: cannot reassign own row to ${other}`, async () => denied(await clients[actor].from('p0_lab_records').update({owner_id:ids[other]}).eq('id',self.id)));
  }
  await check('Anonymous: record SELECT denied by ACL', async () => denied(await clients.anon.from('p0_lab_records').select('id')));
  await check('Anonymous: forged INSERT denied', async () => denied(await clients.anon.from('p0_lab_records').insert({owner_id:ids.A,label:'anonymous'})));
  for (const actor of ['A','B']) {
    const path=`${ids[actor]}/${run}.txt`;
    const bytes=Buffer.from(`PartMeasure P0-0 service experiment ${actor} ${run}`);
    await check(`${actor}: private Storage upload/download byte equality`, async () => {
      ok(await clients[actor].storage.from(bucket).upload(path,bytes,{contentType:'text/plain',upsert:false}));
      objects.push({actor,path});
      const blob=ok(await clients[actor].storage.from(bucket).download(path));
      assert.deepEqual(Buffer.from(await blob.arrayBuffer()),bytes);
    });
    const other=actor==='A'?'B':'A';
    await check(`${other}: cannot download ${actor} private path`, async () => denied(await clients[other].storage.from(bucket).download(path)));
    await check(`${other}: cannot upload into ${actor} folder`, async () => denied(await clients[other].storage.from(bucket).upload(`${ids[actor]}/forged-${run}.txt`,bytes,{contentType:'text/plain'})));
    await check('Anonymous: private file download denied', async () => denied(await clients.anon.storage.from(bucket).download(path)));
    await check('Anonymous: private file upload denied', async () => denied(await clients.anon.storage.from(bucket).upload(`anon/${run}.txt`,bytes,{contentType:'text/plain'})));
    await check(`${actor}: overwrite existing private path rejected`, async () => denied(await clients[actor].storage.from(bucket).upload(path,bytes,{contentType:'text/plain',upsert:false})));
    await check(`${actor}: disallowed MIME rejected`, async () => denied(await clients[actor].storage.from(bucket).upload(`${ids[actor]}/bad-${run}.svg`,Buffer.from('<svg/>'),{contentType:'image/svg+xml'})));
  }
  await check('Anonymous: unsigned public URL cannot fetch private object', async () => {
    const obj=objects[0];assert.ok(obj);
    const { data }=clients.anon.storage.from(bucket).getPublicUrl(obj.path);
    const res=await fetch(data.publicUrl);assert.equal(res.ok,false);
  });
  await check('Private file: owner signs short URL; bearer download matches bytes',async()=>{
    const obj=objects[0];assert.ok(obj);
    const data=ok(await clients[obj.actor].storage.from(bucket).createSignedUrl(obj.path,30));
    const res=await fetch(data.signedUrl);assert.equal(res.ok,true);
    assert.equal(await res.text(),`PartMeasure P0-0 service experiment ${obj.actor} ${run}`);
    // URL remains only in memory. Its expiry/revocation is not claimed tested.
  });
} catch (error) { checks.push({name:'experiment prerequisites',status:'FAIL',error:safeError(error)}); }
finally {
  for (const {actor,path} of objects) {
    const result=await clients[actor].storage.from(bucket).remove([path]);
    cleanup.push({kind:'storage object',actor,success:!result.error,error:safeError(result.error)});
  }
  for (const {actor,id} of records) {
    const result=await clients[actor].from('p0_lab_records').delete().eq('id',id).select('id');
    cleanup.push({kind:'lab record',actor,success:!result.error&&result.data.length===1,error:safeError(result.error)});
  }
  await evidence('cloud-services',{checks,cleanup,passed:checks.filter(x=>x.status==='PASS').length,failed:checks.filter(x=>x.status==='FAIL').length});
  console.log(JSON.stringify({passed:checks.filter(x=>x.status==='PASS').length,failed:checks.filter(x=>x.status==='FAIL').length,cleanupFailures:cleanup.filter(x=>!x.success).length}));
  if(checks.some(x=>x.status==='FAIL')||cleanup.some(x=>!x.success))process.exitCode=1;
}
}
await main().catch(error=>{
  console.log(JSON.stringify({operation:'service-experiment',completed:false,error:safeError(error)}));
  process.exitCode=1;
});
