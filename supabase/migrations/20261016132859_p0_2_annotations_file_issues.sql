-- P0-2 only: private-schema annotations with append-only revisions; comment issues, no replies/workflow.
create function pm.valid_annotation_geometry(g jsonb,w integer,h integer) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare t text; p jsonb; x double precision; y double precision; rx double precision; ry double precision;
begin
 if jsonb_typeof(g)<>'object' or w<=0 or h<=0 then return false; end if;
 t:=g->>'type';
 if t not in ('line','circle','point','text') or t is null then return false; end if;
 if (t='line' and (g-array['type','from','to'])<>'{}') or
    (t='circle' and (g-array['type','center','radiusX','radiusY'])<>'{}') or
    (t='point' and (g-array['type','at'])<>'{}') or
    (t='text' and (g-array['type','at','text'])<>'{}') then return false; end if;
 for p in select value from jsonb_array_elements(case when t='line' then jsonb_build_array(g->'from',g->'to') when t='circle' then jsonb_build_array(g->'center') else jsonb_build_array(g->'at') end) loop
  if jsonb_typeof(p) is distinct from 'object' or (p-array['x','y'])<>'{}' or jsonb_typeof(p->'x') is distinct from 'number' or jsonb_typeof(p->'y') is distinct from 'number' then return false; end if;
  x:=(p->>'x')::double precision; y:=(p->>'y')::double precision;
  if not(x>=0 and x<=1 and y>=0 and y<=1) then return false; end if;
 end loop;
 if t='line' then
  return sqrt(power(((g->'from'->>'x')::double precision-(g->'to'->>'x')::double precision)*w,2)+power(((g->'from'->>'y')::double precision-(g->'to'->>'y')::double precision)*h,2))>=0.5;
 elsif t='circle' then
  if jsonb_typeof(g->'radiusX') is distinct from 'number' or jsonb_typeof(g->'radiusY') is distinct from 'number' then return false; end if;
  rx:=(g->>'radiusX')::double precision;ry:=(g->>'radiusY')::double precision;
  return rx*w>=0.5 and ry>0 and abs(rx*w-ry*h)<=0.5 and x-rx>=0 and x+rx<=1 and y-ry>=0 and y+ry<=1;
 elsif t='text' then return jsonb_typeof(g->'text')='string' and length(btrim(g->>'text')) between 1 and 500;
 end if;
 return true;
exception when others then return false;
end $$;
revoke all on function pm.valid_annotation_geometry(jsonb,integer,integer) from public,anon,authenticated;
grant execute on function pm.valid_annotation_geometry(jsonb,integer,integer) to partmeasure_runtime;

create table pm.annotations(
 id uuid primary key, project_id uuid not null, file_id uuid not null,
 image_hash text not null check(image_hash ~ '^[a-f0-9]{64}$'), normalization_version integer not null check(normalization_version=1),
 schema_version integer not null default 1 check(schema_version=1), geometry jsonb not null,
 metadata jsonb not null check((jsonb_typeof(metadata)='object' and octet_length(metadata::text)<=16384 and metadata->>'source'='human') is true),
 revision integer not null check(revision>0), deleted_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(project_id,file_id,id), foreign key(project_id,file_id) references pm.file_assets(project_id,id)
);
create index annotations_file on pm.annotations(project_id,file_id);
create table pm.annotation_revisions(
 project_id uuid not null, file_id uuid not null, annotation_id uuid not null, revision integer not null check(revision>0),
 geometry jsonb not null, metadata jsonb not null, deleted boolean not null,
 created_by uuid not null references auth.users(id), created_at timestamptz not null default now(),
 primary key(annotation_id,revision), unique(project_id,file_id,annotation_id,revision),
 foreign key(project_id,file_id,annotation_id) references pm.annotations(project_id,file_id,id)
);
create index annotation_revisions_file on pm.annotation_revisions(project_id,file_id,annotation_id,revision desc);
create index annotation_revisions_actor on pm.annotation_revisions(created_by);
create table pm.issues(
 id uuid primary key default gen_random_uuid(),project_id uuid not null,file_id uuid not null,
 kind text not null default 'comment' check(kind='comment'), title text not null check(length(btrim(title)) between 1 and 120),
 description text not null default '' check(length(description)<=4000), created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),unique(project_id,id),
 foreign key(project_id,file_id) references pm.file_assets(project_id,id)
);
create index issues_file on pm.issues(project_id,file_id,created_at desc,id);
create index issues_actor on pm.issues(created_by);

create function pm.check_annotation() returns trigger language plpgsql security invoker set search_path='' as $$
declare f record;
begin
 select mime,width,height,sha256,normalization_version,deleted_at into f from pm.file_assets where id=new.file_id and project_id=new.project_id;
 if not found or f.deleted_at is not null or f.mime<>'image/webp' or f.normalization_version<>1 or f.width is null or f.height is null or f.sha256<>new.image_hash then raise exception 'IMAGE_NOT_READY' using errcode='23514'; end if;
 if pm.valid_annotation_geometry(new.geometry,f.width,f.height) is distinct from true then raise exception 'INVALID_GEOMETRY' using errcode='23514'; end if;
 if tg_op='UPDATE' then
  if (new.id,new.project_id,new.file_id,new.image_hash,new.normalization_version,new.schema_version,new.created_at) is distinct from (old.id,old.project_id,old.file_id,old.image_hash,old.normalization_version,old.schema_version,old.created_at) then raise exception 'IMMUTABLE_ANNOTATION_TARGET' using errcode='23514'; end if;
  if new.revision<>old.revision+1 then raise exception 'REVISION_REQUIRED' using errcode='23514'; end if;
 elsif new.revision<>1 then raise exception 'REVISION_REQUIRED' using errcode='23514'; end if;
 return new;
