CREATE OR REPLACE FUNCTION public.courier_orders_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare _allowed text[];
begin
  if NEW.status = OLD.status then return NEW; end if;
  if OLD.status in ('PICKED_UP','IN_TRANSIT') and NEW.status='CANCELLED'
     and current_setting('app.courier_actor_type',true)='staff'
     and (public.courier_is_ops_staff() or (auth.uid() is null and session_user in ('postgres','supabase_admin'))) then
    return NEW;
  end if;
  _allowed := case OLD.status
    when 'REQUESTED' then array['SEARCHING','CANCELLED']
    when 'SEARCHING' then array['DRIVER_ASSIGNED','CANCELLED']
    when 'DRIVER_ASSIGNED' then array['ARRIVED_PICKUP','SEARCHING','CANCELLED']
    when 'ARRIVED_PICKUP' then array['PICKED_UP','SEARCHING','CANCELLED']
    when 'PICKED_UP' then array['IN_TRANSIT','FAILED_DELIVERY']
    when 'IN_TRANSIT' then array['DELIVERED','FAILED_DELIVERY']
    when 'DELIVERED' then array['COMPLETED']
    when 'FAILED_DELIVERY' then array['COMPLETED','CANCELLED']
    else array[]::text[] end;
  if not (NEW.status = any(_allowed)) then
    raise exception 'Invalid courier status transition % -> %', OLD.status, NEW.status;
  end if;
  return NEW;
end $function$;

-- Rolled-back regression: customer cancellation remains blocked, staff maintenance succeeds.
DO $test$
DECLARE _blocked boolean; _state text;
BEGIN
  CREATE TEMP TABLE courier_cancel_probe(status text) ON COMMIT DROP;
  CREATE TRIGGER guard BEFORE UPDATE ON courier_cancel_probe FOR EACH ROW EXECUTE FUNCTION public.courier_orders_guard();
  FOREACH _state IN ARRAY ARRAY['PICKED_UP','IN_TRANSIT'] LOOP
    INSERT INTO courier_cancel_probe VALUES(_state);
    PERFORM set_config('app.courier_actor_type','customer',true);
    _blocked:=false;
    BEGIN UPDATE courier_cancel_probe SET status='CANCELLED' WHERE status=_state;
    EXCEPTION WHEN OTHERS THEN _blocked:=true; END;
    IF NOT _blocked THEN RAISE EXCEPTION 'Customer cancellation allowed for %',_state; END IF;
    PERFORM set_config('app.courier_actor_type','staff',true);
    UPDATE courier_cancel_probe SET status='CANCELLED' WHERE status=_state;
    IF NOT FOUND THEN RAISE EXCEPTION 'Staff cancellation failed for %',_state; END IF;
  END LOOP;
END $test$;

-- One-off trusted maintenance; do not impersonate a staff login.
DO $cancel$
DECLARE _o public.courier_orders%rowtype; _refund numeric; _audit_actor uuid;
BEGIN
  SELECT auth_user_id INTO _audit_actor FROM public.staff_users WHERE auth_user_id='ad3ac608-46a5-49b4-8acc-ec39b043da20' AND role='super_admin' AND status='active';
  IF _audit_actor IS NULL THEN RAISE EXCEPTION 'Active maintenance audit owner not found'; END IF;
  SELECT * INTO _o FROM public.courier_orders WHERE id='94accfac-8a9a-4def-9a99-6ce4da9fd36a' FOR UPDATE;
  IF _o.order_code IS DISTINCT FROM 'EFAF76D2' OR _o.status NOT IN ('IN_TRANSIT','FAILED_DELIVERY') THEN RAISE EXCEPTION 'Order changed; cancellation aborted'; END IF;
  _refund:=case when _o.payment_status in ('paid','refund_pending') then _o.total_amount else 0 end;
  PERFORM set_config('app.courier_actor_type','staff',true);
  UPDATE public.courier_orders SET status='CANCELLED',cancelled_by='staff',cancelled_at=now(),cancel_reason_code='Cancelled from backend at Gaurav Baheti request; CC status transition blocked',needs_ops_attention=false WHERE id=_o.id;
  UPDATE public.courier_offers SET status='cancelled' WHERE order_id=_o.id AND status='pending';
  IF _o.assigned_expert_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.courier_orders WHERE assigned_expert_id=_o.assigned_expert_id AND id<>_o.id AND status IN ('DRIVER_ASSIGNED','ARRIVED_PICKUP','PICKED_UP','IN_TRANSIT')) THEN UPDATE public.experts SET is_busy=false WHERE id=_o.assigned_expert_id; END IF;
  IF coalesce(_o.refund_amount,0)=0 THEN PERFORM public.courier_mark_refund_pending(_o.id,_refund,'staff_cancelled'); END IF;
  INSERT INTO public.audit_logs(actor_id,action,target_table,target_id,before_state,after_state)
  VALUES(_audit_actor,'courier_force_cancel_backend','courier_orders',_o.id,to_jsonb(_o),(SELECT to_jsonb(c)||jsonb_build_object('maintenance_requested_by','Gaurav Baheti','maintenance_source','CC cancellation failure image-181','maintenance_execution','trusted database maintenance, not an authenticated staff session') FROM public.courier_orders c WHERE c.id=_o.id));
END $cancel$;