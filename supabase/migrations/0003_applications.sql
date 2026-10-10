-- Applications — replaces the Google Form.
--
-- Two kinds of applicant:
--   school_applications      an alumni association that wants its school in the Cup
--   individual_applications  an alum who wants to play
--
-- Individuals pick their school from the participating list, or type one in
-- when theirs is not listed. `school_id` is what the admin page edits to match
-- an individual to a school; `school_other` keeps what they originally wrote.
--
-- Same RLS shape as registrations (0002): the public may INSERT, never read
-- back, so nobody can pull other applicants' email and phone out of the API.
-- Run after 0001 and 0002.

-- ------------------------------------------------------ school applications

create table if not exists school_applications (
  id               uuid primary key default gen_random_uuid(),
  school_name      text not null,
  association_name text,
  contact_name     text not null,
  contact_role     text,
  email            text not null,
  phone            text,
  member_count     int,                  -- rough number of active alumni in Korea
  sports           text[] not null default '{golf,run}',
  message          text,
  lang             text,                 -- language the form was filled in
  status           text not null default 'new'
                   check (status in ('new', 'contacted', 'accepted', 'declined')),
  admin_note       text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists school_applications_status_idx
  on school_applications (status, created_at desc);

-- -------------------------------------------------- individual applications

create table if not exists individual_applications (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  email         text not null,
  phone         text,
  -- chosen by the applicant from the participating list, or set by an admin
  school_id     uuid references schools(id) on delete set null,
  -- free text when their school is not on the list
  school_other  text,
  school_detail text,                    -- degree / class year, e.g. "BBA '12"
  sports        text[] not null,
  golf_avg      int,                     -- average 18-hole score
  run_10k       text,                    -- expected 10K time, e.g. "52:00"
  -- the 10K requires at least 2 female runners per school (see 0001)
  gender        text check (gender in ('f', 'm', 'undisclosed')),
  message       text,
  lang          text,
  status        text not null default 'new'
                check (status in ('new', 'matched', 'rostered', 'declined')),
  admin_note    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint individual_has_school
    check (school_id is not null or school_other is not null)
);

create index if not exists individual_applications_school_idx
  on individual_applications (school_id, status);

-- ------------------------------------------------------------- updated_at

drop trigger if exists school_applications_touch on school_applications;
create trigger school_applications_touch before update on school_applications
  for each row execute function touch_updated_at();

drop trigger if exists individual_applications_touch on individual_applications;
create trigger individual_applications_touch before update on individual_applications
  for each row execute function touch_updated_at();

-- -------------------------------------------------------------------- RLS

alter table school_applications     enable row level security;
alter table individual_applications enable row level security;

grant insert on school_applications, individual_applications to anon, authenticated;
grant select, update, delete on school_applications, individual_applications to authenticated;

-- As with registrations: insert without .select(), there is no read policy.
create policy school_applications_public_insert on school_applications
  for insert to anon, authenticated
  with check (
    status = 'new'
    and admin_note is null
    and char_length(school_name)  between 1 and 200
    and char_length(contact_name) between 1 and 100
    and char_length(email) between 3 and 254
    and email like '%_@_%'
    and (association_name is null or char_length(association_name) <= 200)
    and (contact_role     is null or char_length(contact_role)     <= 100)
    and (phone   is null or char_length(phone)   <= 40)
    and (message is null or char_length(message) <= 2000)
    and (member_count is null or member_count between 0 and 100000)
    and cardinality(sports) between 1 and 2
    and sports <@ array['golf', 'run']
  );

create policy individual_applications_public_insert on individual_applications
  for insert to anon, authenticated
  with check (
    status = 'new'
    and admin_note is null
    and char_length(name)  between 1 and 100
    and char_length(email) between 3 and 254
    and email like '%_@_%'
    and (phone         is null or char_length(phone)         <= 40)
    and (school_other  is null or char_length(school_other)  <= 200)
    and (school_detail is null or char_length(school_detail) <= 100)
    and (run_10k       is null or char_length(run_10k)       <= 20)
    and (message       is null or char_length(message)       <= 2000)
    and (golf_avg is null or golf_avg between 50 and 200)
    and cardinality(sports) between 1 and 2
    and sports <@ array['golf', 'run']
  );

create policy school_applications_admin on school_applications
  for all to authenticated using (is_admin()) with check (is_admin());

create policy individual_applications_admin on individual_applications
  for all to authenticated using (is_admin()) with check (is_admin());
