alter table public.stock_news
  add column if not exists content_scope text not null default 'rss_excerpt',
  add column if not exists content_status text not null default 'pending',
  add column if not exists content_fetched_at timestamptz,
  add column if not exists source_evidence jsonb not null default '[]'::jsonb,
  add column if not exists watch_points_th jsonb not null default '[]'::jsonb,
  add column if not exists summary_method text not null default 'extractive_rules_v1';

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'stock_news_content_scope_check'
      and conrelid = 'public.stock_news'::pg_catalog.regclass
  ) then
    alter table public.stock_news add constraint stock_news_content_scope_check
      check (content_scope in ('article_page', 'rss_excerpt'));
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'stock_news_content_status_check'
      and conrelid = 'public.stock_news'::pg_catalog.regclass
  ) then
    alter table public.stock_news add constraint stock_news_content_status_check
      check (content_status in ('extracted', 'rss_fallback', 'blocked', 'invalid', 'pending'));
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'stock_news_source_evidence_check'
      and conrelid = 'public.stock_news'::pg_catalog.regclass
  ) then
    alter table public.stock_news add constraint stock_news_source_evidence_check
      check (jsonb_typeof(source_evidence) = 'array' and jsonb_array_length(source_evidence) <= 3);
  end if;

  if not exists (
    select 1 from pg_catalog.pg_constraint
    where conname = 'stock_news_watch_points_th_check'
      and conrelid = 'public.stock_news'::pg_catalog.regclass
  ) then
    alter table public.stock_news add constraint stock_news_watch_points_th_check
      check (jsonb_typeof(watch_points_th) = 'array');
  end if;
end
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
      summary_version text,
      content_scope text,
      content_status text,
      content_fetched_at timestamptz,
      source_evidence jsonb,
      watch_points_th jsonb,
      summary_method text
    )
  ), normalized as (
    select
      company_id, external_id, title, summary, title_th, summary_th,
      translated_at, translation_provider, source_name, source_url,
      published_at, category, fetched_at, what_happened_th,
      coalesce(entities_th, '[]'::jsonb) as entities_th,
      coalesce(key_points_th, '[]'::jsonb) as key_points_th,
      coalesce(key_numbers, '[]'::jsonb) as key_numbers,
      uncertainties_th, coalesce(source_scope, 'rss_excerpt') as source_scope,
      summary_version, coalesce(content_scope, 'rss_excerpt') as content_scope,
      coalesce(content_status, 'rss_fallback') as content_status,
      content_fetched_at, coalesce(source_evidence, '[]'::jsonb) as source_evidence,
      coalesce(watch_points_th, '[]'::jsonb) as watch_points_th,
      coalesce(summary_method, 'extractive_rules_v1') as summary_method
    from incoming
  ), upserted as (
    insert into public.stock_news (
      company_id, external_id, title, summary, title_th, summary_th,
      translated_at, translation_provider, source_name, source_url,
      published_at, category, fetched_at, what_happened_th, entities_th,
      key_points_th, key_numbers, uncertainties_th, source_scope, summary_version,
      content_scope, content_status, content_fetched_at, source_evidence,
      watch_points_th, summary_method
    )
    select
      company_id, external_id, title, summary, title_th, summary_th,
      translated_at, translation_provider, source_name, source_url,
      published_at, category, fetched_at, what_happened_th, entities_th,
      key_points_th, key_numbers, uncertainties_th, source_scope, summary_version,
      content_scope, content_status, content_fetched_at, source_evidence,
      watch_points_th, summary_method
    from normalized
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
      what_happened_th = case
        when stock_news.content_scope = 'article_page' and stock_news.content_status = 'extracted'
          and not (excluded.content_scope = 'article_page' and excluded.content_status = 'extracted')
        then stock_news.what_happened_th else excluded.what_happened_th end,
      entities_th = case
        when stock_news.content_scope = 'article_page' and stock_news.content_status = 'extracted'
          and not (excluded.content_scope = 'article_page' and excluded.content_status = 'extracted')
        then stock_news.entities_th else excluded.entities_th end,
      key_points_th = case
        when stock_news.content_scope = 'article_page' and stock_news.content_status = 'extracted'
          and not (excluded.content_scope = 'article_page' and excluded.content_status = 'extracted')
        then stock_news.key_points_th else excluded.key_points_th end,
      key_numbers = case
        when stock_news.content_scope = 'article_page' and stock_news.content_status = 'extracted'
          and not (excluded.content_scope = 'article_page' and excluded.content_status = 'extracted')
        then stock_news.key_numbers else excluded.key_numbers end,
      uncertainties_th = case
        when stock_news.content_scope = 'article_page' and stock_news.content_status = 'extracted'
          and not (excluded.content_scope = 'article_page' and excluded.content_status = 'extracted')
        then stock_news.uncertainties_th else excluded.uncertainties_th end,
      source_scope = case
        when stock_news.content_scope = 'article_page' and stock_news.content_status = 'extracted'
          and not (excluded.content_scope = 'article_page' and excluded.content_status = 'extracted')
        then stock_news.source_scope else excluded.source_scope end,
      summary_version = case
        when stock_news.content_scope = 'article_page' and stock_news.content_status = 'extracted'
          and not (excluded.content_scope = 'article_page' and excluded.content_status = 'extracted')
        then stock_news.summary_version else excluded.summary_version end,
      content_scope = case
        when stock_news.content_scope = 'article_page' and stock_news.content_status = 'extracted'
          and not (excluded.content_scope = 'article_page' and excluded.content_status = 'extracted')
        then stock_news.content_scope else excluded.content_scope end,
      content_status = case
        when stock_news.content_scope = 'article_page' and stock_news.content_status = 'extracted'
          and not (excluded.content_scope = 'article_page' and excluded.content_status = 'extracted')
        then stock_news.content_status else excluded.content_status end,
      content_fetched_at = case
        when stock_news.content_scope = 'article_page' and stock_news.content_status = 'extracted'
          and not (excluded.content_scope = 'article_page' and excluded.content_status = 'extracted')
        then stock_news.content_fetched_at else excluded.content_fetched_at end,
      source_evidence = case
        when stock_news.content_scope = 'article_page' and stock_news.content_status = 'extracted'
          and not (excluded.content_scope = 'article_page' and excluded.content_status = 'extracted')
        then stock_news.source_evidence else excluded.source_evidence end,
      watch_points_th = case
        when stock_news.content_scope = 'article_page' and stock_news.content_status = 'extracted'
          and not (excluded.content_scope = 'article_page' and excluded.content_status = 'extracted')
        then stock_news.watch_points_th else excluded.watch_points_th end,
      summary_method = case
        when stock_news.content_scope = 'article_page' and stock_news.content_status = 'extracted'
          and not (excluded.content_scope = 'article_page' and excluded.content_status = 'extracted')
        then stock_news.summary_method else excluded.summary_method end
    returning id, external_id
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(upserted)), '[]'::jsonb)
  from upserted;
$$;

revoke all on function public.upsert_stock_news_preserving_translations(jsonb) from public, anon, authenticated;
grant execute on function public.upsert_stock_news_preserving_translations(jsonb) to service_role;
