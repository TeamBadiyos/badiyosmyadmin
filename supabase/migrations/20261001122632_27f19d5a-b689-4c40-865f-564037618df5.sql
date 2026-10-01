CREATE TABLE public.suggestion_statuses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  label text NOT NULL,
  customer_label_en text NOT NULL,
  customer_label_mr text NOT NULL DEFAULT '',
  color text NOT NULL DEFAULT '#3B82F6',
  sort_order int NOT NULL DEFAULT 0,
  is_final boolean NOT NULL DEFAULT false,
  notify_customer boolean NOT NULL DEFAULT false,
  notify_message text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT (id, key, customer_label_en, customer_label_mr, color, sort_order, is_final, active) ON public.suggestion_statuses TO authenticated;
GRANT ALL ON public.suggestion_statuses TO service_role;
ALTER TABLE public.suggestion_statuses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in users read statuses" ON public.suggestion_statuses FOR SELECT TO authenticated USING (true);

INSERT INTO public.suggestion_statuses (key,label,customer_label_en,customer_label_mr,color,sort_order,is_final,notify_customer,notify_message) VALUES
('new','Naya','Received','मिळाले','#3B82F6',1,false,false,NULL),
('reviewing','Dekh rahe hain','Under review','पाहत आहोत','#F59E0B',2,false,false,NULL),
('planned','Plan kiya','Planned','नियोजित','#8B5CF6',3,false,false,NULL),
('in_progress','Kaam chal raha hai','In progress','काम सुरू आहे','#06B6D4',4,false,false,NULL),
('done','Ho gaya ✅','Done ✅','पूर्ण झाले ✅','#10B981',5,true,true,'Aapke suggestion pe kaam ho gaya! 🙏 Shukriya'),
('wont_do','Nahi karenge','Not planned','करणार नाही','#6B7280',6,true,false,NULL);

CREATE TABLE public.suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL DEFAULT 'customer_app' CHECK (source IN ('customer_app','whatsapp','call','expert','merchant','internal')),
  category text NOT NULL DEFAULT 'other' CHECK (category IN ('app','service_quality','new_service','price','other')),
  text text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 4000),
  photo_path text,
  user_id uuid,
  name text,
  phone text,
  status_id uuid NOT NULL REFERENCES public.suggestion_statuses(id),
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('high','medium','low')),
  assigned_to uuid REFERENCES public.staff_users(id),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  final_at timestamptz,
  archived boolean NOT NULL DEFAULT false
);
CREATE INDEX suggestions_status_idx ON public.suggestions(status_id);
CREATE INDEX suggestions_user_idx ON public.suggestions(user_id, created_at);
CREATE INDEX suggestions_created_idx ON public.suggestions(created_at DESC);
GRANT SELECT (id, source, category, text, photo_path, user_id, status_id, created_at) ON public.suggestions TO authenticated;
GRANT INSERT (category, text, photo_path, user_id) ON public.suggestions TO authenticated;
GRANT ALL ON public.suggestions TO service_role;
ALTER TABLE public.suggestions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Customers read own suggestions" ON public.suggestions FOR SELECT TO authenticated USING (auth.uid() = user_id AND archived = false);
CREATE POLICY "Customers add own suggestions" ON public.suggestions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- Customer inserts: force defaults, autofill contact, rate limit 5/day
CREATE OR REPLACE FUNCTION public.suggestions_before_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n int; _uid uuid := auth.uid();
BEGIN
  IF NEW.status_id IS NULL THEN
    SELECT id INTO NEW.status_id FROM public.suggestion_statuses WHERE active ORDER BY sort_order LIMIT 1;
  END IF;
  IF _uid IS NOT NULL AND NEW.user_id = _uid AND NOT public.is_active_staff(_uid, ARRAY['super_admin','ops_manager']) THEN
    NEW.source := 'customer_app';
    NEW.priority := 'medium';
    NEW.assigned_to := NULL;
    NEW.archived := false;
    NEW.created_by := _uid;
    SELECT count(*) INTO _n FROM public.suggestions WHERE user_id = _uid AND created_at > now() - interval '24 hours';
    IF _n >= 5 THEN RAISE EXCEPTION 'You can send up to 5 suggestions per day'; END IF;
    BEGIN
      SELECT COALESCE(NEW.name, c.name), COALESCE(NEW.phone, c.phone) INTO NEW.name, NEW.phone
        FROM public.customers c WHERE c.id = _uid;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END IF;
  RETURN NEW;
END $$;
ALTER TABLE public.suggestions ALTER COLUMN status_id DROP NOT NULL;
CREATE TRIGGER suggestions_before_insert BEFORE INSERT ON public.suggestions FOR EACH ROW EXECUTE FUNCTION public.suggestions_before_insert();

CREATE TABLE public.suggestion_remarks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  suggestion_id uuid NOT NULL REFERENCES public.suggestions(id),
  staff_id uuid REFERENCES public.staff_users(id),
  remark text NOT NULL,
  old_status_id uuid REFERENCES public.suggestion_statuses(id),
  new_status_id uuid REFERENCES public.suggestion_statuses(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX suggestion_remarks_sid_idx ON public.suggestion_remarks(suggestion_id, created_at);
GRANT ALL ON public.suggestion_remarks TO service_role;
ALTER TABLE public.suggestion_remarks ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.suggestion_remarks_no_change()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Remarks are append-only'; END $$;
CREATE TRIGGER suggestion_remarks_append_only BEFORE UPDATE OR DELETE ON public.suggestion_remarks FOR EACH ROW EXECUTE FUNCTION public.suggestion_remarks_no_change();

CREATE TRIGGER suggestions_updated_at BEFORE UPDATE ON public.suggestions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER suggestion_statuses_updated_at BEFORE UPDATE ON public.suggestion_statuses FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Storage policies for private bucket suggestion-media (customers upload under their uid folder)
CREATE POLICY "Customers upload own suggestion media" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'suggestion-media' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Customers read own suggestion media" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'suggestion-media' AND (storage.foldername(name))[1] = auth.uid()::text);