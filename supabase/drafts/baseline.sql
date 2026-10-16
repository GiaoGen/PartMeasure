-- REVIEW DRAFT ONLY. Not an applied migration; no production/remote execution.
-- Assumes Supabase auth.users, auth.uid(), anon/authenticated/service_role and storage schemas.
begin;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  name text not null check (length(name) between 1 and 120),
  description text not null default '' check (length(description) <= 4000),
  status text not null default 'active' check (status in ('active','archived')),
  revision integer not null default 1 check (revision > 0),
  quota_bytes bigint not null default 1073741824 check (quota_bytes > 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index projects_owner_status_updated on public.projects(owner_id,status,updated_at desc,id);

create table public.share_links (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete restrict,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null, revoked_at timestamptz,
  created_at timestamptz not null default now(),
  unique(project_id,id), check (expires_at > created_at)
);
create index share_links_project on public.share_links(project_id);

create table public.guest_sessions (
  id uuid primary key default gen_random_uuid(), project_id uuid not null,
  share_link_id uuid not null, session_hash text not null unique check (session_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null, revoked_at timestamptz, created_at timestamptz not null default now(),
  foreign key(project_id,share_link_id) references public.share_links(project_id,id) on delete restrict,
  unique(project_id,id), check (expires_at > created_at)
);
create index guest_sessions_link on public.guest_sessions(share_link_id);
create index guest_sessions_project on public.guest_sessions(project_id);

create table public.upload_reservations (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id) on delete restrict,
  actor_key text not null, storage_key text not null unique,
  reserved_bytes bigint not null check (reserved_bytes > 0),
  status text not null check (status in ('reserved','uploaded','validating','ready','rejected','expired','cleaned')),
  interaction_expires_at timestamptz not null, credential_expires_at timestamptz not null,
  cleanup_after timestamptz not null, created_at timestamptz not null default now(),
  unique(project_id,id), check (cleanup_after >= credential_expires_at)
);
create index uploads_project_state on public.upload_reservations(project_id,status);
create index uploads_cleanup on public.upload_reservations(cleanup_after) where status <> 'cleaned';

create table public.file_assets (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id) on delete restrict,
  reservation_id uuid not null unique,
  uploader_type text not null check (uploader_type in ('owner','guest')),
  uploader_user_id uuid references auth.users(id) on delete restrict, guest_session_id uuid,
  storage_key text not null unique, canonical_key text unique,
  filename text not null check (length(filename) between 1 and 255), mime text not null,
  byte_size bigint not null check (byte_size > 0 and byte_size <= 104857600),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'), canonical_sha256 text,
  kind text not null check (kind in ('image','pdf','cad','archive')),
  purpose text not null check (purpose in ('raw','evidence','delivery')),
  visibility text not null default 'customer' check (visibility in ('customer','owner')),
  state text not null default 'validating' check (state in ('validating','ready','rejected')),
  canonical_width integer, canonical_height integer, normalization_version integer,
  deleted_at timestamptz, created_at timestamptz not null default now(),
  foreign key(project_id,reservation_id) references public.upload_reservations(project_id,id) on delete restrict,
  foreign key(project_id,guest_session_id) references public.guest_sessions(project_id,id) on delete restrict,
  unique(project_id,id),
  check ((uploader_type='owner' and uploader_user_id is not null and guest_session_id is null)
    or (uploader_type='guest' and uploader_user_id is null and guest_session_id is not null)),
  check (not (uploader_type='guest' and purpose='delivery')),
  check (canonical_sha256 is null or canonical_sha256 ~ '^[0-9a-f]{64}$'),
  check (kind <> 'image' or state <> 'ready' or
    (canonical_key is not null and canonical_sha256 is not null and normalization_version is not null and normalization_version=1
     and canonical_width is not null and canonical_height is not null and canonical_width > 0 and canonical_height > 0
     and canonical_width::bigint*canonical_height::bigint <= 40000000))
);
create index files_project_created on public.file_assets(project_id,created_at desc,id);
create index files_uploader on public.file_assets(uploader_user_id);
create index files_guest_session on public.file_assets(guest_session_id);

