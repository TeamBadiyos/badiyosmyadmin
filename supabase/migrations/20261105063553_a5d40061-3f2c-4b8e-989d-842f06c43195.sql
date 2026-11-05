DO $$ DECLARE d text; BEGIN
  d := pg_get_functiondef('public.bookings_after_insert_coupon()'::regprocedure);
  d := replace(d, $x$WHERE coupon_id = NEW.coupon_id AND user_id = NEW.user_id AND status = 'available';$x$,
    $x$WHERE coupon_id = NEW.coupon_id AND user_id = NEW.user_id AND status = 'available'
     AND (SELECT count(*) FROM public.coupon_redemptions r WHERE r.coupon_id = NEW.coupon_id AND r.user_id = NEW.user_id AND r.status = 'applied')
         >= (SELECT GREATEST(COALESCE(per_user_limit,1),1) FROM public.coupons WHERE id = NEW.coupon_id);$x$);
  EXECUTE d;
  d := pg_get_functiondef('public.merchant_orders_promo_sync()'::regprocedure);
  d := replace(d, $x$UPDATE customer_coupons SET status='used', used_at=now() WHERE coupon_id=_cid AND user_id=NEW.user_id AND status='available';$x$,
    $x$UPDATE customer_coupons SET status='used', used_at=now() WHERE coupon_id=_cid AND user_id=NEW.user_id AND status='available'
        AND (SELECT count(*) FROM coupon_redemptions r WHERE r.coupon_id=_cid AND r.user_id=NEW.user_id AND r.status='applied')
            >= (SELECT GREATEST(COALESCE(per_user_limit,1),1) FROM coupons WHERE id=_cid);$x$);
  EXECUTE d;
END $$;

UPDATE public.customer_coupons cc SET status='available', used_at=NULL
FROM public.coupons c
WHERE c.id=cc.coupon_id AND cc.status='used'
  AND (SELECT count(*) FROM public.coupon_redemptions r WHERE r.coupon_id=c.id AND r.user_id=cc.user_id AND r.status='applied')
      < GREATEST(COALESCE(c.per_user_limit,1),1);