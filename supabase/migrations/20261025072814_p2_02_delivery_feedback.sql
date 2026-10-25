-- P2-02 only: append-only feedback on published deliveries. Isolated test project.
create table pm.delivery_feedback (
 id uuid primary key default gen_random_uuid(),
 ordinal bigint generated always as identity,
 project_id uuid not null, delivery_id uuid not null, guest_session_id uuid not null,
 author_type text not null default 'guest' check(author_type='guest'),
 kind text not null check(kind in ('comment','received','accepted','withdrawn')),
 body text not null default '' check(length(body)<=4000),
 guest_label text not null default '' check(length(guest_label)<=80),
 target_id uuid, created_at timestamptz not null default clock_timestamp(),
 unique(project_id,delivery_id,id),
 foreign key(project_id,delivery_id) references pm.deliveries(project_id,id),
 foreign key(guest_session_id) references pm.guest_sessions(id),
 foreign key(project_id,delivery_id,target_id) references pm.delivery_feedback(project_id,delivery_id,id),
 check((kind='withdrawn')=(target_id is not null)),
 check(kind<>'comment' or length(btrim(body))>0)
);
create index feedback_page on pm.delivery_feedback(project_id,delivery_id,ordinal desc);
create index feedback_receipt on pm.delivery_feedback(project_id,delivery_id,guest_session_id,ordinal desc) where kind in ('received','accepted');
create index feedback_session on pm.delivery_feedback(project_id,guest_session_id);
create unique index feedback_withdrawal on pm.delivery_feedback(target_id) where target_id is not null;

alter table pm.delivery_feedback enable row level security;
create policy feedback_read on pm.delivery_feedback for select to partmeasure_runtime
 using((pm.is_owner(project_id) or pm.can_read(project_id)) and exists(select 1 from pm.deliveries d where d.project_id=delivery_feedback.project_id and d.id=delivery_id and d.state='published'));
create policy feedback_insert on pm.delivery_feedback for insert to partmeasure_runtime
 with check(pm.owner_id() is null and pm.can_read(project_id) and exists(
  select 1 from pm.guest_sessions s where s.project_id=delivery_feedback.project_id and s.id=guest_session_id
   and s.token_hash=current_setting('pm.guest_hash',true) and s.expires_at>now()
 ));
grant select on pm.delivery_feedback to partmeasure_runtime;
grant insert(project_id,delivery_id,guest_session_id,kind,body,guest_label,target_id) on pm.delivery_feedback to partmeasure_runtime;
grant usage on sequence pm.delivery_feedback_ordinal_seq to partmeasure_runtime;

create function pm.guard_delivery_feedback() returns trigger language plpgsql security invoker set search_path='' as $$
declare current_id uuid; current_kind text; link_id uuid;
begin
 perform 1 from pm.projects where id=new.project_id for update;
 select s.share_id into link_id from pm.guest_sessions s join pm.share_links l on l.id=s.share_id
 where s.project_id=new.project_id and s.id=new.guest_session_id
 and s.token_hash=current_setting('pm.guest_hash',true) and s.expires_at>now()
 and l.revoked_at is null and l.expires_at>now();
 if link_id is null or pm.owner_id() is not null then raise exception 'FEEDBACK_GUEST_REQUIRED' using errcode='42501'; end if;
 perform 1 from pm.share_links where id=link_id for update;
 if not exists(select 1 from pm.deliveries where project_id=new.project_id and id=new.delivery_id and state='published') then
  raise exception 'PUBLISHED_DELIVERY_REQUIRED' using errcode='23514';
 end if;
 select f.id,f.kind into current_id,current_kind from pm.delivery_feedback f
 where f.project_id=new.project_id and f.delivery_id=new.delivery_id and f.guest_session_id=new.guest_session_id
 and f.kind in ('received','accepted') order by f.ordinal desc limit 1;
 if exists(select 1 from pm.delivery_feedback where target_id=current_id) then current_id:=null; current_kind:=null; end if;
 if new.kind='withdrawn' and (current_id is null or new.target_id is distinct from current_id) then
  raise exception 'FEEDBACK_STATE_CONFLICT' using errcode='23514';
 end if;
 if (new.kind='received' and current_id is not null) or (new.kind='accepted' and current_kind='accepted') then
  raise exception 'FEEDBACK_STATE_CONFLICT' using errcode='23514';
 end if;
 if new.kind<>'withdrawn' and (select count(*) from pm.delivery_feedback where project_id=new.project_id and delivery_id=new.delivery_id)>=1000 then
  raise exception 'FEEDBACK_LIMIT' using errcode='23514';
 end if;
 new.created_at:=clock_timestamp();
 return new;
end $$;
revoke all on function pm.guard_delivery_feedback() from public,anon,authenticated;
grant execute on function pm.guard_delivery_feedback() to partmeasure_runtime;
create trigger feedback_validate before insert on pm.delivery_feedback for each row execute function pm.guard_delivery_feedback();
create trigger feedback_immutable before update or delete on pm.delivery_feedback for each row execute function pm.reject_history_mutation();

create function pm.record_delivery_feedback() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 perform pm.emit_project_event(new.project_id,'delivery.changed',new.delivery_id,null,null,'feedback',true);
 return new;
end $$;
revoke all on function pm.record_delivery_feedback() from public,anon,authenticated;
grant execute on function pm.record_delivery_feedback() to partmeasure_runtime;
create trigger feedback_event after insert on pm.delivery_feedback for each row execute function pm.record_delivery_feedback();
