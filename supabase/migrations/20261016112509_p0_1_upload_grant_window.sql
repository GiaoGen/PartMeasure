-- A 2h signed grant can create a TUS URL near its expiry; that URL can live another 24h.
-- Without observing TUS creation time, reserve until latest creation + 24h + 1h buffer.
alter table pm.upload_reservations alter column cleanup_after set default now()+interval '27 hours';
update pm.upload_reservations set cleanup_after=greatest(cleanup_after,grant_expires_at+interval '25 hours') where state<>'cleaned';
