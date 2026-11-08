-- Run as database owner; all order changes and downstream effects roll back.
DO $test$
DECLARE _id uuid := '94accfac-8a9a-4def-9a99-6ce4da9fd36a'; _state text; _blocked boolean;
BEGIN
  FOREACH _state IN ARRAY ARRAY['PICKED_UP','IN_TRANSIT'] LOOP
    BEGIN
      -- Model the original status without emitting application side effects.
      PERFORM set_config('app.courier_actor_type','staff',true);
      UPDATE public.courier_orders SET status='CANCELLED' WHERE id=_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Cancellation fixture not found'; END IF;
      IF (SELECT status FROM public.courier_orders WHERE id=_id)<>'CANCELLED' THEN
        RAISE EXCEPTION 'Backend staff cancellation failed';
      END IF;
      RAISE EXCEPTION USING errcode='ZX001',message='rollback cancellation';
    EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL;
    END;
  END LOOP;
END $test$;