create table public.annotations (
  id uuid primary key default gen_random_uuid(), project_id uuid not null, file_id uuid not null,
  revision integer not null default 1 check (revision > 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  deleted_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  foreign key(project_id,file_id) references public.file_assets(project_id,id) on delete restrict,
  unique(project_id,id), unique(project_id,file_id,id)
);
create index annotations_file on public.annotations(file_id);
create index annotations_creator on public.annotations(created_by);

create table public.annotation_revisions (
  project_id uuid not null, file_id uuid not null, annotation_id uuid not null,
  revision integer not null check (revision > 0), schema_version integer not null default 1 check (schema_version=1),
  type text not null check (type in ('line','circle','point','text')),
  geometry_json jsonb not null check (jsonb_typeof(geometry_json)='object'),
  metadata_json jsonb not null default '{}' check (jsonb_typeof(metadata_json)='object'),
  created_by uuid not null references auth.users(id) on delete restrict, created_at timestamptz not null default now(),
  primary key(project_id,annotation_id,revision),
  unique(project_id,file_id,annotation_id,revision),
  foreign key(project_id,file_id,annotation_id) references public.annotations(project_id,file_id,id) on delete restrict
);
create index annotation_revisions_file on public.annotation_revisions(file_id);
create index annotation_revisions_author on public.annotation_revisions(created_by);

create table public.issues (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id) on delete restrict,
  file_id uuid, annotation_id uuid, annotation_revision integer,
  kind text not null check (kind in ('measurement','comment')),
  title text not null check (length(title) between 1 and 120), description text not null default '' check(length(description)<=4000),
  status text not null default 'awaiting_response' check (status in ('awaiting_response','submitted','confirmed','remeasure_requested')),
  measurement_method text check (measurement_method in ('outside_jaws','inside_jaws','depth_rod','other','unspecified')),
  revision integer not null default 1 check (revision>0), created_at timestamptz not null default now(),
  foreign key(project_id,file_id) references public.file_assets(project_id,id) on delete restrict,
  foreign key(project_id,file_id,annotation_id,annotation_revision)
    references public.annotation_revisions(project_id,file_id,annotation_id,revision) on delete restrict,
  unique(project_id,id),
  check ((annotation_id is null and annotation_revision is null)
    or (annotation_id is not null and annotation_revision is not null and file_id is not null)),
  check (kind <> 'measurement' or (file_id is not null and annotation_id is not null and measurement_method is not null))
);
create index issues_project_state on public.issues(project_id,status,created_at,id);
create index issues_file on public.issues(file_id);
create index issues_annotation_revision on public.issues(project_id,annotation_id,annotation_revision);

create table public.issue_responses (
  id uuid primary key default gen_random_uuid(), project_id uuid not null, issue_id uuid not null,
  author_type text not null check (author_type in ('owner','guest')),
  author_user_id uuid references auth.users(id) on delete restrict, guest_session_id uuid,
  guest_label text check (length(guest_label)<=80),
  response_kind text not null check (response_kind in ('numeric','photo','unable','text')),
  numeric_value numeric(20,6), unit text check (unit in ('mm','cm','m','in','deg')),
  body text check (length(body)<=4000), created_at timestamptz not null default now(),
  foreign key(project_id,issue_id) references public.issues(project_id,id) on delete restrict,
  foreign key(project_id,guest_session_id) references public.guest_sessions(project_id,id) on delete restrict,
  unique(project_id,id), unique(project_id,issue_id,id),
  check ((author_type='owner' and author_user_id is not null and guest_session_id is null)
    or (author_type='guest' and author_user_id is null and guest_session_id is not null)),
  check ((response_kind='numeric' and numeric_value is not null and unit is not null
    and numeric_value >= 0 and numeric_value <> 'NaN'::numeric)
    or (response_kind<>'numeric' and numeric_value is null and unit is null)),
  check (response_kind not in ('unable','text') or length(btrim(body))>0 and body is not null)
);
create index responses_issue_created on public.issue_responses(issue_id,created_at,id);
create index responses_project on public.issue_responses(project_id);
create index responses_guest on public.issue_responses(guest_session_id);
create index responses_author on public.issue_responses(author_user_id);

create table public.response_attachments (
  project_id uuid not null, response_id uuid not null, file_id uuid not null,
  primary key(project_id,response_id,file_id),
  foreign key(project_id,response_id) references public.issue_responses(project_id,id) on delete restrict,
  foreign key(project_id,file_id) references public.file_assets(project_id,id) on delete restrict
);
create index response_attachments_file on public.response_attachments(file_id);

