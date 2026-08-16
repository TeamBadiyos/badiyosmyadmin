ALTER TABLE public.offline_sales REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.offline_sales;