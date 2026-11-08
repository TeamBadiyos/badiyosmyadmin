-- Run as database owner; all order changes and downstream effects roll back.
DO $test$
DECLARE _id uuid := '94accfac-8a9a-4def-9a99-6ce4da9fd36a'; _blocked boolean;
BEGIN
  IF (SELECT status FROM public.courier_orders WHERE id=_id) <> 'IN_TRANSIT' THEN
    RAISE EXCEPTION 'Fixture must be in transit';
  END IF;
  BEGIN
    PERFORM set_config('app.courier_actor_type','customer',true);
    _blocked:=false;
    BEGIN
      UPDATE public.courier_orders SET status='CANCELLED' WHERE id=_id;
    EXCEPTION WHEN OTHERS THEN _blocked:=true;
    END;
    IF NOT _blocked THEN RAISE EXCEPTION 'Customer in-transit cancellation was allowed'; END IF;
    RAISE EXCEPTION USING errcode='ZX001',message='rollback unauthorized test';
  EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL;
  END;
  BEGIN
      PERFORM set_config('app.courier_actor_type','staff',true);
      UPDATE public.courier_orders SET status='CANCELLED' WHERE id=_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Cancellation fixture not found'; END IF;
      IF (SELECT status FROM public.courier_orders WHERE id=_id)<>'CANCELLED' THEN
        RAISE EXCEPTION 'Backend staff cancellation failed';
      END IF;
      RAISE EXCEPTION USING errcode='ZX001',message='rollback cancellation';
    EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL;
    END;
  END;
END $test$;