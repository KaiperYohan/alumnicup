-- Row-level security.
--
-- The site is a public static page talking to Supabase with the anon key,
-- so the anon role's grants here are effectively public internet access.
-- Treat every `to anon` policy below as "anyone on the internet can do this".
--
-- Shape:
--   schools / events          public read
--   participants / photos     public read, but only for completed events
--   registrations             public INSERT only — never public read (PII)
--   admins                    no public access at all

alter table schools       enable row level security;
alter table events        enable row level security;
alter table participants  enable row level security;
alter table photos        enable row level security;
alter table registrations enable row level security;
alter table admins        enable row level security;

-- ------------------------------------------------------- public read

create policy schools_public_read on schools
  for select to anon, authenticated using (true);

create policy events_public_read on events
  for select to anon, authenticated using (true);

-- Results stay hidden until the event is marked completed, so a half-entered
-- leaderboard is not visible while scores are still being typed in.
create policy participants_public_read on participants
  for select to anon, authenticated
  using (exists (
    select 1 from events e
    where e.id = participants.event_id and e.status = 'completed'
  ));

create policy photos_public_read on photos
  for select to anon, authenticated
  using (
    event_id is null
    or exists (
      select 1 from events e
      where e.id = photos.event_id and e.status = 'completed'
    )
  );

-- --------------------------------------------------- public registration

-- Anyone may sign up. Nobody may read the table back without being an admin,
-- so one registrant cannot enumerate everyone else's email and phone.
--
-- NOTE for the client: because there is no matching SELECT policy, a
-- `.insert(...).select()` round-trip WILL fail. Insert without select:
--   await supabase.from('registrations').insert(row)          -- works
--   await supabase.from('registrations').insert(row).select() -- blocked
create policy registrations_public_insert on registrations
  for insert to anon, authenticated
  with check (
    status = 'pending'          -- nobody self-confirms
    and char_length(name)  between 1 and 100
    and char_length(email) between 3 and 254
    and email like '%_@_%'
    and (phone is null or char_length(phone) <= 40)
    and (note  is null or char_length(note)  <= 1000)
  );

-- ------------------------------------------------------------- admin

create policy schools_admin       on schools       for all to authenticated using (is_admin()) with check (is_admin());
create policy events_admin        on events        for all to authenticated using (is_admin()) with check (is_admin());
create policy participants_admin  on participants  for all to authenticated using (is_admin()) with check (is_admin());
create policy photos_admin        on photos        for all to authenticated using (is_admin()) with check (is_admin());
create policy registrations_admin on registrations for all to authenticated using (is_admin()) with check (is_admin());

-- Admins can see the admin list; nobody else can, and nobody can edit it
-- through the API. Add admins from the Supabase dashboard.
create policy admins_self_read on admins
  for select to authenticated using (is_admin());

-- ----------------------------------------------------------- storage

insert into storage.buckets (id, name, public)
values ('event-photos', 'event-photos', true)
on conflict (id) do nothing;

create policy event_photos_public_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'event-photos');

create policy event_photos_admin_write on storage.objects
  for all to authenticated
  using (bucket_id = 'event-photos' and is_admin())
  with check (bucket_id = 'event-photos' and is_admin());
