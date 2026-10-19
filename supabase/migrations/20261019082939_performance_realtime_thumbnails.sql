-- Isolated-test target only. No Auth/Storage stand-ins, public grants or definer functions.
create table pm.project_event_cursors (
 project_id uuid primary key references pm.projects(id),
 owner_seq bigint not null default 0 check(owner_seq>=0), guest_seq bigint not null default 0 check(guest_seq>=0),
 owner_floor bigint not null default 0, guest_floor bigint not null default 0
);
insert into pm.project_event_cursors(project_id) select id from pm.projects;
create table pm.project_events (
 project_id uuid not null references pm.project_event_cursors(project_id),
 owner_seq bigint not null, guest_seq bigint,
 kind text not null check(kind in ('project.changed','access.changed','file.changed','annotation.changed','issue.changed','delivery.changed','upload.changed')),
 entity_id uuid not null, file_id uuid, revision integer, state text,
 created_at timestamptz not null default clock_timestamp(), primary key(project_id,owner_seq),
 unique(project_id,guest_seq)
);
create index project_events_expiry on pm.project_events(created_at);
alter table pm.project_event_cursors enable row level security;
alter table pm.project_events enable row level security;
create policy cursor_read on pm.project_event_cursors for select to partmeasure_runtime using(pm.is_owner(project_id) or pm.can_read(project_id));
create policy cursor_create on pm.project_event_cursors for insert to partmeasure_runtime with check(pm.is_owner(project_id) or pm.can_read(project_id));
create policy cursor_write on pm.project_event_cursors for update to partmeasure_runtime using(pm.is_owner(project_id) or pm.can_read(project_id)) with check(pm.is_owner(project_id) or pm.can_read(project_id));
create policy cursor_worker on pm.project_event_cursors for all to partmeasure_worker using(true) with check(true);
create policy event_read on pm.project_events for select to partmeasure_runtime using(pm.is_owner(project_id) or (guest_seq is not null and pm.can_read(project_id)));
create policy event_create on pm.project_events for insert to partmeasure_runtime with check(pm.is_owner(project_id) or (guest_seq is not null and pm.can_read(project_id)));
create policy event_worker on pm.project_events for all to partmeasure_worker using(true) with check(true);
grant select,insert,update on pm.project_event_cursors to partmeasure_runtime,partmeasure_worker;
grant select,insert on pm.project_events to partmeasure_runtime;
grant select,insert,delete on pm.project_events to partmeasure_worker;

create function pm.emit_project_event(p uuid,k text,e uuid,f uuid,r integer,s text,shared boolean) returns void
language plpgsql security invoker set search_path='' as $$
declare o bigint; g bigint;
begin
 -- This row lock serializes commit order per project, without a global sequence.
 update pm.project_event_cursors set owner_seq=owner_seq+1,guest_seq=guest_seq+case when shared then 1 else 0 end
 where project_id=p returning owner_seq,guest_seq into o,g;
 if not found then raise exception 'EVENT_CURSOR_MISSING' using errcode='23514'; end if;
 insert into pm.project_events(project_id,owner_seq,guest_seq,kind,entity_id,file_id,revision,state)
 values(p,o,case when shared then g else null end,k,e,f,r,s);
 -- Notification contains no business data. PostgreSQL delivers it only on commit.
 perform pg_catalog.pg_notify('pm_project_events',p::text);
end $$;
revoke all on function pm.emit_project_event(uuid,text,uuid,uuid,integer,text,boolean) from public,anon,authenticated;
grant execute on function pm.emit_project_event(uuid,text,uuid,uuid,integer,text,boolean) to partmeasure_runtime,partmeasure_worker;

create function pm.record_project_change() returns trigger language plpgsql security invoker set search_path='' as $$
declare j jsonb:=to_jsonb(new); p uuid; e uuid; f uuid; k text; shared boolean:=true; r integer; s text;
begin
 p:=coalesce((j->>'project_id')::uuid,(j->>'id')::uuid); e:=(j->>'id')::uuid;
 r:=(j->>'revision')::integer; s:=j->>'state'; f:=(j->>'file_id')::uuid;
 if tg_table_name='projects' then
  if tg_op='INSERT' then insert into pm.project_event_cursors(project_id) values(p); end if;
  if tg_op='UPDATE' and (new.name,new.description,new.folder_id) is not distinct from (old.name,old.description,old.folder_id) then return new; end if;
  k:='project.changed';
 elsif tg_table_name='share_links' then k:='access.changed'; e:=p;
 elsif tg_table_name='file_assets' then
  if tg_op='UPDATE' and (new.deleted_at,new.visibility) is not distinct from (old.deleted_at,old.visibility) then return new; end if;
  k:='file.changed'; f:=e; shared:=(j->>'visibility'='customer');
 elsif tg_table_name='annotations' then k:='annotation.changed';
 elsif tg_table_name='issues' then k:='issue.changed';
 elsif tg_table_name='deliveries' then k:='delivery.changed'; shared:=(s='published');
 elsif tg_table_name='upload_reservations' then
  if tg_op='UPDATE' and (new.state,new.error_code) is not distinct from (old.state,old.error_code) then return new; end if;
  k:='upload.changed'; shared:=(j->>'purpose'='material');
 else raise exception 'INVALID_EVENT_SOURCE'; end if;
 perform pm.emit_project_event(p,k,e,f,r,s,shared); return new;
