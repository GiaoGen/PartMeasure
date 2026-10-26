-- P3-03: real isolated PostgreSQL; no Auth identity simulation is claimed.
-- Run on a real partmeasure_runtime connection through verify-isolated.mjs.
-- All fixture rows and writes are rolled back. Only synthetic project/file metadata; no Storage deletion.
begin;
set local statement_timeout='15000';
set local lock_timeout='2000';
do $audit$
declare
 a uuid; b uuid; p uuid:=gen_random_uuid(); other_p uuid:=gen_random_uuid();
 link uuid:=gen_random_uuid(); session1 uuid:=gen_random_uuid(); session2 uuid:=gen_random_uuid();
 gh text:=repeat(md5(gen_random_uuid()::text),2); gh2 text:=repeat(md5(gen_random_uuid()::text),2);
 lh text:=repeat(md5(gen_random_uuid()::text),2); f uuid; mat uuid:=gen_random_uuid(); draft_file uuid:=gen_random_uuid();
 published_file uuid:=gen_random_uuid(); draft uuid:=gen_random_uuid(); v1 uuid:=gen_random_uuid(); v2 uuid:=gen_random_uuid();
 ann uuid:=gen_random_uuid(); issue uuid:=gen_random_uuid(); reply uuid:=gen_random_uuid(); receipt uuid;
 processing uuid:=gen_random_uuid(); denied boolean; results jsonb:='[]'::jsonb; purpose text;
 geom jsonb:='{"type":"line","from":{"x":0.2,"y":0.2},"to":{"x":0.8,"y":0.2}}';
 meta jsonb:='{"name":"P3-03 synthetic","dimension":"","unit":"mm","source":"human","circleMeasure":"diameter","holeDepth":"","holeType":"","thread":"","notes":""}';
