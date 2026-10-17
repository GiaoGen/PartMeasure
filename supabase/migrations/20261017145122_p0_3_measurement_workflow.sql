-- P0-3 only. Additive evolution of real P0-2 issues; no delivery, auth or Storage substitutes.
alter table pm.issues drop constraint issues_kind_check;
alter table pm.issues add constraint issues_kind_check check(kind in ('comment','measurement'));
alter table pm.issues add column target_info text not null default '' check(length(target_info)<=2000),
 add column measurement_method text not null default 'unspecified' check(measurement_method in ('outside','inside','depth','other','unspecified')),
 add column annotation_id uuid, add column annotation_revision integer, add column annotation_snapshot jsonb,
 add column state text not null default 'awaiting_response' check(state in ('awaiting_response','submitted','confirmed','remeasure_requested')),
 add column revision integer not null default 1 check(revision>0), add column latest_response_id uuid,
 add column updated_at timestamptz not null default now();
alter table pm.issues add constraint issue_annotation_ref foreign key(project_id,file_id,annotation_id,annotation_revision) references pm.annotation_revisions(project_id,file_id,annotation_id,revision),
 add constraint issue_target_kind check((kind='comment' and annotation_id is null and annotation_revision is null and annotation_snapshot is null and target_info='' and measurement_method='unspecified') or
 (kind='measurement' and annotation_id is not null and annotation_revision is not null and annotation_snapshot is not null and length(btrim(target_info))>0));
create index issues_annotation on pm.issues(project_id,file_id,annotation_id,annotation_revision) where annotation_id is not null;
create index issues_inbox on pm.issues(project_id,state,created_at,id);

create table pm.issue_responses(
 id uuid primary key default gen_random_uuid(), project_id uuid not null,issue_id uuid not null,issue_revision integer not null check(issue_revision>0),
 kind text not null check(kind in ('numeric','photo','unable','text')), value text,unit text,body text not null default '' check(length(body)<=4000),
 author_type text not null check(author_type in ('owner','guest')),owner_id uuid references auth.users(id),guest_session_id uuid references pm.guest_sessions(id),guest_label text not null default '' check(length(guest_label)<=80),
 created_at timestamptz not null default now(),unique(project_id,issue_id,id),unique(issue_id,issue_revision),
 foreign key(project_id,issue_id) references pm.issues(project_id,id),
 check((author_type='owner' and owner_id is not null and guest_session_id is null) or (author_type='guest' and owner_id is null and guest_session_id is not null)),
 check((kind='numeric' and value is not null and value ~ '^(0|[1-9][0-9]{0,8})(\.[0-9]{1,6})?$' and value::numeric>0 and unit is not null and unit in ('mm','cm','m','in')) or (kind<>'numeric' and value is null and unit is null)),
 check(kind not in ('unable','text') or length(btrim(body))>0)
);
create index responses_scope on pm.issue_responses(project_id,issue_id,created_at,id);
create index responses_owner on pm.issue_responses(owner_id) where owner_id is not null;
create index responses_guest on pm.issue_responses(guest_session_id) where guest_session_id is not null;
alter table pm.issues add constraint issue_latest_response foreign key(project_id,id,latest_response_id) references pm.issue_responses(project_id,issue_id,id);
create index issues_latest_response on pm.issues(latest_response_id) where latest_response_id is not null;
create table pm.response_attachments(
 project_id uuid not null,issue_id uuid not null,response_id uuid not null,file_id uuid not null,
 primary key(response_id,file_id),foreign key(project_id,issue_id,response_id) references pm.issue_responses(project_id,issue_id,id),
 foreign key(project_id,file_id) references pm.file_assets(project_id,id)
);
create index response_attachments_file on pm.response_attachments(project_id,file_id);
create index response_attachments_scope on pm.response_attachments(project_id,issue_id,response_id);
create table pm.issue_reviews(
 id uuid primary key default gen_random_uuid(),project_id uuid not null,issue_id uuid not null,response_id uuid not null,issue_revision integer not null,
 decision text not null check(decision in ('confirm','remeasure')),value text,unit text,source text,note text not null default '' check(length(note)<=4000),
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),unique(issue_id,issue_revision),
 foreign key(project_id,issue_id,response_id) references pm.issue_responses(project_id,issue_id,id),
 check((decision='remeasure' and source is null and value is null and unit is null and length(btrim(note))>0) or
 (decision='confirm' and source is not null and ((source='comment' and value is null and unit is null) or (source in ('customer_numeric','owner_from_photo','owner_manual') and value is not null and value ~ '^(0|[1-9][0-9]{0,8})(\.[0-9]{1,6})?$' and value::numeric>0 and unit is not null and unit in ('mm','cm','m','in')))))
);
create index reviews_scope on pm.issue_reviews(project_id,issue_id,created_at,id);
create index reviews_response on pm.issue_reviews(project_id,issue_id,response_id);
create index reviews_owner on pm.issue_reviews(created_by);

