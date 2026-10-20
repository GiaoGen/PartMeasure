-- Approved annotation-first collaboration. Additive; immutable snapshots/replies stay intact.
alter table pm.issues
 add column measurement_field text check(measurement_field in ('dimension','holeDepth')),
 add column closed_at timestamptz,
 add column closed_by uuid references auth.users(id),
 add column closure_note text not null default '' check(length(closure_note)<=4000),
 add column closure_annotation_revision integer,
 add constraint issue_closure_consistent check(
  (closed_at is null and closed_by is null and closure_note='' and closure_annotation_revision is null) or
  (closed_at is not null and closed_by is not null and length(btrim(closure_note))>0 and closure_annotation_revision is not null)),
 add constraint issue_closure_revision foreign key(project_id,file_id,annotation_id,closure_annotation_revision)
 references pm.annotation_revisions(project_id,file_id,annotation_id,revision);
create unique index issue_one_pending_field on pm.issues(project_id,annotation_id,measurement_field)
 where measurement_field is not null and closed_at is null and state<>'confirmed';
create index issue_open_inbox on pm.issues(project_id,state,created_at,id) where closed_at is null;
create index issue_closer on pm.issues(closed_by) where closed_by is not null;
create index issue_closure_ref on pm.issues(project_id,file_id,annotation_id,closure_annotation_revision) where closure_annotation_revision is not null;
grant update(closed_at,closed_by,closure_note,closure_annotation_revision) on pm.issues to partmeasure_runtime;
create or replace function pm.check_issue_workflow() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'IMMUTABLE_ISSUE' using errcode='23514'; end if;
 if tg_op='INSERT' then
  if new.closed_at is not null then raise exception 'INVALID_CLOSURE' using errcode='23514'; end if;
  if new.state<>'awaiting_response' or new.revision<>1 or new.latest_response_id is not null then raise exception 'INVALID_ISSUE_STATE' using errcode='23514'; end if;
  if new.kind='measurement' and not exists(select 1 from pm.annotation_revisions r join pm.annotations a on a.id=r.annotation_id
   where r.project_id=new.project_id and r.file_id=new.file_id and r.annotation_id=new.annotation_id and r.revision=new.annotation_revision and not r.deleted and a.deleted_at is null and a.revision=r.revision
   and new.annotation_snapshot=jsonb_build_object('geometry',r.geometry,'metadata',r.metadata)) then raise exception 'INVALID_ANNOTATION_REF' using errcode='23514'; end if;
  return new;
 end if;
 if old.closed_at is not null then raise exception 'CLOSED_MEASUREMENT' using errcode='23514'; end if;
 if new.closed_at is not null then
  if not pm.is_owner(new.project_id) or new.closed_by is distinct from pm.owner_id() or old.state='confirmed' or new.kind<>'measurement'
   or length(btrim(new.closure_note))=0 or new.revision<>old.revision+1
   or (to_jsonb(new)-array['closed_at','closed_by','closure_note','closure_annotation_revision','revision','updated_at']) is distinct from (to_jsonb(old)-array['closed_at','closed_by','closure_note','closure_annotation_revision','revision','updated_at'])
   or not exists(select 1 from pm.annotations a where a.project_id=new.project_id and a.id=new.annotation_id and a.revision=new.closure_annotation_revision)
  then raise exception 'INVALID_CLOSURE' using errcode='23514'; end if;
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
create or replace function pm.check_issue_response() returns trigger language plpgsql security invoker set search_path='' as $$
declare i record;
begin
 select * into i from pm.issues where id=new.issue_id and project_id=new.project_id;
 if not found or i.closed_at is not null or i.state not in ('awaiting_response','remeasure_requested') or i.revision<>new.issue_revision or (i.kind='comment')<>(new.kind='text') then raise exception 'INVALID_RESPONSE_STATE' using errcode='23514'; end if;
 if new.author_type='owner' then
  if not pm.is_owner(new.project_id) or new.owner_id is distinct from pm.owner_id() then raise exception 'INVALID_RESPONSE_ACTOR' using errcode='42501'; end if;
 elsif pm.owner_id() is not null or not exists(select 1 from pm.guest_sessions s where s.id=new.guest_session_id and s.project_id=new.project_id and s.token_hash=nullif(current_setting('pm.guest_hash',true),'') and s.expires_at>now()) or not pm.can_read(new.project_id) then raise exception 'INVALID_RESPONSE_ACTOR' using errcode='42501'; end if;
 return new;
end $$;
create or replace function pm.check_issue_review() returns trigger language plpgsql security invoker set search_path='' as $$
declare i record;r record;
begin
 select * into i from pm.issues where id=new.issue_id and project_id=new.project_id;
 if not found or not pm.is_owner(new.project_id) or new.created_by is distinct from pm.owner_id() then raise exception 'INVALID_REVIEW_ACTOR' using errcode='42501'; end if;
 if i.closed_at is not null or i.state<>'submitted' or i.revision<>new.issue_revision or i.latest_response_id<>new.response_id then raise exception 'INVALID_REVIEW_STATE' using errcode='23514'; end if;
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