begin
 a:=current_setting('pm.fixture_owner_a')::uuid;
 b:=current_setting('pm.fixture_owner_b')::uuid;
 if a is null or b is null then raise exception 'TWO_EXISTING_TEST_USERS_REQUIRED'; end if;
 if has_schema_privilege('anon','pm','usage') or has_schema_privilege('authenticated','pm','usage')
 or exists(select 1 from pg_roles where rolname in ('partmeasure_runtime','partmeasure_worker') and (rolsuper or rolbypassrls)) then raise exception 'UNSAFE_ROLE_GRANTS'; end if;
 results:=results||jsonb_build_array('browser roles lack private schema; runtime has no RLS bypass');
 if current_user<>'partmeasure_runtime' then raise exception 'RUNTIME_ROLE_REQUIRED'; end if;
 perform set_config('pm.owner_id',a::text,true),set_config('pm.guest_hash','',true),set_config('pm.link_hash','',true);
 insert into pm.projects(id,owner_id,name) values(p,a,'P3-03 rollback synthetic');
 insert into pm.share_links(id,project_id,token_hash) values(link,p,lh);
 perform set_config('pm.link_hash',lh,true);
 insert into pm.guest_sessions(id,project_id,share_id,token_hash) values(session1,p,link,gh),(session2,p,link,gh2);
 perform set_config('pm.processing_token',processing::text,true);
 foreach f in array array[mat,draft_file,published_file] loop
  purpose:=case when f=mat then 'material' else 'delivery' end;
  insert into pm.upload_reservations(id,project_id,actor_key,filename,extension,declared_mime,byte_size,sha256,reserved_bytes,quarantine_key,purpose,state,processing_token,processing_until)
  values(f,p,'owner:'||a::text,'synthetic.png','png','image/png',8,repeat(md5(f::text),2),83886088,p::text||'/'||f::text||'/source',purpose,'processing',processing,now()+interval '60 seconds');
  insert into pm.file_assets(id,project_id,reservation_id,filename,mime,extension,byte_size,original_bytes,storage_key,original_key,sha256,original_sha256,width,height,normalization_version,uploader_type,purpose,visibility,validation_policy)
  values(f,p,f,'synthetic.png','image/webp','png',8,8,p::text||'/'||f::text||'/canonical.webp',p::text||'/'||f::text||'/source',repeat(md5(f::text),2),repeat(md5(f::text),2),100,80,1,'owner',purpose,case when purpose='delivery' then 'internal' else 'customer' end,'format-only-v2');
  update pm.upload_reservations set state='ready',processing_token=null,processing_until=null where id=f;
 end loop;
 insert into pm.annotations(id,project_id,file_id,image_hash,normalization_version,geometry,metadata,revision)
 values(ann,p,mat,repeat(md5(mat::text),2),1,geom,meta,1);
 insert into pm.issues(id,project_id,file_id,kind,title,created_by,annotation_id,annotation_revision,annotation_snapshot,target_info,measurement_field)
 values(issue,p,mat,'measurement','P3-03 synthetic',a,ann,1,jsonb_build_object('geometry',geom,'metadata',meta),'synthetic dimension','dimension');
 update pm.annotations set metadata=meta||'{"name":"new head"}',revision=2 where id=ann;
 insert into pm.deliveries(id,project_id,created_by) values(draft,p,a),(v1,p,a),(v2,p,a);
 insert into pm.delivery_files(project_id,delivery_id,file_id,position) values(p,draft,draft_file,1),(p,v1,published_file,1),(p,v2,published_file,1);
 update pm.deliveries set state='published',version_no=1,published_by=a,published_at=now(),revision=2 where id=v1;
 update pm.file_assets set history_protected=true,visibility='customer' where id=published_file;
 update pm.deliveries set state='published',version_no=2,published_by=a,published_at=now(),revision=2 where id=v2;
 set constraints all immediate;
 set constraints all deferred;
 results:=results||jsonb_build_array('runtime-only synthetic upload/finalize metadata and two atomic immutable versions');
 perform set_config('pm.owner_id',b::text,true);
 insert into pm.projects(id,owner_id,name) values(other_p,b,'P3-03 rollback other');
 if exists(select 1 from pm.projects where id=p) or exists(select 1 from pm.file_assets where project_id=p)
 or exists(select 1 from pm.deliveries where project_id=p) or exists(select 1 from pm.annotation_revisions where project_id=p) then raise exception 'OWNER_ISOLATION_FAILED'; end if;
 denied:=false;
 begin insert into pm.deliveries(project_id,created_by) values(p,b); exception when insufficient_privilege or check_violation then denied:=true; end;
 if not denied then raise exception 'CROSS_OWNER_WRITE'; end if;
 results:=results||jsonb_build_array('Owner B cannot read/write Owner A project/files/versions/revisions');
 perform set_config('pm.owner_id','',true),set_config('pm.guest_hash',gh,true);
 if not exists(select 1 from pm.projects where id=p) or exists(select 1 from pm.projects where id=other_p)
 or exists(select 1 from pm.deliveries where id=draft) or exists(select 1 from pm.file_assets where id=draft_file)
 or exists(select 1 from pm.delivery_files where delivery_id=draft)
 or exists(select 1 from pm.annotation_revisions where project_id=p) then raise exception 'GUEST_PRIVATE_BOUNDARY'; end if;
 if (select count(*) from pm.deliveries where project_id=p)<>2
 or (select count(*) from pm.delivery_files where project_id=p)<>2
 or (select annotation_snapshot->'metadata'->>'name' from pm.issues where id=issue)<>'P3-03 synthetic' then raise exception 'GUEST_HISTORY_READ'; end if;
 results:=results||jsonb_build_array('Guest sees both published versions and fixed issue snapshot, no private draft/revision/other project');
 denied:=false;
 begin insert into pm.annotations(id,project_id,file_id,image_hash,normalization_version,geometry,metadata,revision)
 values(gen_random_uuid(),p,mat,repeat(md5(mat::text),2),1,geom,meta,1); exception when insufficient_privilege or check_violation then denied:=true; end;
 if not denied then raise exception 'GUEST_ANNOTATION_WRITE'; end if;
 denied:=false;
 begin insert into pm.issue_responses(project_id,issue_id,issue_revision,kind,value,unit,author_type,owner_id) values(p,issue,1,'numeric','12','mm','owner',a); exception when insufficient_privilege or check_violation then denied:=true; end;
 if not denied then raise exception 'FORGED_RESPONSE_ACTOR'; end if;
 insert into pm.issue_responses(id,project_id,issue_id,issue_revision,kind,value,unit,author_type,guest_session_id) values(reply,p,issue,1,'numeric','12','mm','guest',session1);
 update pm.issues set state='submitted',revision=2,latest_response_id=reply where id=issue;
 set constraints all immediate;
 set constraints all deferred;
 denied:=false;
 begin update pm.issue_responses set body='overwrite' where id=reply; exception when insufficient_privilege or check_violation then denied:=true; end;
 if not denied then raise exception 'MUTABLE_RESPONSE_HISTORY'; end if;
 results:=results||jsonb_build_array('Guest annotation/forged-author writes denied; real appended numeric reply atomically completes; reply immutable');
 insert into pm.delivery_feedback(project_id,delivery_id,guest_session_id,kind) values(p,v1,session1,'accepted') returning id into receipt;
 perform set_config('pm.guest_hash',gh2,true);
 denied:=false;
 begin insert into pm.delivery_feedback(project_id,delivery_id,guest_session_id,kind,target_id) values(p,v1,session2,'withdrawn',receipt); exception when insufficient_privilege or check_violation then denied:=true; end;
 if not denied then raise exception 'FOREIGN_RECEIPT_WITHDRAWAL'; end if;
 perform set_config('pm.guest_hash',gh,true);
 insert into pm.delivery_feedback(project_id,delivery_id,guest_session_id,kind,target_id) values(p,v1,session1,'withdrawn',receipt);
 denied:=false;
 begin insert into pm.delivery_feedback(project_id,delivery_id,guest_session_id,kind,body) values(p,draft,session1,'comment','draft probe'); exception when insufficient_privilege or check_violation then denied:=true; end;
 if not denied then raise exception 'DRAFT_FEEDBACK_ACCESS'; end if;
 results:=results||jsonb_build_array('Guest can withdraw own receipt only; draft feedback denied');
 perform set_config('pm.owner_id',a::text,true),set_config('pm.guest_hash','',true);
 denied:=false;
 begin update pm.deliveries set description='overwrite',revision=revision+1 where id=v1; exception when insufficient_privilege or check_violation then denied:=true; end;
 if not denied then raise exception 'MUTABLE_PUBLISHED_VERSION'; end if;
 denied:=false;
 begin update pm.file_assets set deleted_at=now() where id=published_file; exception when insufficient_privilege or check_violation then denied:=true; end;
 if not denied then raise exception 'DELETABLE_HISTORY_FILE'; end if;
 denied:=false;
 begin update pm.annotation_revisions set metadata='{}' where annotation_id=ann; exception when insufficient_privilege or check_violation then denied:=true; end;
 if not denied then raise exception 'MUTABLE_FIXED_REVISION'; end if;
 results:=results||jsonb_build_array('Owner cannot overwrite published versions/fixed revisions or hide protected attachment');
 update pm.projects set archived_at=now(),revision=revision+1 where id=p;
 perform set_config('pm.owner_id','',true),set_config('pm.guest_hash',gh,true);
 if not exists(select 1 from pm.file_assets where id=mat) or not exists(select 1 from pm.deliveries where id=v1) then raise exception 'ARCHIVE_READ_LOST'; end if;
 denied:=false;
 begin insert into pm.delivery_feedback(project_id,delivery_id,guest_session_id,kind,body) values(p,v1,session1,'comment','archive probe'); exception when insufficient_privilege or check_violation or sqlstate '55000' then denied:=true; end;
 if not denied then raise exception 'ARCHIVED_WRITE'; end if;
 perform set_config('pm.owner_id',a::text,true),set_config('pm.guest_hash','',true);
 update pm.share_links set revoked_at=now() where id=link;
 update pm.projects set archived_at=null,revision=revision+1 where id=p;
 perform set_config('pm.owner_id','',true),set_config('pm.guest_hash',gh,true);
 if exists(select 1 from pm.projects where id=p) or exists(select 1 from pm.file_assets where project_id=p)
 or exists(select 1 from pm.deliveries where project_id=p) or exists(select 1 from pm.issues where project_id=p)
 or exists(select 1 from pm.delivery_feedback where project_id=p) then raise exception 'REVOKED_SESSION_READ'; end if;
 denied:=false;
 begin insert into pm.delivery_feedback(project_id,delivery_id,guest_session_id,kind,body) values(p,v1,session1,'comment','revoke probe'); exception when insufficient_privilege or check_violation then denied:=true; end;
 if not denied then raise exception 'REVOKED_SESSION_WRITE'; end if;
 results:=results||jsonb_build_array('archive preserves reads/blocks writes; revoke on archive persists after restore and denies existing-session reads/writes');
 perform set_config('pm.p303_results',results::text,true);
end $audit$;
select jsonb_build_object('role','partmeasure_runtime (explicitly asserted inside fixture)','scope','PostgreSQL RLS/triggers with server identity contexts; environment identified by runner. Synthetic metadata only, not Auth/Storage HTTP acceptance','results',current_setting('pm.p303_results')::jsonb,'disposition','all fixture writes rolled back') as evidence;
rollback;
