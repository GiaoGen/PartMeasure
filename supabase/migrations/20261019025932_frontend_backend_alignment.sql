-- Additive frontend alignment only; existing projects remain unclassified.
-- Private schema, invoker RLS and existing runtime adapter remain authoritative.
create table pm.project_folders (
 id uuid primary key default gen_random_uuid(),
 owner_id uuid not null references auth.users(id),
 name text not null check(name=btrim(name) and char_length(name) between 1 and 60 and name<>'全部'),
 name_key text generated always as (lower(btrim(name))) stored,
 description text not null default '' check(char_length(description)<=500),
 color text not null default 'blue' check(color in ('blue','cyan','green','purple','rose','coral','slate')),
 revision integer not null default 1 check(revision=1),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 constraint project_folders_owner_name_key unique(owner_id,name_key),
 constraint project_folders_owner_identity unique(owner_id,id)
);
alter table pm.project_folders enable row level security;
create policy folders_read on pm.project_folders for select to partmeasure_runtime
 using(owner_id=(select pm.owner_id()));
create policy folders_create on pm.project_folders for insert to partmeasure_runtime
 with check(owner_id=(select pm.owner_id()));
revoke all on pm.project_folders from public,anon,authenticated,partmeasure_worker;
grant select,insert on pm.project_folders to partmeasure_runtime;
-- Rename/delete/move/order APIs have no approved interaction contract and are not granted.
alter table pm.projects add column folder_id uuid;
alter table pm.projects add constraint projects_folder_owner_fk
 foreign key(owner_id,folder_id) references pm.project_folders(owner_id,id) on delete restrict;
create index projects_folder_owner_created on pm.projects(owner_id,folder_id,created_at desc,id desc);
create index issues_annotation_lookup on pm.issues(project_id,file_id,annotation_id,created_at desc,id desc)
 where annotation_id is not null;
