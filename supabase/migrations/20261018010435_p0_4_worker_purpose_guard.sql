-- Keep worker blind to delivery workflow tables. SQL AND is not a control-flow guard:
-- PostgreSQL may prepare/evaluate the subquery even for a material/internal asset.
create or replace function pm.check_asset_purpose() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='UPDATE' then
  if new.purpose is distinct from old.purpose then raise exception 'IMMUTABLE_ASSET_PURPOSE' using errcode='23514'; end if;
  if old.purpose='delivery' and old.history_protected and new is distinct from old then raise exception 'IMMUTABLE_DELIVERY_ASSET' using errcode='23514'; end if;
 end if;
 if tg_op='INSERT' and not exists(select 1 from pm.upload_reservations r where r.id=new.reservation_id and r.project_id=new.project_id and r.purpose=new.purpose and (new.purpose='material' or (r.share_id is null and new.uploader_type='owner' and new.visibility='internal'))) then raise exception 'INVALID_ASSET_PURPOSE' using errcode='23514'; end if;
 if new.purpose='delivery' then
  if new.visibility='customer' then
   if not exists(select 1 from pm.delivery_files a join pm.deliveries d on d.id=a.delivery_id and d.project_id=a.project_id where a.file_id=new.id and a.project_id=new.project_id and a.selected and d.state='published') then raise exception 'UNPUBLISHED_ASSET' using errcode='23514'; end if;
  end if;
 end if;
 return new;
end $$;
revoke all on function pm.check_asset_purpose() from public,anon,authenticated;
