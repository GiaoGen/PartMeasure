-- Isolated P0-0 service experiment ONLY. Never apply business draft or local auth/storage stubs.
-- Apply solely to the newly created partmeasure-p0-0-lab project after asserting project ref.
begin;
create table public.p0_lab_records (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  label text not null check(length(label) between 1 and 40)
);
comment on table public.p0_lab_records is 'P0-0 isolated service experiment; not PartMeasure projects';
create index p0_lab_owner on public.p0_lab_records(owner_id);
alter table public.p0_lab_records enable row level security;
revoke all on public.p0_lab_records from public, anon, authenticated;
grant select,insert,update,delete on public.p0_lab_records to authenticated;
create policy p0_lab_owner_select on public.p0_lab_records for select to authenticated using(owner_id=(select auth.uid()));
create policy p0_lab_owner_insert on public.p0_lab_records for insert to authenticated with check(owner_id=(select auth.uid()));
create policy p0_lab_owner_update on public.p0_lab_records for update to authenticated using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
create policy p0_lab_owner_delete on public.p0_lab_records for delete to authenticated using(owner_id=(select auth.uid()));
-- Bucket metadata only; actual uploads/downloads/removal go through the Storage API.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('p0-0-service-lab','p0-0-service-lab',false,1048576,array['text/plain']);
create policy p0_lab_storage_select on storage.objects for select to authenticated
using(bucket_id='p0-0-service-lab' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy p0_lab_storage_insert on storage.objects for insert to authenticated
with check(bucket_id='p0-0-service-lab' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy p0_lab_storage_delete on storage.objects for delete to authenticated
using(bucket_id='p0-0-service-lab' and (storage.foldername(name))[1]=(select auth.uid())::text);
-- No UPDATE/upsert policy. This lab deliberately uses real user JWT RLS;
-- final Guest uses server capability authorization, which is NOT tested here.
commit;
