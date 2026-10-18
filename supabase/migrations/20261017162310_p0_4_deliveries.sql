-- P0-4: additive, real Supabase schema only. No auth/Storage substitutes or P2 feedback.
alter table pm.upload_reservations add column purpose text not null default 'material' check(purpose in ('material','delivery'));
alter table pm.file_assets add column purpose text not null default 'material' check(purpose in ('material','delivery'));
drop index pm.reservation_dedupe;
create unique index reservation_dedupe on pm.upload_reservations(project_id,purpose,sha256,byte_size) where state in ('reserved','queued','processing','ready');
create index assets_purpose on pm.file_assets(project_id,purpose,created_at desc,id);

create table pm.deliveries(
 id uuid primary key default gen_random_uuid(),project_id uuid not null references pm.projects(id),
 description text not null default '' check(length(description)<=4000),revision integer not null default 1 check(revision>0),
 state text not null default 'draft' check(state in ('draft','published')),version_no integer check(version_no>0),
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 published_by uuid references auth.users(id),published_at timestamptz,
 unique(project_id,id),unique(project_id,version_no),
 check((state='draft' and version_no is null and published_by is null and published_at is null) or
 (state='published' and version_no is not null and published_by is not null and published_at is not null))
);
create index deliveries_list on pm.deliveries(project_id,state,created_at desc,id);
create index deliveries_creator on pm.deliveries(created_by);
create index deliveries_publisher on pm.deliveries(published_by) where published_by is not null;
create table pm.delivery_files(
 project_id uuid not null,delivery_id uuid not null,file_id uuid not null,
 position integer not null check(position between 1 and 20),selected boolean not null default true,created_at timestamptz not null default now(),
 primary key(delivery_id,file_id),foreign key(project_id,delivery_id) references pm.deliveries(project_id,id),
 foreign key(project_id,file_id) references pm.file_assets(project_id,id)
);
create unique index delivery_file_order on pm.delivery_files(delivery_id,position) where selected;
create index delivery_files_scope on pm.delivery_files(project_id,delivery_id);
create index delivery_files_asset on pm.delivery_files(project_id,file_id);

alter table pm.deliveries enable row level security;
alter table pm.delivery_files enable row level security;
create policy deliveries_read on pm.deliveries for select to partmeasure_runtime using(pm.is_owner(project_id) or (state='published' and pm.can_read(project_id)));
create policy deliveries_create on pm.deliveries for insert to partmeasure_runtime with check(pm.is_owner(project_id) and created_by=(select pm.owner_id()));
create policy deliveries_update on pm.deliveries for update to partmeasure_runtime using(pm.is_owner(project_id)) with check(pm.is_owner(project_id));
create policy delivery_files_read on pm.delivery_files for select to partmeasure_runtime using(exists(select 1 from pm.deliveries d where d.project_id=delivery_files.project_id and d.id=delivery_id and (pm.is_owner(d.project_id) or (d.state='published' and delivery_files.selected))));
create policy delivery_files_insert on pm.delivery_files for insert to partmeasure_runtime with check(pm.is_owner(project_id));
create policy delivery_files_update on pm.delivery_files for update to partmeasure_runtime using(pm.is_owner(project_id)) with check(pm.is_owner(project_id));
grant select,insert on pm.deliveries,pm.delivery_files to partmeasure_runtime;
grant update(description,revision,state,version_no,published_by,published_at,updated_at) on pm.deliveries to partmeasure_runtime;
grant update(selected,position) on pm.delivery_files to partmeasure_runtime;

create function pm.check_delivery() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'IMMUTABLE_DELIVERY' using errcode='23514'; end if;
 if not pm.is_owner(new.project_id) then raise exception 'DELIVERY_OWNER_REQUIRED' using errcode='42501'; end if;
 if tg_op='INSERT' then
  if new.state<>'draft' or new.revision<>1 or new.created_by is distinct from pm.owner_id() then raise exception 'DRAFT_REQUIRED' using errcode='23514'; end if;
  return new;
 end if;
 if old.state='published' then raise exception 'IMMUTABLE_DELIVERY' using errcode='23514'; end if;
 if (new.id,new.project_id,new.created_by,new.created_at) is distinct from (old.id,old.project_id,old.created_by,old.created_at) or new.revision<>old.revision+1 then raise exception 'INVALID_DELIVERY_REVISION' using errcode='23514'; end if;
 if new.state='published' then
  if new.description is distinct from old.description or new.published_by is distinct from pm.owner_id() or new.version_no is distinct from (select coalesce(max(version_no),0)+1 from pm.deliveries where project_id=new.project_id) then raise exception 'INVALID_PUBLICATION' using errcode='23514'; end if;
 end if;
 return new;