end $$;
create function pm.record_annotation_revision() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 insert into pm.annotation_revisions(project_id,file_id,annotation_id,revision,geometry,metadata,deleted,created_by)
 values(new.project_id,new.file_id,new.id,new.revision,new.geometry,new.metadata,new.deleted_at is not null,pm.owner_id());
 update pm.file_assets set history_protected=true where id=new.file_id and project_id=new.project_id and not history_protected;
 return new;
end $$;
create function pm.protect_issue_file() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.created_by is distinct from pm.owner_id() or not exists(select 1 from pm.file_assets where id=new.file_id and project_id=new.project_id and deleted_at is null) then raise exception 'INVALID_ISSUE_FILE' using errcode='23514'; end if;
 update pm.file_assets set history_protected=true where id=new.file_id and project_id=new.project_id and not history_protected;
 return new;
end $$;
create function pm.reject_history_mutation() returns trigger language plpgsql security invoker set search_path='' as $$
begin raise exception 'IMMUTABLE_HISTORY' using errcode='23514'; end $$;
create function pm.check_revision_snapshot() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from pm.annotations a where a.id=new.annotation_id and a.project_id=new.project_id and a.file_id=new.file_id and a.revision=new.revision and a.geometry=new.geometry and a.metadata=new.metadata and (a.deleted_at is not null)=new.deleted) then raise exception 'INVALID_REVISION_SNAPSHOT' using errcode='23514'; end if;
 return new;
end $$;
create or replace function pm.protect_asset() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if old.history_protected and new.deleted_at is distinct from old.deleted_at then raise exception 'HISTORY_PROTECTED' using errcode='23514'; end if;
 if (new.storage_key,new.original_key,new.project_id,new.reservation_id,new.sha256,new.original_sha256,new.width,new.height,new.normalization_version,new.mime,new.byte_size,new.original_bytes) is distinct from
 (old.storage_key,old.original_key,old.project_id,old.reservation_id,old.sha256,old.original_sha256,old.width,old.height,old.normalization_version,old.mime,old.byte_size,old.original_bytes) then raise exception 'IMMUTABLE_ASSET' using errcode='23514'; end if;
 return new;
end $$;
revoke all on function pm.check_revision_snapshot() from public,anon,authenticated;
revoke all on function pm.check_annotation(),pm.record_annotation_revision(),pm.protect_issue_file(),pm.reject_history_mutation() from public,anon,authenticated;
create trigger annotation_validate before insert or update on pm.annotations for each row execute function pm.check_annotation();
create trigger annotation_revision after insert or update on pm.annotations for each row execute function pm.record_annotation_revision();
create trigger revisions_immutable before update or delete on pm.annotation_revisions for each row execute function pm.reject_history_mutation();
create trigger revision_snapshot before insert on pm.annotation_revisions for each row execute function pm.check_revision_snapshot();
create trigger issues_immutable before update or delete on pm.issues for each row execute function pm.reject_history_mutation();
create trigger issues_protect before insert on pm.issues for each row execute function pm.protect_issue_file();

alter table pm.annotations enable row level security;
alter table pm.annotation_revisions enable row level security;
alter table pm.issues enable row level security;
create policy annotation_read on pm.annotations for select to partmeasure_runtime using(
 (pm.is_owner(project_id) or (deleted_at is null and pm.can_read(project_id))) and exists(select 1 from pm.file_assets f where f.id=file_id and f.project_id=annotations.project_id and f.deleted_at is null));
create policy annotation_insert on pm.annotations for insert to partmeasure_runtime with check(pm.is_owner(project_id));
create policy annotation_update on pm.annotations for update to partmeasure_runtime using(pm.is_owner(project_id)) with check(pm.is_owner(project_id));
create policy revision_read on pm.annotation_revisions for select to partmeasure_runtime using(pm.is_owner(project_id));
create policy revision_insert on pm.annotation_revisions for insert to partmeasure_runtime with check(pm.is_owner(project_id) and created_by=(select pm.owner_id()));
create policy issue_read on pm.issues for select to partmeasure_runtime using(
 (pm.is_owner(project_id) or pm.can_read(project_id)) and exists(select 1 from pm.file_assets f where f.id=file_id and f.project_id=issues.project_id and f.deleted_at is null));
create policy issue_insert on pm.issues for insert to partmeasure_runtime with check(pm.is_owner(project_id) and created_by=(select pm.owner_id()));
grant select,insert,update on pm.annotations to partmeasure_runtime;
grant select,insert on pm.annotation_revisions,pm.issues to partmeasure_runtime;
-- No browser, worker, DELETE, or history UPDATE grants. No new definer or public RPC.
