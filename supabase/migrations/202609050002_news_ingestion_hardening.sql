create extension if not exists supabase_vault with schema vault;

with ranked_running as (
  select id, row_number() over (order by started_at desc, id desc) as position
  from public.news_sync_runs
  where status = 'running'
)
update public.news_sync_runs as runs
set status = 'failed',
    finished_at = now(),
    detail = runs.detail || '{"processing_error":"superseded_before_overlap_guard"}'::jsonb
from ranked_running
where runs.id = ranked_running.id
  and ranked_running.position > 1;

create unique index if not exists news_sync_runs_one_running_idx
  on public.news_sync_runs ((status)) where status = 'running';

create or replace function public.start_news_sync_run(p_stale_before timestamptz)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  claimed_id bigint;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('longview.news_sync_runs'));

  update public.news_sync_runs
  set status = 'failed',
      finished_at = pg_catalog.now(),
      detail = detail || '{"processing_error":"stale_run_expired"}'::jsonb
  where status = 'running'
    and started_at < p_stale_before;

  if exists (select 1 from public.news_sync_runs where status = 'running') then
    return null;
  end if;

  insert into public.news_sync_runs (status)
  values ('running')
  returning id into claimed_id;
  return claimed_id;
end;
$$;

create or replace function public.upsert_stock_news_preserving_translations(p_articles jsonb)
returns jsonb
language sql
set search_path = ''
as $$
  with incoming as (
    select *
    from pg_catalog.jsonb_to_recordset(p_articles) as article(
      company_id uuid,
      external_id text,
      title text,
      summary text,
      title_th text,
      summary_th text,
      translated_at timestamptz,
      translation_provider text,
      source_name text,
      source_url text,
      published_at timestamptz,
      category text,
      fetched_at timestamptz,
      what_happened_th text,
      entities_th jsonb,
      key_points_th jsonb,
      key_numbers jsonb,
      uncertainties_th text,
      source_scope text,
      summary_version text
    )
  ), upserted as (
    insert into public.stock_news (
      company_id, external_id, title, summary, title_th, summary_th,
      translated_at, translation_provider, source_name, source_url,
      published_at, category, fetched_at, what_happened_th, entities_th,
      key_points_th, key_numbers, uncertainties_th, source_scope, summary_version
    )
    select
      company_id, external_id, title, summary, title_th, summary_th,
      translated_at, translation_provider, source_name, source_url,
      published_at, category, fetched_at, what_happened_th, entities_th,
      key_points_th, key_numbers, uncertainties_th, source_scope, summary_version
    from incoming
    on conflict (external_id) do update set
      company_id = excluded.company_id,
      title = excluded.title,
      summary = excluded.summary,
      title_th = coalesce(excluded.title_th, stock_news.title_th),
      summary_th = coalesce(excluded.summary_th, stock_news.summary_th),
      translated_at = coalesce(stock_news.translated_at, excluded.translated_at),
      translation_provider = coalesce(stock_news.translation_provider, excluded.translation_provider),
      source_name = excluded.source_name,
      source_url = excluded.source_url,
      published_at = excluded.published_at,
      category = excluded.category,
      fetched_at = excluded.fetched_at,
      what_happened_th = excluded.what_happened_th,
      entities_th = excluded.entities_th,
      key_points_th = excluded.key_points_th,
      key_numbers = excluded.key_numbers,
      uncertainties_th = excluded.uncertainties_th,
      source_scope = excluded.source_scope,
      summary_version = excluded.summary_version
    returning id, external_id
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(upserted)), '[]'::jsonb)
  from upserted;
$$;

create or replace function public.merge_news_company_links(p_links jsonb)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  merged_count integer;
begin
  with incoming as (
    select *
    from pg_catalog.jsonb_to_recordset(p_links) as link(
      news_id uuid,
      company_id uuid,
      discovery_tickers jsonb,
      explicit_mention boolean,
      title_mention boolean,
      relevance_score integer,
      matched_aliases jsonb,
      updated_at timestamptz
    )
  ), merged as (
    insert into public.news_company_links (
      news_id, company_id, discovery_tickers, explicit_mention,
      title_mention, relevance_score, matched_aliases, updated_at
    )
    select
      news_id, company_id, discovery_tickers, explicit_mention,
      title_mention, relevance_score, matched_aliases, updated_at
    from incoming
    on conflict (news_id, company_id) do update set
      discovery_tickers = (
        select coalesce(pg_catalog.jsonb_agg(values.value order by values.value), '[]'::jsonb)
        from (
          select distinct value
          from pg_catalog.jsonb_array_elements_text(news_company_links.discovery_tickers || excluded.discovery_tickers) as value
        ) as values
      ),
      explicit_mention = news_company_links.explicit_mention or excluded.explicit_mention,
      title_mention = news_company_links.title_mention or excluded.title_mention,
      relevance_score = greatest(news_company_links.relevance_score, excluded.relevance_score),
      matched_aliases = (
        select coalesce(pg_catalog.jsonb_agg(values.value order by values.value), '[]'::jsonb)
        from (
          select distinct value
          from pg_catalog.jsonb_array_elements_text(news_company_links.matched_aliases || excluded.matched_aliases) as value
        ) as values
      ),
      updated_at = greatest(news_company_links.updated_at, excluded.updated_at)
    returning 1
  )
  select count(*) into merged_count from merged;
  return merged_count;
end;
$$;

revoke all on function public.start_news_sync_run(timestamptz) from public, anon, authenticated;
grant execute on function public.start_news_sync_run(timestamptz) to service_role;
revoke all on function public.upsert_stock_news_preserving_translations(jsonb) from public, anon, authenticated;
grant execute on function public.upsert_stock_news_preserving_translations(jsonb) to service_role;
revoke all on function public.merge_news_company_links(jsonb) from public, anon, authenticated;
grant execute on function public.merge_news_company_links(jsonb) to service_role;

select cron.unschedule(jobid)
from cron.job
where jobname in ('ingest-googl-news-30m', 'ingest-seven-company-news-30m');

select cron.schedule(
  'ingest-seven-company-news-30m',
  '*/30 * * * *',
  $job$
  select net.http_post(
    url := 'https://pkxcbbolryyszljcedni.supabase.co/functions/v1/ingest-news',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBreGNiYm9scnl5c3psamNlZG5pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg0OTA4NTUsImV4cCI6MjEwNDA2Njg1NX0.FUh4UASmXyWR2PIAhgYUljgAlWJgxSFLT_etu_i1a4U',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBreGNiYm9scnl5c3psamNlZG5pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg0OTA4NTUsImV4cCI6MjEwNDA2Njg1NX0.FUh4UASmXyWR2PIAhgYUljgAlWJgxSFLT_etu_i1a4U',
      'x-ingest-secret', secret.decrypted_secret
    ),
    body := '{}'::jsonb
  )
  from vault.decrypted_secrets as secret
  where secret.name = 'news_ingest_secret';
  $job$
);
