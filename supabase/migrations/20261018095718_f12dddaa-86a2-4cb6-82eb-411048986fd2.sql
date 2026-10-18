
revoke all on function public.zone_off_guard() from public, anon, authenticated;
revoke execute on function public.zv2_cell_refs(uuid) from public, anon;
revoke execute on function public.zv2_delete_cell(uuid,uuid) from public, anon;
revoke execute on function public.staff_set_zone_off(uuid,boolean,text,timestamptz) from public, anon;
revoke execute on function public.zv2_fill_gaps_preview(uuid) from public, anon;
revoke execute on function public.zv2_fill_gaps_apply(uuid,int[]) from public, anon;
revoke execute on function public.zv2_cities() from public, anon;
revoke execute on function public.zv2_state(uuid) from public, anon;
revoke execute on function public.zv2_save_zone(uuid,uuid,text,text,jsonb) from public, anon;
revoke execute on function public.zv2_save_boundary(uuid,jsonb,text,boolean) from public, anon;
revoke execute on function public.zv2_switchover_apply(uuid,jsonb) from public, anon;
grant execute on function public.zv2_state(uuid), public.zv2_save_zone(uuid,uuid,text,text,jsonb), public.zv2_save_boundary(uuid,jsonb,text,boolean), public.zv2_switchover_apply(uuid,jsonb) to authenticated;
