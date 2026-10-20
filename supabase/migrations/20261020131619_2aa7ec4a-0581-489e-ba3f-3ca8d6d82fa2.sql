CREATE OR REPLACE FUNCTION public.require_staff()
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF auth.role() = 'service_role' OR current_user IN ('postgres','supabase_admin') THEN RETURN; END IF;
  IF public.is_active_staff(auth.uid()) OR public.is_area_partner_staff() THEN RETURN; END IF;
  RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
END $$;
REVOKE EXECUTE ON FUNCTION public.require_staff() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.require_staff() TO authenticated, service_role;

DO $do$
DECLARE r record; _def text; _new text; _n int := 0;
  _names text[] := ARRAY['staff_apply_product_category_map','staff_assign_business_plans','staff_business_dispatch_now','staff_business_reject_trip','staff_business_wallet_adjust','staff_campaign_audience_preview','staff_cancel_booking','staff_cancel_training_booking','staff_category_copy_default','staff_category_delete','staff_category_reorder','staff_close_service_today','staff_coupon_grant_phones','staff_coupon_revoke_grant','staff_courier_assignable_riders','staff_courier_reassign_rider','staff_courier_resolve_incident','staff_courier_skip_scan','staff_courier_verify_stop','staff_courier_waive_charge','staff_create_business_account','staff_create_training_broadcast','staff_delete_coupon','staff_delete_customer_address','staff_edit_booking','staff_expert_app_version_summary','staff_expert_kyc_decision','staff_handover_booking_expert','staff_insurance_stats','staff_list_bulk_plans','staff_list_unassigned_business_trips','staff_lucky_draw_delete_campaign','staff_lucky_draw_delete_prize','staff_lucky_draw_overview','staff_lucky_draw_publish','staff_lucky_draw_reset','staff_lucky_draw_run','staff_lucky_draw_save_campaign','staff_lucky_draw_save_prize','staff_offer_refundable','staff_partner_add_activity','staff_partner_batch_approve','staff_partner_batch_delete','staff_partner_batch_mark_paid','staff_partner_generate_payout','staff_partner_item_delete','staff_partner_kpi_rerun','staff_partner_lifecycle','staff_partner_line_delete','staff_partner_line_edit','staff_partner_plan_upsert','staff_partner_review_meeting','staff_partner_set_kyc','staff_partner_toggle','staff_partner_update_settings','staff_partner_upsert','staff_reassign_expert','staff_remove_service_holiday','staff_reopen_service_today','staff_reorder_homepage_sections','staff_reschedule_booking','staff_reset_clean_media','staff_reset_receiver_location','staff_save_app_versions','staff_save_clean_media','staff_seal_assign_batch','staff_seal_batch_export','staff_seal_create_batch','staff_seal_lookup','staff_seal_reassign_batch','staff_seal_void','staff_send_campaign','staff_send_campaign_test','staff_set_app_versions','staff_set_booking_location','staff_set_booking_note','staff_set_booking_refund','staff_set_business_proof_settings','staff_set_cancel_fee','staff_set_coupon_active','staff_set_coupon_categories','staff_set_coupon_free_service','staff_set_delivery_status','staff_set_expert_growth_partner','staff_set_homepage_section_active','staff_set_last_order_buffer','staff_set_lead_status','staff_set_merchant_modules','staff_set_milestone_active','staff_set_service_focus','staff_set_service_holiday','staff_set_service_hours','staff_set_service_hours_enabled','staff_set_service_status','staff_set_service_visible','staff_set_store_slug','staff_set_vehicle_archived','staff_soft_delete_booking','staff_soft_delete_merchant','staff_spin_redeem','staff_spin_save','staff_spin_set_prize_expiry','staff_spin_stats','staff_tax_report_ext','staff_transfer_completed_work','staff_undo_service_focus','staff_update_booking_status','staff_update_vehicle_lead','staff_upsert_business_profile','staff_upsert_campaign','staff_upsert_coupon','staff_upsert_customer_address','staff_upsert_dispatch_plan','staff_upsert_homepage_section','staff_upsert_milestone_program','staff_upsert_pickup_point','staff_upsert_pricing_plan','staff_upsert_vehicle','staff_verify_end_otp','staff_verify_start_otp','staff_wallet_adjust'];
BEGIN
  FOR r IN SELECT p.oid, p.prosrc FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang
           WHERE p.pronamespace='public'::regnamespace AND l.lanname='plpgsql' AND p.proname = ANY(_names)
             AND p.prosrc !~* 'require_staff' LOOP
    _new := regexp_replace(r.prosrc, '\mbegin\M', 'BEGIN PERFORM public.require_staff();', 'i');
    IF _new = r.prosrc THEN RAISE EXCEPTION 'no BEGIN in %', r.oid::regprocedure; END IF;
    _def := pg_get_functiondef(r.oid);
    IF position(r.prosrc in _def) = 0 THEN RAISE EXCEPTION 'body not found %', r.oid::regprocedure; END IF;
    EXECUTE replace(_def, r.prosrc, _new);
    _n := _n + 1;
  END LOOP;
  RAISE NOTICE 'guarded %', _n;
END $do$;

REVOKE EXECUTE ON FUNCTION public.staff_demand_top_names FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.staff_demand_top_names TO authenticated, service_role;