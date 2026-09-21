CREATE OR REPLACE FUNCTION public.notify_courier_offer_push(_offer_id uuid, _expert_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  _offer public.courier_offers%rowtype;
  _o public.courier_orders%rowtype;
  _title text;
  _body text;
BEGIN
  BEGIN
    IF _offer_id IS NULL OR _expert_id IS NULL THEN RETURN; END IF;

    SELECT * INTO _offer FROM public.courier_offers WHERE id = _offer_id;
    IF _offer.id IS NULL THEN RETURN; END IF;

    SELECT * INTO _o FROM public.courier_orders WHERE id = _offer.order_id;
    IF _o.id IS NULL THEN RETURN; END IF;

    _title := 'New parcel delivery request';
    _body := 'Rs ' || to_char(COALESCE(_o.total_amount, 0), 'FM999999990.00')
             || ' · ' || to_char(COALESCE(_o.distance_km, 0), 'FM999990.0') || ' km'
             || ' · pickup ' || COALESCE(left(_o.pickup_address, 40), '');

    PERFORM public.notify_push_event(
      'expert',
      _expert_id,
      'courier_offer',
      _title,
      _body,
      jsonb_build_object(
        'type', 'courier_offer',
        'route', '/courier',
        'offer_id', _offer.id,
        'order_id', _o.id,
        'order_code', _o.order_code,
        'expires_at', _offer.expires_at,
        'distance_km', _offer.distance_km,
        'total_amount', _o.total_amount,
        'pickup_address', _o.pickup_address,
        'drop_address', _o.drop_address
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[notify_courier_offer_push] failed for offer %: %', _offer_id, SQLERRM;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.notify_courier_offer_push(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notify_courier_offer_push(uuid, uuid) TO authenticated, service_role;