create function pm.check_issue_workflow() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'IMMUTABLE_ISSUE' using errcode='23514'; end if;
 if tg_op='INSERT' then
  if new.state<>'awaiting_response' or new.revision<>1 or new.latest_response_id is not null then raise exception 'INVALID_ISSUE_STATE' using errcode='23514'; end if;
  if new.kind='measurement' and not exists(select 1 from pm.annotation_revisions r join pm.annotations a on a.id=r.annotation_id
   where r.project_id=new.project_id and r.file_id=new.file_id and r.annotation_id=new.annotation_id and r.revision=new.annotation_revision and not r.deleted and a.deleted_at is null and a.revision=r.revision
   and new.annotation_snapshot=jsonb_build_object('geometry',r.geometry,'metadata',r.metadata)) then raise exception 'INVALID_ANNOTATION_REF' using errcode='23514'; end if;
  return new;
 end if;
 if (to_jsonb(new)-array['state','revision','latest_response_id','updated_at']) is distinct from (to_jsonb(old)-array['state','revision','latest_response_id','updated_at']) or new.revision<>old.revision+1 then raise exception 'IMMUTABLE_ISSUE_TARGET' using errcode='23514'; end if;
 if old.state in ('awaiting_response','remeasure_requested') and new.state='submitted' then
  if not exists(select 1 from pm.issue_responses r where r.id=new.latest_response_id and r.issue_id=new.id and r.project_id=new.project_id and r.issue_revision=old.revision) then raise exception 'RESPONSE_REQUIRED' using errcode='23514'; end if;
 elsif old.state='submitted' and new.state in ('confirmed','remeasure_requested') then
  if not pm.is_owner(new.project_id) or new.latest_response_id is distinct from old.latest_response_id or not exists(select 1 from pm.issue_reviews r where r.issue_id=new.id and r.project_id=new.project_id and r.response_id=old.latest_response_id and r.issue_revision=old.revision and r.decision=case when new.state='confirmed' then 'confirm' else 'remeasure' end) then raise exception 'REVIEW_REQUIRED' using errcode='23514'; end if;
 else raise exception 'INVALID_ISSUE_STATE' using errcode='23514'; end if;
 return new;
end $$;
drop trigger issues_immutable on pm.issues;
create trigger issue_workflow before insert or update or delete on pm.issues for each row execute function pm.check_issue_workflow();

create function pm.check_issue_response() returns trigger language plpgsql security invoker set search_path='' as $$
declare i record;
begin
 select * into i from pm.issues where id=new.issue_id and project_id=new.project_id;
 if not found or i.state not in ('awaiting_response','remeasure_requested') or i.revision<>new.issue_revision or (i.kind='comment')<>(new.kind='text') then raise exception 'INVALID_RESPONSE_STATE' using errcode='23514'; end if;
 if new.author_type='owner' then
  if not pm.is_owner(new.project_id) or new.owner_id is distinct from pm.owner_id() then raise exception 'INVALID_RESPONSE_ACTOR' using errcode='42501'; end if;
 elsif pm.owner_id() is not null or not exists(select 1 from pm.guest_sessions s where s.id=new.guest_session_id and s.project_id=new.project_id and s.token_hash=nullif(current_setting('pm.guest_hash',true),'') and s.expires_at>now()) or not pm.can_read(new.project_id) then raise exception 'INVALID_RESPONSE_ACTOR' using errcode='42501'; end if;
 return new;
