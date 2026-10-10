-- Publish -> rebuild the site.
--
-- When an event row changes (Publish / Unpublish on the admin page), call the
-- Vercel deploy hook so winalumnicup.com is rebuilt with the new results.
-- This is what a Supabase "Database Webhook" does, written as a plain
-- trigger with pg_net so it does not depend on the dashboard feature.
--
-- Before running: replace PASTE_VERCEL_DEPLOY_HOOK_URL_HERE with the hook URL
-- from Vercel -> Project -> Settings -> Git -> Deploy Hooks. Do not commit
-- the real URL; anyone who has it can trigger rebuilds.
--
-- Fires once per UPDATE statement (not per row), so one Publish = one build.

create extension if not exists pg_net;

create or replace function public.rebuild_site()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform net.http_post(
    url  := 'PASTE_VERCEL_DEPLOY_HOOK_URL_HERE',
    body := '{}'::jsonb
  );
  return null;
end;
$$;

drop trigger if exists events_rebuild_site on public.events;
create trigger events_rebuild_site
  after update on public.events
  for each statement execute function public.rebuild_site();
