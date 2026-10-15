DO $$ DECLARE f text; BEGIN
FOREACH f IN ARRAY ARRAY['staff_save_agreement_template(text,text,text,boolean)','staff_send_agreement(text,uuid,text)','staff_mark_agreement_paper(uuid,text)','staff_party_agreements(text,uuid)','staff_list_unsigned_agreements()','app_my_agreements()','app_agreement_request_otp(uuid)','app_agreement_accept(uuid,text,text,text)','staff_add_partner_payment(uuid,text,numeric,date,text,text,text,text)','fin_partner_fees(date,date)','app_expert_application_get()','app_expert_application_save(jsonb,integer)','app_expert_application_agreements()','app_expert_application_submit()','staff_list_expert_applications(text)','staff_review_expert_application(uuid,text,text,text)'] LOOP
  EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC, anon', f);
  EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
END LOOP;
FOREACH f IN ARRAY ARRAY['party_auth_user(text,uuid)','party_agreement_types(text,uuid)','agreements_on_merchant_approved()','agreements_on_partner_insert()','agreements_on_skill_approved()','expert_application_missing(public.expert_applications)'] LOOP
  EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
END LOOP; END $$;