end $$;
create function pm.check_response_attachment() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from pm.issue_responses r join pm.issues i on i.id=r.issue_id and i.project_id=r.project_id where r.id=new.response_id and r.issue_id=new.issue_id and r.project_id=new.project_id and i.revision=r.issue_revision and i.state in ('awaiting_response','remeasure_requested')
  and ((r.author_type='owner' and r.owner_id=pm.owner_id()) or (r.author_type='guest' and exists(select 1 from pm.guest_sessions s where s.id=r.guest_session_id and s.token_hash=nullif(current_setting('pm.guest_hash',true),'') and s.project_id=r.project_id))))
  or not exists(select 1 from pm.file_assets f where f.id=new.file_id and f.project_id=new.project_id and f.deleted_at is null and f.visibility='customer') then raise exception 'INVALID_RESPONSE_ATTACHMENT' using errcode='23514'; end if;
 return new;
end $$;
create function pm.protect_response_asset() returns trigger language plpgsql security invoker set search_path='' as $$
begin update pm.file_assets set history_protected=true where id=new.file_id and project_id=new.project_id and not history_protected; return new; end $$;
create function pm.check_response_complete() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from pm.issues i where i.id=new.issue_id and i.project_id=new.project_id and i.latest_response_id=new.id and i.state='submitted' and i.revision=new.issue_revision+1) then raise exception 'ATOMIC_RESPONSE_REQUIRED' using errcode='23514'; end if;
 if (select count(*) from pm.response_attachments where response_id=new.id)>10 or (new.kind='photo' and not exists(select 1 from pm.response_attachments a join pm.file_assets f on f.id=a.file_id and f.project_id=a.project_id where a.response_id=new.id and f.mime='image/webp' and f.deleted_at is null)) then raise exception 'PHOTO_EVIDENCE_REQUIRED' using errcode='23514'; end if;
 return new;
end $$;
create trigger response_validate before insert on pm.issue_responses for each row execute function pm.check_issue_response();
create trigger attachment_validate before insert on pm.response_attachments for each row execute function pm.check_response_attachment();
create trigger attachment_protect after insert on pm.response_attachments for each row execute function pm.protect_response_asset();
create constraint trigger response_complete after insert on pm.issue_responses deferrable initially deferred for each row execute function pm.check_response_complete();

create function pm.check_issue_review() returns trigger language plpgsql security invoker set search_path='' as $$
declare i record;r record;
begin
 select * into i from pm.issues where id=new.issue_id and project_id=new.project_id;
 if not found or not pm.is_owner(new.project_id) or new.created_by is distinct from pm.owner_id() then raise exception 'INVALID_REVIEW_ACTOR' using errcode='42501'; end if;
 if i.state<>'submitted' or i.revision<>new.issue_revision or i.latest_response_id<>new.response_id then raise exception 'INVALID_REVIEW_STATE' using errcode='23514'; end if;
 select * into r from pm.issue_responses where id=new.response_id and issue_id=new.issue_id and project_id=new.project_id;
 if not found then raise exception 'INVALID_REVIEW_RESPONSE' using errcode='23514'; end if;
 if new.decision='confirm' then
  if i.kind='comment' then
   if new.source is distinct from 'comment' then raise exception 'INVALID_REVIEW_SOURCE' using errcode='23514'; end if;
  elsif new.source is null or new.source='comment' then raise exception 'INVALID_REVIEW_SOURCE' using errcode='23514';
  elsif new.source='customer_numeric' then
   if r.kind<>'numeric' or new.value is distinct from r.value or new.unit is distinct from r.unit then raise exception 'INVALID_REVIEW_SOURCE' using errcode='23514'; end if;
  elsif length(btrim(new.note))=0 or (new.source='owner_from_photo' and r.kind<>'photo') then raise exception 'MANUAL_SOURCE_NOTE_REQUIRED' using errcode='23514'; end if;
 end if;
 return new;
end $$;
create function pm.check_review_complete() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from pm.issues i where i.id=new.issue_id and i.project_id=new.project_id and i.latest_response_id=new.response_id and i.revision=new.issue_revision+1 and i.state=case when new.decision='confirm' then 'confirmed' else 'remeasure_requested' end) then raise exception 'ATOMIC_REVIEW_REQUIRED' using errcode='23514'; end if;
 return new;