create table public.measurement_confirmations (
  id uuid primary key default gen_random_uuid(), project_id uuid not null, issue_id uuid not null,
  confirmed_response_id uuid not null,
  confirmed_value numeric(20,6), unit text check (unit in ('mm','cm','m','in','deg')),
  source text not null check (source in ('customer_numeric','owner_from_photo','owner_manual')),
  confirmed_by uuid not null references auth.users(id) on delete restrict,
  note text check (length(note)<=4000), confirmed_at timestamptz not null default now(),
  foreign key(project_id,issue_id) references public.issues(project_id,id) on delete restrict,
  foreign key(project_id,issue_id,confirmed_response_id) references public.issue_responses(project_id,issue_id,id) on delete restrict,
  check ((confirmed_value is null and unit is null) or (confirmed_value is not null and unit is not null
    and confirmed_value >= 0 and confirmed_value <> 'NaN'::numeric)),
  check (source='customer_numeric' or (note is not null and length(btrim(note))>0))
);
create index confirmations_issue_created on public.measurement_confirmations(issue_id,confirmed_at);
create index confirmations_project on public.measurement_confirmations(project_id);
create index confirmations_response on public.measurement_confirmations(confirmed_response_id);
create index confirmations_author on public.measurement_confirmations(confirmed_by);

create table public.deliveries (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id) on delete restrict,
  version_no integer check (version_no>0), description text not null default '' check(length(description)<=4000),
  revision integer not null default 1 check(revision>0),
  published_at timestamptz, published_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique(project_id,id), unique(project_id,version_no),
  check ((published_at is null and published_by is null and version_no is null)
    or (published_at is not null and published_by is not null and version_no is not null))
);
create index deliveries_publisher on public.deliveries(published_by);
create table public.delivery_files (
  project_id uuid not null, delivery_id uuid not null, file_id uuid not null,
  primary key(project_id,delivery_id,file_id),
  foreign key(project_id,delivery_id) references public.deliveries(project_id,id) on delete restrict,
  foreign key(project_id,file_id) references public.file_assets(project_id,id) on delete restrict
);
create index delivery_files_file on public.delivery_files(file_id);
create table public.delivery_feedback (
  id uuid primary key default gen_random_uuid(), project_id uuid not null, delivery_id uuid not null, guest_session_id uuid not null,
  kind text not null check (kind in ('comment','received','accepted')), body text check(length(body)<=4000),
  created_at timestamptz not null default now(),
  foreign key(project_id,delivery_id) references public.deliveries(project_id,id) on delete restrict,
  foreign key(project_id,guest_session_id) references public.guest_sessions(project_id,id) on delete restrict
);
create index feedback_delivery on public.delivery_feedback(delivery_id,created_at);
create index feedback_project on public.delivery_feedback(project_id);
create index feedback_guest on public.delivery_feedback(guest_session_id);

create table public.idempotency_keys (
  project_id uuid not null references public.projects(id) on delete restrict,
  actor_key text not null, action text not null, key uuid not null,
  request_hash text not null check(request_hash ~ '^[0-9a-f]{64}$'),
  result_json jsonb, http_status integer check(http_status between 200 and 599),
  expires_at timestamptz not null, created_at timestamptz not null default now(),
  primary key(project_id,actor_key,action,key)
);
create index idempotency_expiry on public.idempotency_keys(expires_at);
create table public.audit_events (
  id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects(id) on delete restrict,
  actor_type text not null check(actor_type in ('owner','guest','system')), actor_key text not null,
  action text not null, object_type text not null, object_id uuid, request_id uuid not null,
  -- No token, Cookie, signed URL, response body or arbitrary user text.
  created_at timestamptz not null default now()
);
create index audit_project_created on public.audit_events(project_id,created_at,id);

-- Triggers are invoker-only, fixed search_path, no privilege escalation.
create function private.reject_history_mutation() returns trigger language plpgsql
set search_path = '' as $$ begin raise exception 'immutable_history' using errcode='23514'; end $$;
revoke all on function private.reject_history_mutation() from public,anon,authenticated;
do $$ declare t text; begin
  foreach t in array array['annotation_revisions','issue_responses','response_attachments','measurement_confirmations','audit_events','delivery_feedback'] loop
    execute format('create trigger immutable_history before update or delete on public.%I for each row execute function private.reject_history_mutation()',t);
  end loop;
