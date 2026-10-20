-- Lightweight request-driven uploads. Isolated project only; no Auth/Storage stand-ins.
alter table pm.upload_reservations add column processing_token uuid, add column processing_until timestamptz;
alter table pm.file_assets add column validation_policy text not null default 'clamav-v1'
 check(validation_policy in ('clamav-v1','format-only-v2'));

-- A request claims one reservation. The transaction-local fence is set by trusted code only.
create function pm.upload_actor_matches(p uuid, a text) returns boolean
 language sql stable security invoker set search_path='' as $$
 select (pm.is_owner(p) and a='owner:'||pm.owner_id()::text)
 or (pm.can_read(p) and a='guest:'||nullif(current_setting('pm.guest_hash',true),''))
$$;
revoke all on function pm.upload_actor_matches(uuid,text) from public,anon,authenticated;
grant execute on function pm.upload_actor_matches(uuid,text) to partmeasure_runtime;

create policy asset_request_insert on pm.file_assets for insert to partmeasure_runtime with check(
 validation_policy='format-only-v2' and id=reservation_id and exists(
  select 1 from pm.upload_reservations r where r.id=reservation_id and r.project_id=file_assets.project_id
  and pm.upload_actor_matches(r.project_id,r.actor_key) and r.state='processing'
  and r.processing_token::text=nullif(current_setting('pm.processing_token',true),'') and r.processing_until>now()
  and r.purpose=file_assets.purpose and r.filename=file_assets.filename and r.extension=file_assets.extension
  and r.sha256=file_assets.original_sha256 and r.byte_size=file_assets.original_bytes
  and file_assets.original_key=r.project_id::text||'/'||r.id::text||'/source'
  and file_assets.uploader_type=case when r.share_id is null then 'owner' else 'guest' end
  and file_assets.visibility=case when r.purpose='delivery' then 'internal' else 'customer' end
  and (r.purpose='material' or pm.is_owner(r.project_id))
 ));
grant insert on pm.file_assets to partmeasure_runtime;
create policy derivative_request_insert on pm.image_derivatives for insert to partmeasure_runtime with check(exists(
 select 1 from pm.file_assets f join pm.upload_reservations r on r.id=f.reservation_id and r.project_id=f.project_id
 where f.id=image_derivatives.file_id and f.project_id=image_derivatives.project_id and f.purpose='material'
 and f.mime='image/webp' and f.sha256=image_hash and f.normalization_version=1
 and image_derivatives.width<=f.width and image_derivatives.height<=f.height
 and pm.upload_actor_matches(r.project_id,r.actor_key) and r.state='processing'
 and r.processing_token::text=nullif(current_setting('pm.processing_token',true),'') and r.processing_until>now()
));
grant insert on pm.image_derivatives to partmeasure_runtime;
grant execute on function pm.record_derivative_change() to partmeasure_runtime;

-- Guest finalize may only settle usage, not edit project properties.
create policy project_usage_request on pm.projects for update to partmeasure_runtime
 using(pm.can_read(id)) with check(pm.can_read(id));
create function pm.guard_guest_project_usage() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if current_user='partmeasure_runtime' and not pm.is_owner(old.id) then
  if not pm.can_read(old.id) or nullif(current_setting('pm.processing_token',true),'') is null
   or (to_jsonb(new)-'used_bytes') is distinct from (to_jsonb(old)-'used_bytes') then
   raise exception 'PROJECT_OWNER_REQUIRED' using errcode='42501';
  end if;
 end if;
 return new;
end $$;
revoke all on function pm.guard_guest_project_usage() from public,anon,authenticated;
grant execute on function pm.guard_guest_project_usage() to partmeasure_runtime;
create trigger guest_usage_guard before update on pm.projects for each row execute function pm.guard_guest_project_usage();

-- Legacy job history remains. New uploads never enqueue; no wake-up consumer is required.
drop trigger if exists wake_file_worker on pm.jobs;

create function pm.guard_validation_policy() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.validation_policy is distinct from old.validation_policy then
  raise exception 'IMMUTABLE_VALIDATION_POLICY' using errcode='23514';
 end if;
 return new;
end $$;
revoke all on function pm.guard_validation_policy() from public,anon,authenticated;
create trigger validation_policy_immutable before update on pm.file_assets for each row execute function pm.guard_validation_policy();