end $$;
create trigger review_validate before insert on pm.issue_reviews for each row execute function pm.check_issue_review();
create constraint trigger review_complete after insert on pm.issue_reviews deferrable initially deferred for each row execute function pm.check_review_complete();

create or replace function pm.protect_asset() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if old.history_protected and (not new.history_protected or new.deleted_at is distinct from old.deleted_at) then raise exception 'HISTORY_PROTECTED' using errcode='23514'; end if;
 if (new.storage_key,new.original_key,new.project_id,new.reservation_id,new.sha256,new.original_sha256,new.width,new.height,new.normalization_version,new.mime,new.byte_size,new.original_bytes) is distinct from
 (old.storage_key,old.original_key,old.project_id,old.reservation_id,old.sha256,old.original_sha256,old.width,old.height,old.normalization_version,old.mime,old.byte_size,old.original_bytes) then raise exception 'IMMUTABLE_ASSET' using errcode='23514'; end if;
 if current_user='partmeasure_runtime' and pm.owner_id() is null then
  if not new.history_protected or (to_jsonb(new)-'history_protected') is distinct from (to_jsonb(old)-'history_protected') or not exists(select 1 from pm.response_attachments a join pm.issue_responses r on r.id=a.response_id join pm.guest_sessions s on s.id=r.guest_session_id where a.project_id=new.project_id and a.file_id=new.id and s.token_hash=nullif(current_setting('pm.guest_hash',true),'')) then raise exception 'GUEST_ASSET_UPDATE_DENIED' using errcode='42501'; end if;
 end if;
 return new;
end $$;
alter policy asset_update on pm.file_assets using(pm.is_owner(project_id) or (visibility='customer' and deleted_at is null and pm.can_read(project_id))) with check(pm.is_owner(project_id) or (visibility='customer' and deleted_at is null and pm.can_read(project_id)));
create policy issue_update on pm.issues for update to partmeasure_runtime using(pm.is_owner(project_id) or pm.can_read(project_id)) with check(pm.is_owner(project_id) or pm.can_read(project_id));
grant update(state,revision,latest_response_id,updated_at) on pm.issues to partmeasure_runtime;

alter table pm.issue_responses enable row level security;
alter table pm.response_attachments enable row level security;
alter table pm.issue_reviews enable row level security;
create policy responses_read on pm.issue_responses for select to partmeasure_runtime using(exists(select 1 from pm.issues i where i.project_id=issue_responses.project_id and i.id=issue_id));
create policy responses_insert on pm.issue_responses for insert to partmeasure_runtime with check(exists(select 1 from pm.issues i where i.project_id=issue_responses.project_id and i.id=issue_id) and (pm.is_owner(project_id) or pm.can_read(project_id)));
create policy attachments_read on pm.response_attachments for select to partmeasure_runtime using(exists(select 1 from pm.issues i where i.project_id=response_attachments.project_id and i.id=issue_id));
create policy attachments_insert on pm.response_attachments for insert to partmeasure_runtime with check(exists(select 1 from pm.issues i where i.project_id=response_attachments.project_id and i.id=issue_id) and (pm.is_owner(project_id) or pm.can_read(project_id)));
create policy reviews_read on pm.issue_reviews for select to partmeasure_runtime using(exists(select 1 from pm.issues i where i.project_id=issue_reviews.project_id and i.id=issue_id));
create policy reviews_insert on pm.issue_reviews for insert to partmeasure_runtime with check(pm.is_owner(project_id) and created_by=(select pm.owner_id()));
grant select,insert on pm.issue_responses,pm.response_attachments,pm.issue_reviews to partmeasure_runtime;
create trigger responses_immutable before update or delete on pm.issue_responses for each row execute function pm.reject_history_mutation();
create trigger attachments_immutable before update or delete on pm.response_attachments for each row execute function pm.reject_history_mutation();
create trigger reviews_immutable before update or delete on pm.issue_reviews for each row execute function pm.reject_history_mutation();
revoke all on function pm.check_issue_workflow(),pm.check_issue_response(),pm.check_response_attachment(),pm.protect_response_asset(),pm.check_response_complete(),pm.check_issue_review(),pm.check_review_complete() from public,anon,authenticated;
-- Trigger functions are SECURITY INVOKER; no browser/worker grants, RPC, history mutation or bypass.
