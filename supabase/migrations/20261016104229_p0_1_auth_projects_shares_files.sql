-- P0-1 only. Real Supabase auth/storage; no local substitutes, no future business tables.
create role partmeasure_runtime login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
create role partmeasure_worker login noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
-- Passwords are provisioned separately, never in migration/history.
create schema pm;
revoke all on schema pm from public, anon, authenticated;
grant usage on schema pm to partmeasure_runtime, partmeasure_worker;
alter default privileges in schema pm revoke all on tables from public, anon, authenticated;
alter default privileges in schema pm revoke execute on functions from public;

create table pm.projects (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users(id),
 name text not null check(length(name) between 1 and 120), description text not null default '' check(length(description)<=4000),
 revision integer not null default 1, used_bytes bigint not null default 0 check(used_bytes>=0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index projects_owner on pm.projects(owner_id,created_at desc,id);
create table pm.owner_usage(owner_id uuid primary key references auth.users(id), used_bytes bigint not null default 0 check(used_bytes>=0), reserved_bytes bigint not null default 0 check(reserved_bytes>=0));
alter table pm.owner_usage enable row level security;
create policy usage_runtime on pm.owner_usage to partmeasure_runtime using(true) with check(true);
create policy usage_worker on pm.owner_usage to partmeasure_worker using(true) with check(true);
grant select,insert,update on pm.owner_usage to partmeasure_runtime;
grant select,update on pm.owner_usage to partmeasure_worker;
create table pm.share_links (
 id uuid primary key default gen_random_uuid(), project_id uuid not null references pm.projects(id),
 token_hash text not null unique check(length(token_hash)=64),
 expires_at timestamptz not null default now()+interval '30 days', revoked_at timestamptz,
 created_at timestamptz not null default now(), unique(project_id,id)
);
create index shares_project on pm.share_links(project_id);
create table pm.guest_sessions (
 id uuid primary key default gen_random_uuid(), project_id uuid not null, share_id uuid not null,
 token_hash text not null unique check(length(token_hash)=64), expires_at timestamptz not null default now()+interval '24 hours',
 created_at timestamptz not null default now(), foreign key(project_id,share_id) references pm.share_links(project_id,id)
);
create index sessions_link on pm.guest_sessions(project_id,share_id);
create table pm.upload_reservations (
 id uuid primary key, project_id uuid not null references pm.projects(id), actor_key text not null,
 share_id uuid, filename text not null check(length(filename)<=255), extension text not null, declared_mime text not null,
 byte_size bigint not null check(byte_size>0 and byte_size<=104857600), sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
 reserved_bytes bigint not null check(reserved_bytes>0), quarantine_key text not null unique,
 state text not null default 'reserved' check(state in ('reserved','queued','processing','ready','rejected','cleaned')),
 error_code text, grant_expires_at timestamptz not null default now()+interval '2 hours',
 cleanup_after timestamptz not null default now()+interval '25 hours',
 created_at timestamptz not null default now(), unique(project_id,id),
 foreign key(project_id,share_id) references pm.share_links(project_id,id)
);
create index reservations_project on pm.upload_reservations(project_id,created_at);
create index reservations_cleanup on pm.upload_reservations(cleanup_after) where state<>'ready' and state<>'cleaned';
create unique index reservation_dedupe on pm.upload_reservations(project_id,sha256,byte_size) where state in ('reserved','queued','processing','ready');
create table pm.file_assets (
 id uuid primary key, project_id uuid not null references pm.projects(id), reservation_id uuid not null unique,
 filename text not null, mime text not null, extension text not null, byte_size bigint not null check(byte_size>0),
 original_bytes bigint not null, storage_key text not null unique, original_key text not null unique,
 sha256 text not null, original_sha256 text not null, width integer, height integer, normalization_version integer,
 uploader_type text not null check(uploader_type in ('owner','guest')), created_at timestamptz not null default now(),
 visibility text not null default 'customer' check(visibility in ('customer','internal')),
 deleted_at timestamptz, history_protected boolean not null default false,
 unique(project_id,id), foreign key(project_id,reservation_id) references pm.upload_reservations(project_id,id)
);
create index assets_project on pm.file_assets(project_id,created_at desc,id);
create table pm.jobs (
 id uuid primary key default gen_random_uuid(), reservation_id uuid not null unique references pm.upload_reservations(id),
 attempts integer not null default 0, lease_until timestamptz, lease_token uuid, next_at timestamptz not null default now(),
 done_at timestamptz, dead_at timestamptz, error_code text
);
create index jobs_due on pm.jobs(next_at,lease_until) where done_at is null and dead_at is null;
create table pm.idempotency_keys (
 scope text not null, key uuid not null, request_hash text not null, result jsonb not null,
 created_at timestamptz not null default now(), primary key(scope,key)
);
create table pm.rate_limits (
 key text primary key, window_at timestamptz not null, hits integer not null check(hits>0)
);
create table pm.audit_events (
 id uuid primary key default gen_random_uuid(), project_id uuid not null references pm.projects(id),
 actor_type text not null, action text not null, object_id uuid not null, created_at timestamptz not null default now()
);
create index audit_project on pm.audit_events(project_id,created_at);

create function pm.owner_id() returns uuid language sql stable security invoker set search_path='' as $$
 select nullif(current_setting('pm.owner_id',true),'')::uuid
$$;
create function pm.can_read(p uuid) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from pm.guest_sessions s join pm.share_links l on l.id=s.share_id and l.project_id=s.project_id
 where s.project_id=p and s.token_hash=nullif(current_setting('pm.guest_hash',true),'')
 and s.expires_at>now() and l.expires_at>now() and l.revoked_at is null)
$$;
create function pm.is_owner(p uuid) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from pm.projects where id=p and owner_id=pm.owner_id())
$$;
revoke all on all functions in schema pm from public,anon,authenticated;
grant execute on all functions in schema pm to partmeasure_runtime,partmeasure_worker;

