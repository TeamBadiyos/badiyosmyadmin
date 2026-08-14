create table public.segments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  vertical_type text not null check (vertical_type in ('SERVICE','CATALOG')),
  display_template text not null check (display_template in ('CATEGORY_FIRST','STORE_FIRST','SEARCH_FIRST')),
  icon_url text,
  rank integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index idx_segments_active_rank on public.segments (is_active, rank);

create table public.service_categories (
  id uuid primary key default gen_random_uuid(),
  segment_id uuid not null references public.segments(id),
  name text not null,
  slug text not null,
  icon_url text,
  rank integer not null default 0,
  is_active boolean not null default true,
  unique (segment_id, slug)
);

create table public.store_categories (
  id uuid primary key default gen_random_uuid(),
  segment_id uuid not null references public.segments(id),
  name text not null,
  slug text not null,
  icon_url text,
  rank integer not null default 0,
  is_active boolean not null default true,
  unique (segment_id, slug)
);

create table public.partner_skills (
  id uuid primary key default gen_random_uuid(),
  expert_id uuid not null references public.experts(id),
  service_category_id uuid not null references public.service_categories(id),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  approved_by uuid references public.staff_users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (expert_id, service_category_id)
);

create index idx_partner_skills_expert on public.partner_skills (expert_id) where status = 'approved';

create table public.device_sessions (
  id uuid primary key default gen_random_uuid(),
  user_type text not null check (user_type in ('customer','expert','staff')),
  user_id uuid not null,
  device_id text not null,
  device_label text,
  last_active_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_type, user_id, device_id)
);

create index idx_device_sessions_user on public.device_sessions (user_type, user_id, last_active_at desc);

-- Grants
grant select on public.segments to anon;
grant select, insert, update, delete on public.segments to authenticated;
grant all on public.segments to service_role;

grant select on public.service_categories to anon;
grant select, insert, update, delete on public.service_categories to authenticated;
grant all on public.service_categories to service_role;

grant select on public.store_categories to anon;
grant select, insert, update, delete on public.store_categories to authenticated;
grant all on public.store_categories to service_role;

grant select, insert, update, delete on public.partner_skills to authenticated;
grant all on public.partner_skills to service_role;

grant select, delete on public.device_sessions to authenticated;
grant all on public.device_sessions to service_role;

-- RLS
alter table public.segments enable row level security;
alter table public.service_categories enable row level security;
alter table public.store_categories enable row level security;
alter table public.partner_skills enable row level security;
alter table public.device_sessions enable row level security;

-- segments
create policy "segments_public_select_active" on public.segments
  for select to anon, authenticated using (is_active = true);
create policy "segments_staff_select_all" on public.segments
  for select to authenticated using (public.is_active_staff(auth.uid(), array['super_admin','ops_manager']));
create policy "segments_staff_insert" on public.segments
  for insert to authenticated with check (public.is_active_staff(auth.uid(), array['super_admin','ops_manager']));
create policy "segments_staff_update" on public.segments
  for update to authenticated using (public.is_active_staff(auth.uid(), array['super_admin','ops_manager']))
  with check (public.is_active_staff(auth.uid(), array['super_admin','ops_manager']));
create policy "segments_staff_delete" on public.segments
  for delete to authenticated using (public.is_active_staff(auth.uid(), array['super_admin','ops_manager']));

-- service_categories
create policy "service_categories_public_select_active" on public.service_categories
  for select to anon, authenticated using (is_active = true);
create policy "service_categories_staff_select_all" on public.service_categories
  for select to authenticated using (public.is_active_staff(auth.uid(), array['super_admin','ops_manager']));
create policy "service_categories_staff_insert" on public.service_categories
  for insert to authenticated with check (public.is_active_staff(auth.uid(), array['super_admin','ops_manager']));
create policy "service_categories_staff_update" on public.service_categories
  for update to authenticated using (public.is_active_staff(auth.uid(), array['super_admin','ops_manager']))
  with check (public.is_active_staff(auth.uid(), array['super_admin','ops_manager']));
create policy "service_categories_staff_delete" on public.service_categories
  for delete to authenticated using (public.is_active_staff(auth.uid(), array['super_admin','ops_manager']));

-- store_categories
create policy "store_categories_public_select_active" on public.store_categories
  for select to anon, authenticated using (is_active = true);
create policy "store_categories_staff_select_all" on public.store_categories
  for select to authenticated using (public.is_active_staff(auth.uid(), array['super_admin','ops_manager']));
create policy "store_categories_staff_insert" on public.store_categories
  for insert to authenticated with check (public.is_active_staff(auth.uid(), array['super_admin','ops_manager']));
create policy "store_categories_staff_update" on public.store_categories
  for update to authenticated using (public.is_active_staff(auth.uid(), array['super_admin','ops_manager']))
  with check (public.is_active_staff(auth.uid(), array['super_admin','ops_manager']));
create policy "store_categories_staff_delete" on public.store_categories
  for delete to authenticated using (public.is_active_staff(auth.uid(), array['super_admin','ops_manager']));

-- partner_skills
create policy "partner_skills_expert_select_own" on public.partner_skills
  for select to authenticated using (expert_id = public.get_expert_id_for_auth(auth.uid()));
create policy "partner_skills_staff_select" on public.partner_skills
  for select to authenticated using (public.is_active_staff(auth.uid(), array['super_admin','ops_manager']));
create policy "partner_skills_staff_insert" on public.partner_skills
  for insert to authenticated with check (public.is_active_staff(auth.uid(), array['super_admin','ops_manager']));
create policy "partner_skills_staff_update" on public.partner_skills
  for update to authenticated using (public.is_active_staff(auth.uid(), array['super_admin','ops_manager']))
  with check (public.is_active_staff(auth.uid(), array['super_admin','ops_manager']));
create policy "partner_skills_staff_delete" on public.partner_skills
  for delete to authenticated using (public.is_active_staff(auth.uid(), array['super_admin','ops_manager']));

-- device_sessions
create policy "device_sessions_select_own" on public.device_sessions
  for select to authenticated using (
    exists (
      select 1 from public.resolve_caller_identity(auth.uid()) ci
      where ci.user_type = device_sessions.user_type and ci.user_id = device_sessions.user_id
    )
  );
create policy "device_sessions_delete_own" on public.device_sessions
  for delete to authenticated using (
    exists (
      select 1 from public.resolve_caller_identity(auth.uid()) ci
      where ci.user_type = device_sessions.user_type and ci.user_id = device_sessions.user_id
    )
  );

-- updated_at trigger for segments
create trigger update_segments_updated_at
  before update on public.segments
  for each row execute function public.update_updated_at_column();

-- Seed
insert into public.segments (name, slug, vertical_type, display_template, rank, is_active)
values ('Clean', 'clean', 'SERVICE', 'CATEGORY_FIRST', 0, true);