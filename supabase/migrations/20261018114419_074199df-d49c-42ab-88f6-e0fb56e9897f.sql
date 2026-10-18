do $do$
declare d text; f text;
begin
  foreach f in array array['public.zv2_switchover_apply(uuid,jsonb)','public.zv2_remap_zone(uuid,uuid)'] loop
    d := pg_get_functiondef(f::regprocedure);
    d := regexp_replace(d,
      'update courier_zones cz set zone_id\s*=\s*om\.new_id from zv2_om om where cz\.zone_id=om\.old_id\s+and not exists \(select 1 from courier_zones x where x\.zone_id=om\.new_id\);',
      'insert into courier_zones(zone_id, is_active) select om.new_id, bool_or(cz.is_active) from courier_zones cz join zv2_om om on om.old_id=cz.zone_id where om.new_id <> om.old_id group by om.new_id on conflict (zone_id) do update set is_active = courier_zones.is_active or excluded.is_active, updated_at = now();', 'g');
    d := regexp_replace(d,
      'delete from courier_zones where zone_id in \(select old_id from zv2_om\);',
      'delete from courier_zones where zone_id in (select old_id from zv2_om where old_id <> new_id);', 'g');
    d := regexp_replace(d,
      'update courier_zones set zone_id=_new where zone_id=_old and not exists \(select 1 from courier_zones x where x\.zone_id=_new\);\s*delete from courier_zones where zone_id=_old;',
      'if _new is distinct from _old then insert into courier_zones(zone_id, is_active) select _new, bool_or(is_active) from courier_zones where zone_id=_old having count(*)>0 on conflict (zone_id) do update set is_active = courier_zones.is_active or excluded.is_active, updated_at = now(); delete from courier_zones where zone_id=_old; end if;', 'g');
    if d ~ 'update courier_zones (cz )?set zone_id' then raise exception 'patch failed for %', f; end if;
    execute d;
  end loop;
end $do$;