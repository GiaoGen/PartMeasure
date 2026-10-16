create function pm.link_hash() returns text language sql stable security invoker set search_path='' as $$
 select nullif(current_setting('pm.link_hash',true),'')
$$;
revoke all on function pm.link_hash() from public,anon,authenticated;
grant execute on function pm.link_hash() to partmeasure_runtime,partmeasure_worker;
alter policy share_update on pm.share_links using(pm.is_owner(project_id) or token_hash=(select pm.link_hash()) or pm.can_read(project_id));
alter policy session_create on pm.guest_sessions with check(exists(select 1 from pm.share_links l where l.id=guest_sessions.share_id and l.project_id=guest_sessions.project_id and l.token_hash=(select pm.link_hash()) and l.revoked_at is null and l.expires_at>now()));
alter policy scoped_read on pm.file_assets using(pm.is_owner(project_id) or (visibility='customer' and deleted_at is null and pm.can_read(project_id)));
