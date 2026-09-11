-- Run manually only after migration 015 and the preflight documented in
-- docs/WEEKLY-PROCESSING.md. Refuse to replace an existing named job.
create extension if not exists pg_cron;
do $$ begin
 if session_user<>'postgres' then
  raise exception 'schedule must be installed by postgres so the owner-only job can run';
 end if;
 if exists(select 1 from cron.job where jobname='open-labs-weekly-processing') then
  raise exception 'open-labs-weekly-processing already exists; inspect it before changing anything';
 end if;
end $$;
select cron.schedule('open-labs-weekly-processing','5 * * * *',
 $job$select public.run_weekly_processing();$job$);
