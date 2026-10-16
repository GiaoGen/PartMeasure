-- Only after Storage API cleanup; these names belong exclusively to this experiment.
begin;
drop policy if exists p0_lab_storage_select on storage.objects;
drop policy if exists p0_lab_storage_insert on storage.objects;
drop policy if exists p0_lab_storage_delete on storage.objects;
delete from storage.buckets where id='p0-0-service-lab';
drop table if exists public.p0_lab_records;
commit;