end $$;

create function private.guard_annotation_image() returns trigger language plpgsql set search_path='' as $$
begin
  if not exists(select 1 from public.file_assets f where f.project_id=new.project_id and f.id=new.file_id
    and f.kind='image' and f.state='ready' and f.deleted_at is null) then
    raise exception 'annotation_requires_ready_image' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function private.guard_annotation_image() from public,anon,authenticated;
create trigger annotation_image before insert or update on public.annotations for each row execute function private.guard_annotation_image();

create function private.guard_delivery() returns trigger language plpgsql set search_path='' as $$
begin
  if old.published_at is not null then raise exception 'published_delivery_immutable' using errcode='23514'; end if;
  if tg_op='UPDATE' then return new; end if;
  return old;
end $$;
revoke all on function private.guard_delivery() from public,anon,authenticated;
create trigger published_immutable before update or delete on public.deliveries for each row execute function private.guard_delivery();

create function private.guard_delivery_files() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op in ('UPDATE','DELETE') then
    perform 1 from public.deliveries where project_id=old.project_id and id=old.delivery_id and published_at is null for update;
    if not found then raise exception 'published_files_immutable' using errcode='23514'; end if;
  end if;
  if tg_op in ('INSERT','UPDATE') then
    perform 1 from public.deliveries where project_id=new.project_id and id=new.delivery_id and published_at is null for update;
    if not found then raise exception 'published_files_immutable' using errcode='23514'; end if;
    return new;
  end if;
  return old;
end $$;
revoke all on function private.guard_delivery_files() from public,anon,authenticated;
create trigger published_file_set before insert or update or delete on public.delivery_files for each row execute function private.guard_delivery_files();

create function private.guard_file_history() returns trigger language plpgsql set search_path='' as $$
begin
  if old.state='ready' and row(new.storage_key,new.sha256,new.byte_size,new.canonical_key,new.canonical_sha256,new.canonical_width,new.canonical_height,new.normalization_version,new.project_id,new.kind,new.state)
    is distinct from row(old.storage_key,old.sha256,old.byte_size,old.canonical_key,old.canonical_sha256,old.canonical_width,old.canonical_height,old.normalization_version,old.project_id,old.kind,old.state) then
    raise exception 'ready_content_immutable' using errcode='23514';
  end if;
  if new.deleted_at is distinct from old.deleted_at or new.visibility is distinct from old.visibility then
    if exists(select 1 from public.issues where project_id=old.project_id and file_id=old.id)
      or exists(select 1 from public.annotations where project_id=old.project_id and file_id=old.id)
      or exists(select 1 from public.response_attachments where project_id=old.project_id and file_id=old.id)
      or exists(select 1 from public.delivery_files where project_id=old.project_id and file_id=old.id) then
      raise exception 'history_protected_file' using errcode='23514';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.guard_file_history() from public,anon,authenticated;
create trigger preserve_file_history before update on public.file_assets for each row execute function private.guard_file_history();

-- Explicit ACL + RLS. No browser writes and NO Guest direct-DB capability.
do $$ declare t text; begin
  foreach t in array array['projects','share_links','guest_sessions','upload_reservations','file_assets','annotations','annotation_revisions','issues','issue_responses','response_attachments','measurement_confirmations','deliveries','delivery_files','delivery_feedback','idempotency_keys','audit_events'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select,insert,update,delete on public.%I to service_role',t);
  end loop;
end $$;
grant select on public.projects to authenticated;
create policy owner_select on public.projects for select to authenticated using(owner_id=(select auth.uid()));
do $$ declare t text; begin
  foreach t in array array['file_assets','annotations','annotation_revisions','issues','issue_responses','response_attachments','measurement_confirmations','deliveries','delivery_files','delivery_feedback','audit_events'] loop
    execute format('grant select on public.%I to authenticated',t);
    execute format('create policy owner_select on public.%I for select to authenticated using(exists(select 1 from public.projects p where p.id=project_id and p.owner_id=(select auth.uid())))',t);
  end loop;
end $$;

-- Private storage. No storage.objects anon/authenticated policy is introduced.
-- Existing project policies must be audited for unexpected broad grants before applying.
insert into storage.buckets(id,name,public,file_size_limit)
values('partmeasure-private','partmeasure-private',false,104857600);
commit;
