-- Disposable PG-only test harness. Supabase identity/storage objects below are STUBS.
-- Never run in an existing/remote database. scripts/check-sql-draft.ps1 makes a new cluster.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
create schema storage;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
\ir ../../supabase/drafts/baseline.sql

create function pg_temp.assert_true(b boolean, label text) returns text language plpgsql as $$
begin if b is distinct from true then raise exception 'FAIL: %',label; end if;
return 'PASS: ' || label; end $$;
create function pg_temp.expect_error(statement text, expected_state text, label text) returns text language plpgsql as $$
begin
  begin execute statement;
  exception when others then
    if sqlstate=expected_state then return 'PASS: ' || label; end if;
    raise;
  end;
  raise exception 'FAIL: statement unexpectedly succeeded: %',label;
end $$;

select pg_temp.assert_true((select count(*)=16 and bool_and(relrowsecurity) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'),'all 16 business tables enable RLS');
select pg_temp.assert_true((select not public and file_size_limit=104857600 from storage.buckets where id='partmeasure-private'),'private bucket hard limit');
insert into auth.users values ('00000000-0000-4000-8000-000000000001'),('00000000-0000-4000-8000-000000000002');
insert into public.projects(id,owner_id,name) values
('10000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001','A'),
('10000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000002','B');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);
select pg_temp.assert_true((select count(*)=1 and min(name)='A' from public.projects),'Owner A cannot read Owner B project');
select pg_temp.expect_error('insert into public.projects(owner_id,name) values (''00000000-0000-4000-8000-000000000001'',''forged'')','42501','browser Owner has no direct write grant');
select pg_temp.expect_error('select * from public.share_links','42501','Owner cannot read token hashes via Data API');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',false);
select pg_temp.assert_true((select count(*)=1 and min(name)='B' from public.projects),'Owner B cannot read Owner A project');
reset role;
set role anon;
select pg_temp.expect_error('select * from public.projects','42501','anon cannot directly query business tables');
reset role;

insert into public.upload_reservations(id,project_id,actor_key,storage_key,reserved_bytes,status,interaction_expires_at,credential_expires_at,cleanup_after)
values('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','owner:A','quarantine/A',100,'ready',now()+interval '15 minutes',now()+interval '2 hours',now()+interval '25 hours');
insert into public.file_assets(id,project_id,reservation_id,uploader_type,uploader_user_id,storage_key,canonical_key,filename,mime,byte_size,sha256,canonical_sha256,kind,purpose,state,canonical_width,canonical_height,normalization_version)
values('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','owner','00000000-0000-4000-8000-000000000001','source/A','canonical/A','A.jpg','image/jpeg',100,repeat('a',64),repeat('b',64),'image','raw','ready',4000,3000,1);
select pg_temp.expect_error('insert into public.annotations(project_id,file_id,created_by) values(''10000000-0000-4000-8000-000000000002'',''30000000-0000-4000-8000-000000000001'',''00000000-0000-4000-8000-000000000002'')','23514','cross-project annotation rejected');
insert into public.annotations(id,project_id,file_id,created_by) values('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001');
insert into public.annotation_revisions(project_id,file_id,annotation_id,revision,type,geometry_json,created_by) values('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',1,'point','{"at":{"x":0.5,"y":0.5}}','00000000-0000-4000-8000-000000000001');
insert into public.issues(id,project_id,file_id,annotation_id,annotation_revision,kind,title,measurement_method) values('50000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',1,'measurement','hole','inside_jaws');
select pg_temp.expect_error('insert into public.issues(project_id,kind,title) values(''10000000-0000-4000-8000-000000000001'',''measurement'',''missing target'')','23514','measurement requires real annotation target');
insert into public.issue_responses(id,project_id,issue_id,author_type,author_user_id,response_kind,numeric_value,unit) values('60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','owner','00000000-0000-4000-8000-000000000001','numeric',12.3,'mm');
select pg_temp.expect_error('update public.issue_responses set numeric_value=13','23514','responses cannot be silently overwritten');
select pg_temp.expect_error('insert into public.issue_responses(project_id,issue_id,author_type,author_user_id,response_kind,body) values(''10000000-0000-4000-8000-000000000002'',''50000000-0000-4000-8000-000000000001'',''owner'',''00000000-0000-4000-8000-000000000002'',''unable'',''cannot measure'')','23503','composite FK rejects cross-project response');
select pg_temp.expect_error('update public.annotation_revisions set geometry_json=''{}''','23514','issued geometry revisions immutable');
select pg_temp.expect_error('update public.file_assets set deleted_at=now()','23514','historically referenced files protected');
select pg_temp.expect_error('update public.file_assets set canonical_width=2000','23514','ready canonical dimensions immutable');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',false);
select pg_temp.assert_true((select count(*)=0 from public.file_assets),'RLS isolates child assets');
select pg_temp.assert_true((select count(*)=0 from public.issue_responses),'RLS isolates responses');
reset role;
insert into public.deliveries(id,project_id) values('70000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001');
insert into public.delivery_files(project_id,delivery_id,file_id) values('10000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001');
update public.deliveries set version_no=1,published_at=now(),published_by='00000000-0000-4000-8000-000000000001';
select pg_temp.expect_error('update public.deliveries set description=''replacement''','23514','published deliveries immutable');
select pg_temp.expect_error('delete from public.delivery_files','23514','published file sets immutable');
select pg_temp.expect_error('insert into public.deliveries(project_id,version_no,published_at,published_by) values(''10000000-0000-4000-8000-000000000001'',1,now(),''00000000-0000-4000-8000-000000000001'')','23505','project version number unique');
insert into public.idempotency_keys(project_id,actor_key,action,key,request_hash,expires_at) values('10000000-0000-4000-8000-000000000001','owner:A','response','80000000-0000-4000-8000-000000000001',repeat('a',64),now()+interval '24 hours');
select pg_temp.expect_error('insert into public.idempotency_keys(project_id,actor_key,action,key,request_hash,expires_at) select project_id,actor_key,action,key,request_hash,expires_at from public.idempotency_keys','23505','idempotency scope unique');
-- No claim of full state-machine/quota/RPC/Storage security coverage.
