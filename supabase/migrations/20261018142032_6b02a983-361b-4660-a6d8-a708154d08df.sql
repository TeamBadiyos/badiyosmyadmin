CREATE OR REPLACE FUNCTION public.ap_list_expert_applications(_status text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NOT public.is_area_partner_staff() THEN RAISE EXCEPTION 'Forbidden' USING errcode='42501'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object(
      'id',a.id,'name',a.name,'phone',mask_phone(a.phone),'zone_name',z.name,'work_types',a.work_types,'status',a.status,
      'submitted_at',a.submitted_at,'created_at',a.created_at,'missing',public.expert_application_missing(a),
      'recommended_at',a.recommended_at,'recommend_note',a.recommend_note) ORDER BY coalesce(a.submitted_at,a.created_at) DESC)
    FROM expert_applications a LEFT JOIN zones z ON z.id=a.preferred_zone_id
    WHERE a.preferred_zone_id = ANY(staff_my_zone_ids())
      AND ((_status IS NULL AND a.status<>'draft') OR a.status=_status)),'[]');
END $$;
REVOKE ALL ON FUNCTION public.ap_list_expert_applications(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ap_list_expert_applications(text) TO authenticated;

-- Read-only earnings for the signed-in area partner (matched by login → partners.auth_user_id)
CREATE OR REPLACE FUNCTION public.ap_my_earnings() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE _p partners;
BEGIN
  IF NOT public.is_area_partner_staff() THEN RAISE EXCEPTION 'Forbidden' USING errcode='42501'; END IF;
  SELECT * INTO _p FROM partners WHERE auth_user_id=auth.uid() ORDER BY created_at LIMIT 1;
  IF _p.id IS NULL THEN
    SELECT p.* INTO _p FROM partners p JOIN staff_users s ON s.auth_user_id=auth.uid()
      WHERE (s.phone IS NOT NULL AND right(regexp_replace(p.phone,'\D','','g'),10)=right(regexp_replace(s.phone,'\D','','g'),10))
         OR (s.email IS NOT NULL AND lower(p.login_email)=lower(s.email)) LIMIT 1;
  END IF;
  IF _p.id IS NULL THEN RETURN jsonb_build_object('partner', null); END IF;
  RETURN jsonb_build_object(
    'partner', jsonb_build_object('name',_p.name,'program',_p.program,'level',_p.level,'agreement_start',_p.agreement_start,'agreement_end',_p.agreement_end,'fee_paid',_p.fee_paid,'status',_p.status),
    'statements', coalesce((SELECT jsonb_agg(x ORDER BY x->>'period_start' DESC) FROM (
        SELECT jsonb_build_object('batch_id',b.id,'period_start',b.period_start,'period_end',b.period_end,'status',b.status,'paid_on',b.paid_on,
          'orders',count(l.id),'amount',sum(l.amount)) x
        FROM partner_payout_lines l JOIN partner_payout_batches b ON b.id=l.batch_id
        WHERE l.partner_id=_p.id AND NOT coalesce(l.is_deleted,false) AND b.deleted_at IS NULL
        GROUP BY b.id) s),'[]'),
    'payments', coalesce((SELECT jsonb_agg(jsonb_build_object('type',type,'amount',amount,'gst_amount',gst_amount,'paid_on',paid_on,'mode',mode,'reference',reference) ORDER BY paid_on DESC) FROM partner_payments WHERE partner_id=_p.id),'[]'),
    'agreements', coalesce((SELECT jsonb_agg(jsonb_build_object('id',g.id,'title',g.title,'status',g.status,'accepted_at',g.accepted_at,'version',g.template_version)) FROM agreements g WHERE g.party_type='partner' AND g.party_id=_p.id AND g.status<>'expired'),'[]'));
END $$;
REVOKE ALL ON FUNCTION public.ap_my_earnings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ap_my_earnings() TO authenticated;