-- Explicitly approved manual angle/arc/ellipse extension. Existing snapshots remain unchanged.
alter function pm.valid_annotation_geometry(jsonb,integer,integer) rename to valid_annotation_geometry_v1;
create function pm.valid_annotation_geometry(g jsonb,w integer,h integer) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare t text;p jsonb;ps jsonb;x float8;y float8;cx float8;cy float8;ax float8;ay float8;bx float8;end_y float8;
 ux float8;uy float8;vx float8;vy float8;rx float8;ry float8;dx float8;dy float8;crossp float8;chord float8;q float8;r float8;
 starta float8;enda float8;mida float8;positive float8;sweepa float8;atangle float8;along float8;i integer;tau float8:=2*pi();
begin
 if jsonb_typeof(g) is distinct from 'object' or w<=0 or h<=0 then return false;end if;
 t:=g->>'type';
 if t in ('line','circle','point','text') then return pm.valid_annotation_geometry_v1(g,w,h);end if;
 if t is null or t not in ('angle','arc','ellipse') then return false;end if;
 if t='angle' then
  if (g-array['type','vertex','from','to','reflex','arcScale'])<>'{}' or jsonb_typeof(g->'reflex') is distinct from 'boolean' then return false;end if;
  if g?'arcScale' and (jsonb_typeof(g->'arcScale') is distinct from 'number' or not((g->>'arcScale')::float8 between 0.1 and 0.85)) then return false;end if;
  ps:=jsonb_build_array(g->'vertex',g->'from',g->'to');
 elsif t='arc' then
  if (g-array['type','from','via','to'])<>'{}' then return false;end if;
  ps:=jsonb_build_array(g->'from',g->'via',g->'to');
 else
  if (g-array['type','center','axisA','axisB'])<>'{}' then return false;end if;
  ps:=jsonb_build_array(g->'center',g->'axisA',g->'axisB');
 end if;
 for p in select value from jsonb_array_elements(ps) loop
  if jsonb_typeof(p) is distinct from 'object' or (p-array['x','y'])<>'{}' or jsonb_typeof(p->'x') is distinct from 'number' or jsonb_typeof(p->'y') is distinct from 'number' then return false;end if;
  x:=(p->>'x')::float8;y:=(p->>'y')::float8;if not(x between 0 and 1 and y between 0 and 1) then return false;end if;
 end loop;
 cx:=(ps->0->>'x')::float8*w;cy:=(ps->0->>'y')::float8*h;
 ax:=(ps->1->>'x')::float8*w;ay:=(ps->1->>'y')::float8*h;
 bx:=(ps->2->>'x')::float8*w;end_y:=(ps->2->>'y')::float8*h;
 ux:=ax-cx;uy:=ay-cy;vx:=bx-cx;vy:=end_y-cy;
 if t='angle' then
  if sqrt(ux*ux+uy*uy)<0.5 or sqrt(vx*vx+vy*vy)<0.5 then return false;end if;
  atangle:=atan2(vy,vx)-atan2(uy,ux);return abs(atan2(sin(atangle),cos(atangle)))>=0.001;
 elsif t='ellipse' then
  rx:=sqrt(ux*ux+uy*uy);ry:=sqrt(vx*vx+vy*vy);
  dx:=sqrt(ux*ux+vx*vx);dy:=sqrt(uy*uy+vy*vy);
  return rx>=0.5 and ry>=0.5 and rx+1e-7>=ry and abs(ux*vx+uy*vy)<=1e-7*rx*ry
   and cx-dx>=-1e-9*w and cx+dx<=w*(1+1e-9) and cy-dy>=-1e-9*h and cy+dy<=h*(1+1e-9);
 end if;
 -- Here c is the start point, a the through point, b the end point.
 crossp:=ux*vy-uy*vx;chord:=greatest(sqrt(ux*ux+uy*uy),sqrt(vx*vx+vy*vy),sqrt(power(ax-bx,2)+power(ay-end_y,2)));
 if chord<0.5 or abs(crossp)/chord<0.5 or sqrt(vx*vx+vy*vy)<0.5 then return false;end if;
 q:=ux*ux+uy*uy;r:=vx*vx+vy*vy;
 dx:=cx+(vy*q-uy*r)/(2*crossp);dy:=cy+(ux*r-vx*q)/(2*crossp);
 rx:=sqrt(power(cx-dx,2)+power(cy-dy,2));starta:=atan2(cy-dy,cx-dx);enda:=atan2(end_y-dy,bx-dx);mida:=atan2(ay-dy,ax-dx);
 positive:=enda-starta;positive:=positive-floor(positive/tau)*tau;
 along:=mida-starta;along:=along-floor(along/tau)*tau;
 sweepa:=case when along<positive then positive else positive-tau end;
 for i in 0..3 loop
  atangle:=i*pi()/2;along:=case when sweepa>0 then atangle-starta else starta-atangle end;
  along:=along-floor(along/tau)*tau;
  if along<=abs(sweepa)+1e-10 then
   x:=dx+rx*cos(atangle);y:=dy+rx*sin(atangle);
   if x< -1e-9*w or x>w*(1+1e-9) or y< -1e-9*h or y>h*(1+1e-9) then return false;end if;
  end if;
 end loop;
 return true;
