ALTER TABLE public.wallet_ledger ADD COLUMN adjustment_date date;
ALTER TABLE public.wallet_ledger ADD COLUMN effective_at timestamptz GENERATED ALWAYS AS (coalesce(adjustment_date::timestamp AT TIME ZONE 'Asia/Kolkata', created_at)) STORED;
COMMENT ON COLUMN public.wallet_ledger.adjustment_date IS 'Selected accounting date for manual adjustments; NULL preserves the original entry date.';
COMMENT ON COLUMN public.wallet_ledger.effective_at IS 'Accounting timestamp; manual adjustment date at India midnight, otherwise original created_at. Does not schedule wallet balance changes.';
CREATE OR REPLACE FUNCTION public.staff_wallet_adjust(_owner_type text, _owner_id uuid, _amount numeric, _type text, _reason text, _adjustment_date date)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE _ledger_id uuid;
BEGIN
  PERFORM public.require_staff();
  IF _adjustment_date IS NULL OR NOT isfinite(_adjustment_date) THEN RAISE EXCEPTION 'Adjustment date required'; END IF;
  -- The existing overload checks active Super Admin access and posts exactly once.
  _ledger_id := public.staff_wallet_adjust(_owner_type, _owner_id, _amount, _type, _reason);
  UPDATE public.wallet_ledger SET adjustment_date = _adjustment_date WHERE id = _ledger_id;
  UPDATE public.audit_logs SET after_state = after_state || jsonb_build_object('adjustment_date', _adjustment_date)
    WHERE target_table = 'wallet_ledger' AND target_id = _ledger_id AND action = 'wallet_adjust' AND actor_id = auth.uid();
  RETURN _ledger_id;
END $function$;
REVOKE ALL ON FUNCTION public.staff_wallet_adjust(text,uuid,numeric,text,text,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_wallet_adjust(text,uuid,numeric,text,text,date) TO authenticated, service_role;