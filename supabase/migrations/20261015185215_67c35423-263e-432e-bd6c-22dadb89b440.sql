CREATE OR REPLACE FUNCTION public.fin_pnl_extras(_from date, _to date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _f timestamptz := (_from::timestamp AT TIME ZONE 'Asia/Kolkata'); _t timestamptz := ((_to + 1)::timestamp AT TIME ZONE 'Asia/Kolkata');
BEGIN
  IF NOT public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager','finance']) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  RETURN jsonb_build_object(
    'instant_fee', (SELECT coalesce(sum(instant_fee),0) FROM merchant_settlements WHERE paid_at>=_f AND paid_at<_t),
    'instant_fee_gst', (SELECT coalesce(sum(instant_fee_gst),0) FROM merchant_settlements WHERE paid_at>=_f AND paid_at<_t),
    'expenses_total', (SELECT coalesce(sum(amount),0) FROM operating_expenses WHERE expense_date BETWEEN _from AND _to),
    'expense_gst', (SELECT coalesce(sum(gst_paid),0) FROM operating_expenses WHERE expense_date BETWEEN _from AND _to),
    'expenses_by_category', (SELECT coalesce(jsonb_agg(jsonb_build_object('category',category,'amount',s) ORDER BY s DESC),'[]') FROM
       (SELECT category, sum(amount) s FROM operating_expenses WHERE expense_date BETWEEN _from AND _to GROUP BY category) c));
END $$;

CREATE OR REPLACE FUNCTION public.fin_ca_export(_from date, _to date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE _f timestamptz := (_from::timestamp AT TIME ZONE 'Asia/Kolkata'); _t timestamptz := ((_to + 1)::timestamp AT TIME ZONE 'Asia/Kolkata');
  _mask boolean := public.is_finance_staff();
BEGIN
  IF NOT public.is_active_staff(auth.uid(), ARRAY['super_admin','ops_manager','finance']) THEN RAISE EXCEPTION 'Forbidden'; END IF;
  RETURN jsonb_build_object(
    'sales', (SELECT coalesce(jsonb_agg(jsonb_build_object('Invoice no',invoice_no,'Date',invoice_date,'Status',status,'Service',service,'Order',ref_code,
        'Customer',customer_name,'Phone',CASE WHEN _mask THEN public.fin_mask_phone(customer_phone) ELSE customer_phone END,
        'Taxable value',taxable_value,'CGST',cgst,'SGST',sgst,'IGST',igst,'Total',total) ORDER BY invoice_no),'[]')
      FROM customer_invoices WHERE invoice_date BETWEEN _from AND _to),
    'credit_notes', (SELECT coalesce(jsonb_agg(jsonb_build_object('Credit note no',n.credit_note_no,'Date',n.note_date,'Original invoice',i.invoice_no,
        'Original invoice date',i.invoice_date,'Reason',n.reason,'Taxable value',n.taxable_value,'CGST',n.cgst,'SGST',n.sgst,'IGST',n.igst,'Total',n.total) ORDER BY n.credit_note_no),'[]')
      FROM customer_credit_notes n JOIN customer_invoices i ON i.id=n.invoice_id WHERE n.note_date BETWEEN _from AND _to),
    'expenses', (SELECT coalesce(jsonb_agg(jsonb_build_object('Date',expense_date,'Category',category,'Vendor',vendor,'Amount',amount,'GST paid',gst_paid,'Paid via',paid_via,'Note',note) ORDER BY expense_date),'[]')
      FROM operating_expenses WHERE expense_date BETWEEN _from AND _to),
    'settlements', (SELECT coalesce(jsonb_agg(jsonb_build_object('Invoice no',s.invoice_no,'Merchant',m.store_name,'Merchant GSTIN',m.gstin,'Type',s.type,'Status',s.status,
        'Period from',s.period_from,'Period to',s.period_to,'Gross',s.gross_amount,'Commission',s.commission_total,'Commission GST',s.commission_gst_total,
        'TCS',s.tcs_total,'TDS',s.tds_total,'Adjustments',s.adjustment_total,'Instant fee',s.instant_fee,'Instant fee GST',s.instant_fee_gst,'Net',s.net_amount,
        'Paid at',s.paid_at,'Reference',s.reference) ORDER BY s.created_at),'[]')
      FROM merchant_settlements s LEFT JOIN merchants m ON m.id=s.store_id
      WHERE coalesce(s.run_date, s.created_at::date) BETWEEN _from AND _to),
    'payouts', (SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at),'[]') FROM (
      SELECT b.id batch_id, b.status batch_status, b.created_at, i.owner_type, i.owner_id, to_jsonb(i) - ARRAY['id','batch_id','owner_type','owner_id','bank_account_number'] details
      FROM payout_batch_items i JOIN payout_batches b ON b.id=i.batch_id WHERE b.created_at>=_f AND b.created_at<_t) x),
    'wallet_ledger', (SELECT coalesce(jsonb_agg(jsonb_build_object('Date',l.created_at,'Customer id',l.user_id,'Type',l.type,'Bucket',l.bucket,'Amount',l.amount,
        'Cash after',l.cash_after,'Bonus after',l.bonus_after,'Reference',l.ref_type||' '||coalesce(l.ref_id,''),'Reason',l.reason) ORDER BY l.created_at),'[]')
      FROM customer_wallet_ledger l WHERE l.created_at>=_f AND l.created_at<_t),
    'tax', jsonb_build_object(
      'Output GST on invoices', (SELECT coalesce(sum(cgst+sgst+igst),0) FROM customer_invoices WHERE invoice_date BETWEEN _from AND _to AND status<>'draft'),
      'GST reversed by credit notes', (SELECT coalesce(sum(cgst+sgst+igst),0) FROM customer_credit_notes WHERE note_date BETWEEN _from AND _to),
      'GST on commission', (SELECT coalesce(sum(commission_gst_total),0) FROM merchant_settlements WHERE coalesce(run_date,created_at::date) BETWEEN _from AND _to),
      'GST on instant fee', (SELECT coalesce(sum(instant_fee_gst),0) FROM merchant_settlements WHERE paid_at>=_f AND paid_at<_t),
      'TCS collected', (SELECT coalesce(sum(tcs_total),0) FROM merchant_settlements WHERE coalesce(run_date,created_at::date) BETWEEN _from AND _to),
      'TDS 194-O deducted', (SELECT coalesce(sum(tds_total),0) FROM merchant_settlements WHERE coalesce(run_date,created_at::date) BETWEEN _from AND _to),
      'GST paid on expenses (input credit)', (SELECT coalesce(sum(gst_paid),0) FROM operating_expenses WHERE expense_date BETWEEN _from AND _to)));
END $$;
REVOKE EXECUTE ON FUNCTION public.fin_pnl_extras(date,date), public.fin_ca_export(date,date) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.fin_pnl_extras(date,date), public.fin_ca_export(date,date) TO authenticated;