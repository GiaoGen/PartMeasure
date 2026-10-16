alter table pm.upload_reservations add column quarantine_cleaned_at timestamptz,
 add column cleanup_lease_until timestamptz, add column cleanup_token uuid,
 add column cleanup_attempts integer not null default 0, add column cleanup_dead_at timestamptz;
create policy jobs_retry on pm.jobs for select to partmeasure_runtime using(exists(select 1 from pm.upload_reservations r where r.id=reservation_id and (pm.is_owner(r.project_id) or pm.can_read(r.project_id))));
create policy jobs_retry_update on pm.jobs for update to partmeasure_runtime using(exists(select 1 from pm.upload_reservations r where r.id=reservation_id and (pm.is_owner(r.project_id) or pm.can_read(r.project_id)))) with check(exists(select 1 from pm.upload_reservations r where r.id=reservation_id and (pm.is_owner(r.project_id) or pm.can_read(r.project_id))));
grant select,update on pm.jobs to partmeasure_runtime;
-- Protect owner/project immutable fields as defense in depth behind the DAL.
create function pm.protect_project() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.owner_id<>old.owner_id or new.id<>old.id then raise exception 'IMMUTABLE_PROJECT'; end if;
 return new;
end $$;
revoke all on function pm.protect_project() from public;
create trigger immutable_project before update on pm.projects for each row execute function pm.protect_project();
