-- P2-03: reversible archive, no file/history deletion. Isolated project only.
alter table pm.projects add column archived_at timestamptz;
grant update(archived_at) on pm.projects to partmeasure_runtime;
create index projects_archive_list on pm.projects(owner_id,(archived_at is null),created_at desc,id desc);
create index assets_name_list on pm.file_assets(project_id,purpose,(lower(filename) collate "C"),id) where deleted_at is null;

create function pm.guard_archived_project() returns trigger language plpgsql security invoker set search_path='' as $$
declare archived timestamptz;
begin
 if current_user<>'partmeasure_runtime' then return new; end if;
 select archived_at into archived from pm.projects where id=new.project_id for share;
 if archived is null then return new; end if;
 -- Revoking an existing link remains available. Creating/extending links does not.
 if tg_table_name='share_links' and tg_op='UPDATE' then
  if new.revoked_at is not null and (new.id,new.project_id,new.token_hash,new.expires_at,new.created_at)
   is not distinct from (old.id,old.project_id,old.token_hash,old.expires_at,old.created_at) then return new; end if;
 end if;
 raise exception 'PROJECT_ARCHIVED' using errcode='55000';
end $$;
revoke all on function pm.guard_archived_project() from public,anon,authenticated;
grant execute on function pm.guard_archived_project() to partmeasure_runtime;
do $$ declare t text; begin
 foreach t in array array['share_links','upload_reservations','file_assets','annotations','annotation_revisions','issues','issue_responses','response_attachments','issue_reviews','deliveries','delivery_files','delivery_feedback'] loop
 execute format('create trigger archive_write_guard before insert or update on pm.%I for each row execute function pm.guard_archived_project()',t);
 end loop;
end $$;

create function pm.guard_project_archive() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.archived_at is distinct from old.archived_at and not pm.is_owner(old.id) then
  raise exception 'ARCHIVE_OWNER_REQUIRED' using errcode='42501';
 end if;
 if old.archived_at is not null and (new.name,new.description,new.folder_id) is distinct from (old.name,old.description,old.folder_id) then
  raise exception 'PROJECT_ARCHIVED' using errcode='55000';
 end if;
 return new;
end $$;
revoke all on function pm.guard_project_archive() from public,anon,authenticated;
grant execute on function pm.guard_project_archive() to partmeasure_runtime;
create trigger project_archive_guard before update on pm.projects for each row execute function pm.guard_project_archive();

create or replace function pm.record_project_change() returns trigger language plpgsql security invoker set search_path='' as $$
declare j jsonb:=to_jsonb(new); p uuid; e uuid; f uuid; k text; shared boolean:=true; r integer; s text;
begin
 p:=coalesce((j->>'project_id')::uuid,(j->>'id')::uuid); e:=(j->>'id')::uuid;
 r:=(j->>'revision')::integer; s:=j->>'state'; f:=(j->>'file_id')::uuid;
 if tg_table_name='projects' then
  if tg_op='INSERT' then insert into pm.project_event_cursors(project_id) values(p); end if;
  if tg_op='UPDATE' and (new.name,new.description,new.folder_id,new.archived_at) is not distinct from (old.name,old.description,old.folder_id,old.archived_at) then return new; end if;
  k:='project.changed'; s:=null;
  if tg_op='INSERT' then s:='active';
  elsif new.archived_at is distinct from old.archived_at then s:=case when new.archived_at is null then 'active' else 'archived' end;
  end if;
  if tg_op='UPDATE' then shared:=(new.name,new.description,new.archived_at) is distinct from (old.name,old.description,old.archived_at); end if;
 elsif tg_table_name='share_links' then k:='access.changed'; e:=p;
 elsif tg_table_name='file_assets' then
  if tg_op='UPDATE' and (new.deleted_at,new.visibility) is not distinct from (old.deleted_at,old.visibility) then return new; end if;
  k:='file.changed'; f:=e; shared:=(j->>'visibility'='customer');
  if tg_op='UPDATE' then shared:=shared or old.visibility='customer'; end if;
  s:=case when j->>'deleted_at' is not null then 'deleted' when j->>'visibility'='internal' then 'hidden' else 'ready' end;
 elsif tg_table_name='annotations' then k:='annotation.changed';
  shared:=exists(select 1 from pm.file_assets where project_id=p and id=f and visibility='customer' and deleted_at is null and purpose='material');
 elsif tg_table_name='issues' then k:='issue.changed';
  shared:=exists(select 1 from pm.file_assets where project_id=p and id=f and visibility='customer' and deleted_at is null and purpose='material');
 elsif tg_table_name='deliveries' then k:='delivery.changed'; shared:=(s='published');
 elsif tg_table_name='upload_reservations' then
  if tg_op='UPDATE' and (new.state,new.error_code) is not distinct from (old.state,old.error_code) then return new; end if;
  k:='upload.changed'; shared:=(j->>'purpose'='material');
 else raise exception 'INVALID_EVENT_SOURCE'; end if;
 perform pm.emit_project_event(p,k,e,f,r,s,shared); return new;
end $$;

drop trigger project_events on pm.projects;
create trigger project_events after insert or update of name,description,folder_id,archived_at on pm.projects for each row execute function pm.record_project_change();