end $$;
create function pm.check_delivery_file() returns trigger language plpgsql security invoker set search_path='' as $$
declare p uuid;d uuid;
begin
 if tg_op='DELETE' then raise exception 'IMMUTABLE_DELIVERY_FILE' using errcode='23514'; end if;
 p:=new.project_id;d:=new.delivery_id;
 if not pm.is_owner(p) or not exists(select 1 from pm.deliveries where project_id=p and id=d and state='draft') then raise exception 'IMMUTABLE_DELIVERY_FILE' using errcode='23514'; end if;
 if tg_op='UPDATE' and (new.project_id,new.delivery_id,new.file_id,new.created_at) is distinct from (old.project_id,old.delivery_id,old.file_id,old.created_at) then raise exception 'IMMUTABLE_DELIVERY_FILE' using errcode='23514'; end if;
 if not exists(select 1 from pm.file_assets f join pm.upload_reservations r on r.id=f.reservation_id and r.project_id=f.project_id where f.project_id=p and f.id=new.file_id and f.purpose='delivery' and f.uploader_type='owner' and f.deleted_at is null and r.state='ready' and r.purpose='delivery') then raise exception 'INVALID_DELIVERY_FILE' using errcode='23514'; end if;
 return new;
end $$;
create function pm.check_publication_complete() returns trigger language plpgsql security invoker set search_path='' as $$
declare p uuid;d uuid;n integer;
begin
 p:=new.project_id;
 if tg_table_name='deliveries' then d:=new.id; else d:=new.delivery_id; end if;
 if exists(select 1 from pm.deliveries where project_id=p and id=d and state='published') then
  select count(*) into n from pm.delivery_files where project_id=p and delivery_id=d and selected;
  if n<1 or n>20 or exists(select 1 from pm.delivery_files a join pm.file_assets f on f.id=a.file_id and f.project_id=a.project_id join pm.upload_reservations r on r.id=f.reservation_id where a.project_id=p and a.delivery_id=d and a.selected and (f.purpose<>'delivery' or f.uploader_type<>'owner' or f.deleted_at is not null or not f.history_protected or f.visibility<>'customer' or r.state<>'ready')) then raise exception 'ATOMIC_PUBLICATION_REQUIRED' using errcode='23514'; end if;
 end if;
 return new;
end $$;
create trigger delivery_validate before insert or update or delete on pm.deliveries for each row execute function pm.check_delivery();
create trigger delivery_file_validate before insert or update or delete on pm.delivery_files for each row execute function pm.check_delivery_file();
create constraint trigger publication_complete after insert or update on pm.deliveries deferrable initially deferred for each row execute function pm.check_publication_complete();
create constraint trigger publication_files_complete after insert or update on pm.delivery_files deferrable initially deferred for each row execute function pm.check_publication_complete();

create function pm.check_upload_purpose() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='UPDATE' and (new.purpose,new.actor_key,new.share_id,new.project_id) is distinct from (old.purpose,old.actor_key,old.share_id,old.project_id) then raise exception 'IMMUTABLE_UPLOAD_PURPOSE' using errcode='23514'; end if;
 if tg_op='INSERT' and new.purpose='delivery' and (not pm.is_owner(new.project_id) or new.share_id is not null or new.actor_key is distinct from 'owner:'||pm.owner_id()::text) then raise exception 'DELIVERY_OWNER_REQUIRED' using errcode='42501'; end if;
 return new;
end $$;
create function pm.check_asset_purpose() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='UPDATE' then
  if new.purpose is distinct from old.purpose then raise exception 'IMMUTABLE_ASSET_PURPOSE' using errcode='23514'; end if;
  if old.purpose='delivery' and old.history_protected and new is distinct from old then raise exception 'IMMUTABLE_DELIVERY_ASSET' using errcode='23514'; end if;
 end if;
 if tg_op='INSERT' and not exists(select 1 from pm.upload_reservations r where r.id=new.reservation_id and r.project_id=new.project_id and r.purpose=new.purpose and (new.purpose='material' or (r.share_id is null and new.uploader_type='owner' and new.visibility='internal'))) then raise exception 'INVALID_ASSET_PURPOSE' using errcode='23514'; end if;
 if new.purpose='delivery' and new.visibility='customer' and not exists(select 1 from pm.delivery_files a join pm.deliveries d on d.id=a.delivery_id and d.project_id=a.project_id where a.file_id=new.id and a.project_id=new.project_id and a.selected and d.state='published') then raise exception 'UNPUBLISHED_ASSET' using errcode='23514'; end if;
 return new;
end $$;
create trigger upload_purpose before insert or update on pm.upload_reservations for each row execute function pm.check_upload_purpose();
create trigger asset_purpose before insert or update on pm.file_assets for each row execute function pm.check_asset_purpose();
create function pm.require_material_file() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from pm.file_assets where project_id=new.project_id and id=new.file_id and purpose='material') then raise exception 'MATERIAL_FILE_REQUIRED' using errcode='23514'; end if;
 return new;
end $$;
create trigger annotation_material before insert on pm.annotations for each row execute function pm.require_material_file();
create trigger issue_material before insert on pm.issues for each row execute function pm.require_material_file();
create trigger evidence_material before insert on pm.response_attachments for each row execute function pm.require_material_file();
revoke all on function pm.check_delivery(),pm.check_delivery_file(),pm.check_publication_complete(),pm.check_upload_purpose(),pm.check_asset_purpose(),pm.require_material_file() from public,anon,authenticated;