end $$;
revoke all on function pm.record_project_change() from public,anon,authenticated;
grant execute on function pm.record_project_change() to partmeasure_runtime,partmeasure_worker;
create trigger project_events after insert or update of name,description,folder_id on pm.projects for each row execute function pm.record_project_change();
create trigger share_events after insert or update of revoked_at on pm.share_links for each row execute function pm.record_project_change();
create trigger file_events after insert or update of deleted_at,visibility on pm.file_assets for each row execute function pm.record_project_change();
create trigger annotation_events after insert or update on pm.annotations for each row execute function pm.record_project_change();
create trigger issue_events after insert or update on pm.issues for each row execute function pm.record_project_change();
create trigger delivery_events after insert or update on pm.deliveries for each row execute function pm.record_project_change();
create trigger upload_events after insert or update of state,error_code on pm.upload_reservations for each row execute function pm.record_project_change();

create table pm.image_derivatives (
 project_id uuid not null, file_id uuid not null, variant integer not null check(variant in (320,640)),
 storage_key text not null unique, sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
 image_hash text not null, byte_size bigint not null check(byte_size>0 and byte_size<=262144),
 width integer not null check(width>0),height integer not null check(height>0),
 created_at timestamptz not null default now(), primary key(file_id,variant),
 foreign key(project_id,file_id) references pm.file_assets(project_id,id), check(width<=variant and height<=variant)
);
alter table pm.image_derivatives enable row level security;
create policy derivative_read on pm.image_derivatives for select to partmeasure_runtime using(exists(
 select 1 from pm.file_assets f where f.project_id=image_derivatives.project_id and f.id=image_derivatives.file_id
 and f.deleted_at is null and f.purpose='material' and (pm.is_owner(f.project_id) or (f.visibility='customer' and pm.can_read(f.project_id)))
));
create policy derivative_worker_read on pm.image_derivatives for select to partmeasure_worker using(true);
create policy derivative_worker_insert on pm.image_derivatives for insert to partmeasure_worker with check(exists(
 select 1 from pm.file_assets f where f.project_id=image_derivatives.project_id and f.id=image_derivatives.file_id and f.deleted_at is null
 and f.purpose='material' and f.mime='image/webp' and f.sha256=image_hash and f.normalization_version=1
 and image_derivatives.width<=f.width and image_derivatives.height<=f.height
));
grant select on pm.image_derivatives to partmeasure_runtime,partmeasure_worker;
grant insert on pm.image_derivatives to partmeasure_worker;
create function pm.record_derivative_change() returns trigger language plpgsql security invoker set search_path='' as $$
begin perform pm.emit_project_event(new.project_id,'file.changed',new.file_id,new.file_id,null,'ready',true); return new; end $$;
revoke all on function pm.record_derivative_change() from public,anon,authenticated;
grant execute on function pm.record_derivative_change() to partmeasure_worker;
create trigger derivative_events after insert on pm.image_derivatives for each row execute function pm.record_derivative_change();

create table pm.thumbnail_jobs (
 file_id uuid primary key, project_id uuid not null,
 state text not null default 'queued' check(state in ('queued','processing','ready','cleanup','dead')),
 reserved_bytes bigint not null default 0 check(reserved_bytes between 0 and 524288),
 attempts integer not null default 0, lease_token uuid, lease_until timestamptz,
 next_at timestamptz not null default now(),error_code text,
 foreign key(project_id,file_id) references pm.file_assets(project_id,id)
);
alter table pm.thumbnail_jobs enable row level security;
create policy thumbnail_job_worker on pm.thumbnail_jobs for all to partmeasure_worker using(true) with check(true);
create policy thumbnail_budget_read on pm.thumbnail_jobs for select to partmeasure_runtime using(pm.is_owner(project_id) or pm.can_read(project_id));
grant select on pm.thumbnail_jobs to partmeasure_runtime;
grant select,insert,update on pm.thumbnail_jobs to partmeasure_worker;
create index thumbnail_jobs_due on pm.thumbnail_jobs(next_at) where state in ('queued','processing','cleanup');
insert into pm.thumbnail_jobs(project_id,file_id) select project_id,id from pm.file_assets where mime='image/webp' and purpose='material' and deleted_at is null;
create function pm.wake_file_worker() returns trigger language plpgsql security invoker set search_path='' as $$
begin perform pg_catalog.pg_notify('pm_file_jobs',''); return new; end $$;
revoke all on function pm.wake_file_worker() from public,anon,authenticated;
grant execute on function pm.wake_file_worker() to partmeasure_runtime,partmeasure_worker;
create trigger wake_file_worker after insert or update of next_at on pm.jobs for each row execute function pm.wake_file_worker();
