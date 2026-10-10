-- Admin roles, invites, score entry and publishing.
--
-- Two roles:
--   owner        everything: applications, admins, scores, publishing
--   coordinator  one school; sees that school's applicants plus unmatched
--                ones (so they can recruit), and nothing else
--
-- Admins are added by invite: the owner enters an email, role and school on
-- the admin page, and the person becomes an admin the first time they sign in
-- with that email (claim_admin_invite). No SQL needed after this file.
--
-- Scores are entered by the owner on the admin page and stay invisible to the
-- public until the event is published (status = 'completed', see 0002).
-- Publishing also sets events.published_at; a Supabase database webhook on
-- that column triggers the Vercel rebuild that bakes results into the page.
--
-- Run after 0001–0003.

-- ------------------------------------------------------------------ roles

alter table admins add column if not exists role text not null default 'coordinator'
  check (role in ('owner', 'coordinator'));
alter table admins add column if not exists school_id uuid references schools(id) on delete set null;

-- Everyone already on the list was added by hand as a full admin.
update admins set role = 'owner';

alter table admins drop constraint if exists coordinator_has_school;
alter table admins add constraint coordinator_has_school
  check (role = 'owner' or school_id is not null);

create or replace function is_owner()
returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select exists (select 1 from admins where user_id = auth.uid() and role = 'owner');
$$;

create or replace function admin_school()
returns uuid
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select school_id from admins where user_id = auth.uid();
$$;

-- Never leave the project with no owner (e.g. an owner demoting themselves).
create or replace function keep_an_owner()
returns trigger
language plpgsql
as $$
begin
  if not exists (select 1 from admins where role = 'owner') then
    raise exception 'There must be at least one owner.';
  end if;
  return null;
end;
$$;

drop trigger if exists admins_keep_owner on admins;
create trigger admins_keep_owner after update or delete on admins
  for each statement execute function keep_an_owner();

-- ---------------------------------------------------------------- invites

create table if not exists admin_invites (
  email      text primary key check (email = lower(email) and email like '%_@_%'),
  role       text not null default 'coordinator' check (role in ('owner', 'coordinator')),
  school_id  uuid references schools(id) on delete cascade,
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint invite_coordinator_has_school check (role = 'owner' or school_id is not null)
);

-- Called by the admin page right after sign-in. The email comes from the
-- signed-in user's verified token, so nobody can claim someone else's invite.
create or replace function claim_admin_invite()
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  em  text := lower(auth.jwt() ->> 'email');
  inv admin_invites;
begin
  if auth.uid() is null or em is null then
    return false;
  end if;
  select * into inv from admin_invites where email = em;
  if found then
    insert into admins (user_id, email, role, school_id)
    values (auth.uid(), em, inv.role, inv.school_id)
    on conflict (user_id) do update
      set email = excluded.email, role = excluded.role, school_id = excluded.school_id;
    delete from admin_invites where email = em;
  end if;
  return exists (select 1 from admins where user_id = auth.uid());
end;
$$;

revoke all on function claim_admin_invite() from public, anon;
grant execute on function claim_admin_invite() to authenticated;

-- ------------------------------------------------------------------ scores

-- Hand-set rank/points, e.g. a tie the organisers broke on countback. Kept
-- apart from rank/points (which the scoring pass recomputes) so the override
-- survives every rebuild. Mirrors "rank"/"points" on rows in data/<year>.json.
alter table participants add column if not exists rank_override int;
alter table participants add column if not exists points_override numeric(6, 3);

alter table events add column if not exists published_at timestamptz;

-- Saving the score sheet replaces an event's whole field in one transaction,
-- so a dropped connection can never leave it half-deleted. Runs with the
-- caller's rights: RLS (owner-only writes) still applies.
create or replace function replace_participants(p_event uuid, p_rows jsonb)
returns int
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  n int;
begin
  if not is_owner() then
    raise exception 'Only the owner can enter scores.';
  end if;
  delete from participants where event_id = p_event;
  insert into participants (event_id, school_id, name, division, match_no, team_result,
                            raw_score, finish_time, rank, points, rank_override, points_override)
  select p_event,
         (r ->> 'school_id')::uuid,
         r ->> 'name',
         r ->> 'division',
         (r ->> 'match_no')::int,
         r ->> 'team_result',
         (r ->> 'raw_score')::numeric,
         (r ->> 'finish_time')::interval,
         (r ->> 'rank')::int,
         (r ->> 'points')::numeric,
         (r ->> 'rank_override')::int,
         (r ->> 'points_override')::numeric
  from jsonb_array_elements(p_rows) r;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke all on function replace_participants(uuid, jsonb) from public, anon;
grant execute on function replace_participants(uuid, jsonb) to authenticated;

-- -------------------------------------------------------------------- RLS

alter table admin_invites enable row level security;

grant select, insert, update, delete on admins, admin_invites to authenticated;

-- Writes to results and setup data are owner-only now.
drop policy if exists schools_admin       on schools;
drop policy if exists events_admin        on events;
drop policy if exists participants_admin  on participants;
drop policy if exists photos_admin        on photos;
drop policy if exists registrations_admin on registrations;
drop policy if exists school_applications_admin on school_applications;
drop policy if exists individual_applications_admin on individual_applications;

create policy schools_owner       on schools       for all to authenticated using (is_owner()) with check (is_owner());
create policy events_owner        on events        for all to authenticated using (is_owner()) with check (is_owner());
create policy participants_owner  on participants  for all to authenticated using (is_owner()) with check (is_owner());
create policy photos_owner        on photos        for all to authenticated using (is_owner()) with check (is_owner());
create policy registrations_owner on registrations for all to authenticated using (is_owner()) with check (is_owner());
create policy school_applications_owner on school_applications
  for all to authenticated using (is_owner()) with check (is_owner());
create policy individual_applications_owner on individual_applications
  for all to authenticated using (is_owner()) with check (is_owner());

-- Coordinators: their school's applicants and the unmatched pool. They may
-- match someone from the pool to their own school, never to another one.
create policy individual_applications_coordinator_read on individual_applications
  for select to authenticated
  using (is_admin() and (school_id is null or school_id = admin_school()));

create policy individual_applications_coordinator_update on individual_applications
  for update to authenticated
  using (is_admin() and (school_id is null or school_id = admin_school()))
  with check (is_admin() and (school_id is null or school_id = admin_school()));

-- Admin list: everyone sees their own row; the owner manages all of them.
drop policy if exists admins_self_read on admins;
create policy admins_read_self on admins
  for select to authenticated using (user_id = auth.uid());
create policy admins_owner on admins
  for all to authenticated using (is_owner()) with check (is_owner());

create policy admin_invites_owner on admin_invites
  for all to authenticated using (is_owner()) with check (is_owner());

-- Photo uploads: owner only, like the rest of the results data.
drop policy if exists event_photos_admin_write on storage.objects;
create policy event_photos_owner_write on storage.objects
  for all to authenticated
  using (bucket_id = 'event-photos' and is_owner())
  with check (bucket_id = 'event-photos' and is_owner());