exception when others then return false;
end $$;
revoke all on function pm.valid_annotation_geometry(jsonb,integer,integer) from public,anon,authenticated;
grant execute on function pm.valid_annotation_geometry(jsonb,integer,integer) to partmeasure_runtime;
alter table pm.annotations drop constraint annotations_schema_version_check;
alter table pm.annotations add constraint annotations_schema_version_check check(schema_version in (1,2)),
 add constraint annotation_geometry_version check((schema_version=1 and geometry->>'type' in ('line','circle','point','text')) or (schema_version=2 and geometry->>'type' in ('angle','arc','ellipse')));
alter table pm.issues drop constraint issues_measurement_field_check;
alter table pm.issues add constraint issues_measurement_field_check check(measurement_field in ('dimension','holeDepth','angleValue','arcLength','majorRadius'));
-- Replace only the two existing unit/value combination checks, leaving all actor/history checks intact.
do $$ declare c record;begin
 for c in select conname,conrelid::regclass tbl from pg_constraint where conrelid in ('pm.issue_responses'::regclass,'pm.issue_reviews'::regclass) and contype='c' and pg_get_constraintdef(oid) like '%unit%' loop
  execute format('alter table %s drop constraint %I',c.tbl,c.conname);
 end loop;
end $$;
alter table pm.issue_responses add constraint response_value_units check(
 (kind='numeric' and value is not null and value ~ '^(0|[1-9][0-9]{0,8})(\.[0-9]{1,6})?$' and value::numeric>0 and unit is not null and unit in ('mm','cm','m','in','deg')) or (kind<>'numeric' and value is null and unit is null));
alter table pm.issue_reviews add constraint review_value_units check(
 (decision='remeasure' and source is null and value is null and unit is null and length(btrim(note))>0) or
 (decision='confirm' and source is not null and ((source='comment' and value is null and unit is null) or (source in ('customer_numeric','owner_from_photo','owner_manual') and value is not null and value ~ '^(0|[1-9][0-9]{0,8})(\.[0-9]{1,6})?$' and value::numeric>0 and unit is not null and unit in ('mm','cm','m','in','deg')))));
create function pm.valid_measurement_value(v text,u text,f text) returns boolean language sql immutable security invoker set search_path='' as $$
 select coalesce(v ~ '^(0|[1-9][0-9]{0,8})(\.[0-9]{1,6})?$' and v::numeric>0 and
 case when f='angleValue' then u='deg' and v::numeric<360 else u in ('mm','cm','m','in') end,false)
$$;
revoke all on function pm.valid_measurement_value(text,text,text) from public,anon,authenticated;
grant execute on function pm.valid_measurement_value(text,text,text) to partmeasure_runtime;
create or replace function pm.check_issue_response() returns trigger language plpgsql security invoker set search_path='' as $$
declare i record;
begin
 select * into i from pm.issues where id=new.issue_id and project_id=new.project_id;
 if not found or i.closed_at is not null or i.state not in ('awaiting_response','remeasure_requested') or i.revision<>new.issue_revision or (i.kind='comment')<>(new.kind='text') then raise exception 'INVALID_RESPONSE_STATE' using errcode='23514'; end if;
 if new.author_type='owner' then
  if not pm.is_owner(new.project_id) or new.owner_id is distinct from pm.owner_id() then raise exception 'INVALID_RESPONSE_ACTOR' using errcode='42501'; end if;
 elsif pm.owner_id() is not null or not exists(select 1 from pm.guest_sessions s where s.id=new.guest_session_id and s.project_id=new.project_id and s.token_hash=nullif(current_setting('pm.guest_hash',true),'') and s.expires_at>now()) or not pm.can_read(new.project_id) then raise exception 'INVALID_RESPONSE_ACTOR' using errcode='42501'; end if;
 if new.kind='numeric' and not pm.valid_measurement_value(new.value,new.unit,i.measurement_field) then raise exception 'INVALID_MEASUREMENT_UNIT' using errcode='23514'; end if;
 return new;
end $$;
create or replace function pm.check_issue_review() returns trigger language plpgsql security invoker set search_path='' as $$
declare i record;r record;
begin
 select * into i from pm.issues where id=new.issue_id and project_id=new.project_id;
 if not found or not pm.is_owner(new.project_id) or new.created_by is distinct from pm.owner_id() then raise exception 'INVALID_REVIEW_ACTOR' using errcode='42501'; end if;
 if i.closed_at is not null or i.state<>'submitted' or i.revision<>new.issue_revision or i.latest_response_id<>new.response_id then raise exception 'INVALID_REVIEW_STATE' using errcode='23514'; end if;
 select * into r from pm.issue_responses where id=new.response_id and issue_id=new.issue_id and project_id=new.project_id;
 if not found then raise exception 'INVALID_REVIEW_RESPONSE' using errcode='23514'; end if;
 if new.decision='confirm' then
  if i.kind='measurement' and not pm.valid_measurement_value(new.value,new.unit,i.measurement_field) then raise exception 'INVALID_MEASUREMENT_UNIT' using errcode='23514'; end if;
  if i.kind='comment' then
   if new.source is distinct from 'comment' then raise exception 'INVALID_REVIEW_SOURCE' using errcode='23514'; end if;
  elsif new.source is null or new.source='comment' then raise exception 'INVALID_REVIEW_SOURCE' using errcode='23514';
  elsif new.source='customer_numeric' then
   if r.kind<>'numeric' or new.value is distinct from r.value or new.unit is distinct from r.unit then raise exception 'INVALID_REVIEW_SOURCE' using errcode='23514'; end if;
  elsif length(btrim(new.note))=0 or (new.source='owner_from_photo' and r.kind<>'photo') then raise exception 'MANUAL_SOURCE_NOTE_REQUIRED' using errcode='23514'; end if;
 end if;
 return new;
end $$;
