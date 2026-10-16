create index assets_reservation_fk on pm.file_assets(project_id,reservation_id);
create index reservations_share_fk on pm.upload_reservations(project_id,share_id);
alter policy share_update on pm.share_links using(pm.is_owner(project_id) or token_hash=(select nullif(current_setting('pm.link_hash',true),'')) or pm.can_read(project_id));
alter policy session_create on pm.guest_sessions with check(exists(select 1 from pm.share_links l where l.id=guest_sessions.share_id and l.project_id=guest_sessions.project_id and l.token_hash=(select nullif(current_setting('pm.link_hash',true),'')) and l.revoked_at is null and l.expires_at>now()));
