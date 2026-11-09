-- Run as database owner; isolated temporary rows never touch live orders.
DO $test$
DECLARE _blocked boolean; _state text;
BEGIN
  CREATE TEMP TABLE courier_cancel_probe(status text) ON COMMIT DROP;
  CREATE TRIGGER guard BEFORE UPDATE ON courier_cancel_probe FOR EACH ROW EXECUTE FUNCTION public.courier_orders_guard();
  FOREACH _state IN ARRAY ARRAY['PICKED_UP','IN_TRANSIT'] LOOP
    INSERT INTO courier_cancel_probe VALUES(_state);
    PERFORM set_config('app.courier_actor_type','customer',true);
    _blocked:=false;
    BEGIN
      UPDATE courier_cancel_probe SET status='CANCELLED' WHERE status=_state;
    EXCEPTION WHEN OTHERS THEN _blocked:=true;
    END;
    IF NOT _blocked THEN RAISE EXCEPTION 'Customer cancellation allowed for %',_state; END IF;
    PERFORM set_config('app.courier_actor_type','staff',true);
    UPDATE courier_cancel_probe SET status='CANCELLED' WHERE status=_state;
    IF NOT FOUND THEN RAISE EXCEPTION 'Staff cancellation failed for %',_state; END IF;
  END LOOP;
END $test$;