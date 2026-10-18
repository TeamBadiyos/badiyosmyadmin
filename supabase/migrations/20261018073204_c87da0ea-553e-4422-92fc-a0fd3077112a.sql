GRANT EXECUTE ON FUNCTION public.staff_apply_product_category_map(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_category_usage(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_category_reorder(text, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_category_delete(text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_category_copy_default(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cat_is_admin() TO authenticated;