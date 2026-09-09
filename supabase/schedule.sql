-- Run once in Supabase SQL editor AFTER all migrations. Requires pg_cron.
-- The scheduler calls the same checked, idempotent commands as the app.
create extension if not exists pg_cron;
select cron.schedule('open-labs-cycle','5 * * * *', $job$
 select set_config('request.jwt.claim.role','service_role',true);
 select public.open_cycle(date_trunc('week',now() at time zone 'America/Los_Angeles')::date,false);
 select public.evaluate_due_obligations();
 $job$);
