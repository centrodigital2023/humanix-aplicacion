-- ============================================================
-- Missing tables: bookmarks, search analytics, newsletter,
-- contact inquiries, ad impressions tracking
-- ============================================================

-- 1. Professional bookmarks (users save/favorite professionals)
create table if not exists public.professional_bookmarks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  pro_id      uuid not null references public.profiles(id) on delete cascade,
  note        text,
  created_at  timestamptz not null default now(),
  unique (user_id, pro_id)
);
alter table public.professional_bookmarks enable row level security;
create policy "Users manage own bookmarks"
  on public.professional_bookmarks for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create index if not exists professional_bookmarks_user_idx on public.professional_bookmarks(user_id);

-- 2. Search analytics (track what people search for — SEO + product insights)
create table if not exists public.search_analytics (
  id            uuid primary key default gen_random_uuid(),
  query         text not null,
  role          text,                -- 'guest' | 'family' | 'institution' | 'professional'
  results_count integer,
  user_id       uuid references public.profiles(id) on delete set null,
  session_id    text,
  city          text,
  specialty     text,
  created_at    timestamptz not null default now()
);
alter table public.search_analytics enable row level security;
-- Only service role / edge functions can insert; anon can insert anonymously
create policy "Anyone can insert search analytics"
  on public.search_analytics for insert
  with check (true);
create policy "Superadmin can read search analytics"
  on public.search_analytics for select
  using (
    exists (
      select 1 from public.user_roles
      where user_id = auth.uid() and role = 'superadmin'
    )
  );
create index if not exists search_analytics_query_idx on public.search_analytics(query);
create index if not exists search_analytics_created_idx on public.search_analytics(created_at desc);

-- 3. Newsletter subscriptions
create table if not exists public.newsletter_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  email       text not null unique,
  name        text,
  role        text,                  -- 'professional' | 'family' | 'institution' | null
  city        text,
  source      text,                  -- page/section where they subscribed
  confirmed   boolean not null default false,
  token       text unique default encode(gen_random_bytes(32), 'hex'),
  subscribed_at timestamptz not null default now(),
  confirmed_at  timestamptz,
  unsubscribed_at timestamptz
);
alter table public.newsletter_subscriptions enable row level security;
create policy "Anyone can subscribe"
  on public.newsletter_subscriptions for insert
  with check (true);
create policy "Self confirm/unsubscribe via token"
  on public.newsletter_subscriptions for update
  using (true)
  with check (true);
create policy "Superadmin can read newsletter"
  on public.newsletter_subscriptions for select
  using (
    exists (
      select 1 from public.user_roles
      where user_id = auth.uid() and role = 'superadmin'
    )
  );
create index if not exists newsletter_email_idx on public.newsletter_subscriptions(email);

-- 4. Contact inquiries (from /contacto page)
create table if not exists public.contact_inquiries (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  email         text not null,
  phone         text,
  subject       text,
  message       text not null,
  role          text,                 -- who is contacting
  source_page   text,
  status        text not null default 'new', -- 'new' | 'read' | 'replied' | 'closed'
  assigned_to   uuid references public.profiles(id) on delete set null,
  replied_at    timestamptz,
  created_at    timestamptz not null default now()
);
alter table public.contact_inquiries enable row level security;
create policy "Anyone can submit inquiry"
  on public.contact_inquiries for insert
  with check (true);
create policy "Superadmin can manage inquiries"
  on public.contact_inquiries for all
  using (
    exists (
      select 1 from public.user_roles
      where user_id = auth.uid() and role in ('superadmin', 'evaluador')
    )
  );
create index if not exists contact_inquiries_status_idx on public.contact_inquiries(status, created_at desc);

-- 5. Ad impressions & clicks tracking
create table if not exists public.ad_impressions (
  id         uuid primary key default gen_random_uuid(),
  banner_id  uuid references public.ad_banners(id) on delete cascade,
  event      text not null default 'impression', -- 'impression' | 'click'
  page       text,
  slot       text,
  user_id    uuid references public.profiles(id) on delete set null,
  session_id text,
  ip_hash    text,                               -- hashed for privacy
  created_at timestamptz not null default now()
);
alter table public.ad_impressions enable row level security;
create policy "Anyone can insert ad events"
  on public.ad_impressions for insert
  with check (true);
create policy "Superadmin can read ad impressions"
  on public.ad_impressions for select
  using (
    exists (
      select 1 from public.user_roles
      where user_id = auth.uid() and role = 'superadmin'
    )
  );
create index if not exists ad_impressions_banner_idx on public.ad_impressions(banner_id, event);
create index if not exists ad_impressions_created_idx on public.ad_impressions(created_at desc);

-- 6. Add slot & active columns to ad_banners if not present
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'ad_banners' and column_name = 'slot'
  ) then
    alter table public.ad_banners add column slot text default 'homepage';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'ad_banners' and column_name = 'active'
  ) then
    alter table public.ad_banners add column active boolean not null default true;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'ad_banners' and column_name = 'impressions'
  ) then
    alter table public.ad_banners add column impressions bigint not null default 0;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'ad_banners' and column_name = 'clicks'
  ) then
    alter table public.ad_banners add column clicks bigint not null default 0;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'ad_banners' and column_name = 'bg_color'
  ) then
    alter table public.ad_banners add column bg_color text;
  end if;
end $$;

-- 7. Public page views (simple analytics without GA)
create table if not exists public.page_views (
  id          uuid primary key default gen_random_uuid(),
  path        text not null,
  referrer    text,
  user_agent  text,
  user_id     uuid references public.profiles(id) on delete set null,
  session_id  text,
  country     text,
  city        text,
  created_at  timestamptz not null default now()
);
alter table public.page_views enable row level security;
create policy "Anyone can insert page view"
  on public.page_views for insert
  with check (true);
create policy "Superadmin can read page views"
  on public.page_views for select
  using (
    exists (
      select 1 from public.user_roles
      where user_id = auth.uid() and role = 'superadmin'
    )
  );
create index if not exists page_views_path_idx on public.page_views(path, created_at desc);
