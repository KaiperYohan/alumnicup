-- The Alumni Cup — initial schema
-- Mirrors the shape of data/<year>.json so the static-site data imports directly.
--
-- Run in the Supabase SQL editor, or: supabase db push

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- schools

create table if not exists schools (
  id         uuid primary key default gen_random_uuid(),
  code       text unique not null,
  emoji      text,
  name_en    text not null,
  name_ko    text not null,
  short_en   text,
  short_ko   text,
  active     boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- events

create table if not exists events (
  id         uuid primary key default gen_random_uuid(),
  year       int  not null,
  sport      text not null check (sport in ('golf', 'run')),
  status     text not null default 'scheduled'
             check (status in ('scheduled', 'registration_open', 'completed', 'cancelled')),
  event_date date,
  title_en   text not null,
  title_ko   text not null,
  venue_en   text,
  venue_ko   text,
  -- rank_points array + place_bonus/school_bonus/team_match_points maps.
  -- Kept as jsonb because the scoring formula changes year to year, and
  -- pinning it to the event is what makes old results reproducible.
  scoring    jsonb not null default '{}'::jsonb,
  rules_en   text,
  rules_ko   text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (year, sport)
);

-- ------------------------------------------------------------ participants

create table if not exists participants (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id)  on delete cascade,
  school_id   uuid not null references schools(id) on delete restrict,
  name        text not null,
  division    text not null default 'competitive'
              check (division in ('competitive', 'recreational')),
  -- recreational team matches only
  match_no    int,
  team_result text check (team_result in ('win', 'loss')),
  -- one of these is used depending on sport
  raw_score   numeric,        -- golf strokes
  finish_time interval,       -- 10K chip time
  -- derived by the scoring pass, stored so historical results stay fixed
  rank        int,
  points      numeric(6, 3),
  created_at  timestamptz not null default now(),

  constraint recreational_has_match
    check (division <> 'recreational' or match_no is not null)
);

create index if not exists participants_event_idx on participants (event_id, division, rank);

-- ----------------------------------------------------------------- photos

create table if not exists photos (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid references events(id) on delete cascade,
  year         int not null,
  storage_path text not null,            -- path within the event-photos bucket
  category_en  text,
  category_ko  text,
  alt_en       text,
  alt_ko       text,
  width        int,
  height       int,
  bytes        int,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now(),
  unique (storage_path)
);

create index if not exists photos_year_idx on photos (year, sort_order);

-- ---------------------------------------------------------- registrations

create table if not exists registrations (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references events(id)  on delete cascade,
  school_id  uuid not null references schools(id) on delete restrict,
  name       text not null,
  email      text not null,
  phone      text,
  division   text not null default 'competitive'
             check (division in ('competitive', 'recreational')),
  -- the 10K rules require at least 2 female runners per school, so this is
  -- needed for roster validation, not demographics
  gender     text check (gender in ('f', 'm', 'other', 'undisclosed')),
  handicap   numeric,                    -- golf
  note       text,
  status     text not null default 'pending'
             check (status in ('pending', 'confirmed', 'waitlist', 'withdrawn')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- one signup per email per event
  unique (event_id, email)
);

create index if not exists registrations_event_idx on registrations (event_id, school_id, status);

-- ----------------------------------------------------------------- admins

-- Membership here is what grants write access. Add a row by hand in the
-- Supabase dashboard after the person signs in once:
--   insert into admins (user_id) values ('<uuid from auth.users>');
create table if not exists admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text,
  created_at timestamptz not null default now()
);

create or replace function is_admin()
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select exists (select 1 from admins where user_id = auth.uid());
$$;

-- ------------------------------------------------------------- updated_at

create or replace function touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists events_touch on events;
create trigger events_touch before update on events
  for each row execute function touch_updated_at();

drop trigger if exists registrations_touch on registrations;
create trigger registrations_touch before update on registrations
  for each row execute function touch_updated_at();
