alter table public.zones
  add column segment_id uuid references public.segments(id);

update public.zones set segment_id = (select id from public.segments where slug = 'clean');

alter table public.zones alter column segment_id set not null;

alter table public.area_partners
  add column commission_type text not null default 'FLAT' check (commission_type in ('FLAT','PERCENTAGE')),
  add column commission_value numeric not null default 0;

update public.area_partners
  set commission_type = 'FLAT', commission_value = commission_rate
  where commission_rate is not null;

alter table public.experts
  add column onboarded_by uuid references public.area_partners(id),
  add column approved_by uuid references public.staff_users(id),
  add column preferred_language text not null default 'mr' check (preferred_language in ('mr','hi','en'));

alter table public.users
  add column preferred_language text not null default 'en' check (preferred_language in ('mr','hi','en'));