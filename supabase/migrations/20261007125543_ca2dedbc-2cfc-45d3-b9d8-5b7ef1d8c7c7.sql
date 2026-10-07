ALTER TABLE public.merchant_orders ADD COLUMN IF NOT EXISTS is_training boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS merchant_orders_is_training_idx ON public.merchant_orders(is_training) WHERE is_training;

CREATE OR REPLACE FUNCTION public.admin_alert_on_merchant_paid() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE _name text;
BEGIN
  IF coalesce(NEW.is_training,false) THEN RETURN NEW; END IF;
  IF NOT public.admin_alert_enabled('admin_whatsapp_alert_enabled') THEN RETURN NEW; END IF;
  IF NOT public.admin_alert_enabled('admin_whatsapp_alert_merchant_enabled') THEN RETURN NEW; END IF;
  SELECT u.full_name INTO _name FROM public.users u WHERE u.id = NEW.user_id;
  PERFORM public.admin_alert_enqueue('merchant', NEW.id, 'Store Order', _name, coalesce(NEW.total_amount, 0), 'Now');
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'admin_alert_on_merchant_paid failed: %', sqlerrm;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.merchant_orders_ledger_on_complete() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
declare _net numeric; _comm jsonb; _base numeric;
begin
  if coalesce(NEW.is_training,false) then return NEW; end if;
  if NEW.status not in ('completed','delivered') then return NEW; end if;
  if coalesce(OLD.status,'') in ('completed','delivered') then return NEW; end if;
  if coalesce(NEW.payment_status,'') not in ('paid') then return NEW; end if;
  if coalesce(NEW.refund_status,'none') not in ('none') then return NEW; end if;
  if coalesce(NEW.merchant_net,0) > 0 then
    _net := NEW.merchant_net;
  else
    _base := case when NEW.courier_order_id is not null then coalesce(NEW.items_total,0) else coalesce(NEW.total_amount,0) end;
    _comm := public.store_commission_snapshot(NEW.merchant_id, _base);
    _net := (_comm->>'merchant_net')::numeric;
  end if;
  if _net > 0 then
    insert into public.wallet_ledger (owner_type, owner_id, amount, type, reason, wallet_type)
    values ('merchant', NEW.merchant_id, _net, 'credit', 'order:' || NEW.id::text, 'earnings')
    on conflict (owner_type, owner_id, reason) where owner_type = 'merchant' do nothing;
  end if;
  begin
    perform public.evaluate_reward_triggers('merchant', NEW.merchant_id, 'order_completed', NEW.id::text,
      jsonb_build_object('order_id', NEW.id, 'amount', coalesce(NEW.total_amount,0)));
  exception when others then raise warning '[merchant order reward] %', sqlerrm;
  end;
  return NEW;
end $$;