alter table pm.projects enable row level security;
create policy project_read on pm.projects for select to partmeasure_runtime using(owner_id=pm.owner_id() or pm.can_read(id));
create policy project_create on pm.projects for insert to partmeasure_runtime with check(owner_id=pm.owner_id());
create policy project_update on pm.projects for update to partmeasure_runtime using(owner_id=pm.owner_id() or pm.can_read(id)) with check(owner_id=pm.owner_id());
-- Runtime is trusted DAL, not browser: capability lookups need digests before project scope is known.
alter table pm.share_links enable row level security;
create policy share_lookup on pm.share_links for select to partmeasure_runtime using(true);
create policy share_create on pm.share_links for insert to partmeasure_runtime with check(pm.is_owner(project_id));
create policy share_update on pm.share_links for update to partmeasure_runtime using(pm.is_owner(project_id) or token_hash=nullif(current_setting('pm.link_hash',true),'') or pm.can_read(project_id)) with check(pm.is_owner(project_id));
alter table pm.guest_sessions enable row level security;
create policy session_lookup on pm.guest_sessions for select to partmeasure_runtime using(true);
create policy session_create on pm.guest_sessions for insert to partmeasure_runtime with check(exists(
 select 1 from pm.share_links l where l.id=guest_sessions.share_id and l.project_id=guest_sessions.project_id
 and l.token_hash=nullif(current_setting('pm.link_hash',true),'') and l.revoked_at is null and l.expires_at>now()));

do $$ declare t text; begin
 foreach t in array array['upload_reservations','file_assets','audit_events'] loop
 execute format('alter table pm.%I enable row level security',t);
 execute format('create policy scoped_read on pm.%I for select to partmeasure_runtime using(pm.is_owner(project_id) or pm.can_read(project_id))',t);
 end loop;
end $$;
create policy reserve_create on pm.upload_reservations for insert to partmeasure_runtime with check(pm.is_owner(project_id) or pm.can_read(project_id));
create policy reserve_update on pm.upload_reservations for update to partmeasure_runtime using(pm.is_owner(project_id) or pm.can_read(project_id)) with check(pm.is_owner(project_id) or pm.can_read(project_id));
create policy asset_update on pm.file_assets for update to partmeasure_runtime using(pm.is_owner(project_id)) with check(pm.is_owner(project_id));
create policy audit_create on pm.audit_events for insert to partmeasure_runtime with check(pm.is_owner(project_id) or pm.can_read(project_id));
alter table pm.jobs enable row level security;
create policy jobs_create on pm.jobs for insert to partmeasure_runtime with check(exists(select 1 from pm.upload_reservations r where r.id=reservation_id));
alter table pm.idempotency_keys enable row level security;
create policy idem_runtime on pm.idempotency_keys to partmeasure_runtime using(true) with check(true);
alter table pm.rate_limits enable row level security;
create policy limits_runtime on pm.rate_limits to partmeasure_runtime using(true) with check(true);
do $$ declare t text; begin
 foreach t in array array['projects','share_links','guest_sessions','upload_reservations','file_assets','jobs','idempotency_keys','rate_limits','audit_events'] loop
 execute format('create policy worker_access on pm.%I to partmeasure_worker using(true) with check(true)',t);
 end loop;
end $$;
grant select,insert on pm.projects,pm.share_links,pm.guest_sessions,pm.upload_reservations,pm.audit_events to partmeasure_runtime;
grant update on pm.projects,pm.share_links,pm.upload_reservations,pm.file_assets to partmeasure_runtime;
grant select on pm.file_assets to partmeasure_runtime;
grant insert on pm.jobs to partmeasure_runtime;
grant select,insert,update on pm.idempotency_keys,pm.rate_limits to partmeasure_runtime;
grant select on all tables in schema pm to partmeasure_worker;
grant update on pm.projects,pm.upload_reservations,pm.jobs to partmeasure_worker;
grant insert on pm.file_assets,pm.audit_events to partmeasure_worker;

-- History protection is enforced in DB even if a later DAL forgets to check it.
create function pm.protect_asset() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if old.history_protected and new.deleted_at is distinct from old.deleted_at then raise exception 'HISTORY_PROTECTED' using errcode='23514'; end if;
 if (new.storage_key,new.original_key,new.project_id,new.reservation_id,new.sha256,new.original_sha256) is distinct from
 (old.storage_key,old.original_key,old.project_id,old.reservation_id,old.sha256,old.original_sha256) then raise exception 'IMMUTABLE_ASSET'; end if;
 return new;
end $$;
revoke all on function pm.protect_asset() from public;
create trigger immutable_asset before update on pm.file_assets for each row execute function pm.protect_asset();
insert into storage.buckets(id,name,public,file_size_limit) values('partmeasure-quarantine','partmeasure-quarantine',false,104857600),('partmeasure-private','partmeasure-private',false,104857600);
-- No policies/grants for browser roles on either bucket. Signed upload path only; secret stays server-side.
comment on schema pm is 'Private P0-1 DAL schema; not exposed in PostgREST; no business RPC.';
