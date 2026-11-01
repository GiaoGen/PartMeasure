-- Optional labelAt stores the arrow tail; at remains the target. No historical rows are rewritten.
create or replace function pm.valid_annotation_geometry_v1(g jsonb,w integer,h integer) returns boolean
language plpgsql immutable security invoker set search_path='' as $$
declare t text; p jsonb; x double precision; y double precision; rx double precision; ry double precision;
begin
 if jsonb_typeof(g)<>'object' or w<=0 or h<=0 then return false; end if;
 t:=g->>'type';
 if t not in ('line','circle','point','text') or t is null then return false; end if;
 if (t='line' and (g-array['type','from','to'])<>'{}') or
    (t='circle' and (g-array['type','center','radiusX','radiusY'])<>'{}') or
    (t='point' and (g-array['type','at'])<>'{}') or
    (t='text' and (g-array['type','at','text','labelAt'])<>'{}') then return false; end if;
 for p in select value from jsonb_array_elements(case when t='line' then jsonb_build_array(g->'from',g->'to') when t='circle' then jsonb_build_array(g->'center') when t='text' and g?'labelAt' then jsonb_build_array(g->'at',g->'labelAt') else jsonb_build_array(g->'at') end) loop
  if jsonb_typeof(p) is distinct from 'object' or (p-array['x','y'])<>'{}' or jsonb_typeof(p->'x') is distinct from 'number' or jsonb_typeof(p->'y') is distinct from 'number' then return false; end if;
  x:=(p->>'x')::double precision; y:=(p->>'y')::double precision;
  if not(x>=0 and x<=1 and y>=0 and y<=1) then return false; end if;
 end loop;
 if t='line' then
  return sqrt(power(((g->'from'->>'x')::double precision-(g->'to'->>'x')::double precision)*w,2)+power(((g->'from'->>'y')::double precision-(g->'to'->>'y')::double precision)*h,2))>=0.5;
 elsif t='circle' then
  if jsonb_typeof(g->'radiusX') is distinct from 'number' or jsonb_typeof(g->'radiusY') is distinct from 'number' then return false; end if;
  rx:=(g->>'radiusX')::double precision;ry:=(g->>'radiusY')::double precision;
  return rx*w>=0.5 and ry>0 and abs(rx*w-ry*h)<=0.5 and x-rx>=0 and x+rx<=1 and y-ry>=0 and y+ry<=1;
 elsif t='text' then
  if g?'labelAt' and sqrt(power(((g->'at'->>'x')::float8-(g->'labelAt'->>'x')::float8)*w,2)+power(((g->'at'->>'y')::float8-(g->'labelAt'->>'y')::float8)*h,2))<0.5 then return false; end if;
  return jsonb_typeof(g->'text')='string' and length(btrim(g->>'text')) between 1 and 500;
 end if;
 return true;
exception when others then return false;
end $$;
revoke all on function pm.valid_annotation_geometry_v1(jsonb,integer,integer) from public,anon,authenticated;
grant execute on function pm.valid_annotation_geometry_v1(jsonb,integer,integer) to partmeasure_runtime;


