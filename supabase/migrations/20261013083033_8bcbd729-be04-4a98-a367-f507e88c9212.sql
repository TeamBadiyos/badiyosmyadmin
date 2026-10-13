SELECT set_config('app.booking_bypass','on',true);
UPDATE public.bookings SET service_duration_minutes=480 WHERE service_duration_minutes=510 AND service_label ILIKE 'Full Day%';
UPDATE public.service_price_options SET estimated_minutes=480 WHERE id='3947b139-d5be-468f-8b69-ab68586160ff';