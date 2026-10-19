-- Keep private folder and internal-file activity out of Guest cursors.
create or replace function pm.record_project_change() returns trigger language plpgsql security invoker set search_path='' as $$
declare j jsonb:=to_jsonb(new); p uuid; e uuid; f uuid; k text; shared boolean:=true; r integer; s text;
begin
 p:=coalesce((j->>'project_id')::uuid,(j->>'id')::uuid); e:=(j->>'id')::uuid;
 r:=(j->>'revision')::integer; s:=j->>'state'; f:=(j->>'file_id')::uuid;
 if tg_table_name='projects' then
  if tg_op='INSERT' then insert into pm.project_event_cursors(project_id) values(p); end if;
  if tg_op='UPDATE' and (new.name,new.description,new.folder_id) is not distinct from (old.name,old.description,old.folder_id) then return new; end if;
  k:='project.changed';
  if tg_op='UPDATE' then shared:=(new.name,new.description) is distinct from (old.name,old.description); end if;
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

create or replace function pm.record_derivative_change() returns trigger language plpgsql security invoker set search_path='' as $$
declare shared boolean;
begin
 select exists(select 1 from pm.file_assets where project_id=new.project_id and id=new.file_id and visibility='customer' and deleted_at is null and purpose='material') into shared;
 perform pm.emit_project_event(new.project_id,'file.changed',new.file_id,new.file_id,null,'ready',shared); return new;
end $$;
