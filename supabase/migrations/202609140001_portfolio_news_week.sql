-- Select the user's matching news before limiting the feed, and return links
-- for exactly those articles. This avoids REST's default 1,000-link row cap.
create index if not exists stock_news_published_id_idx
  on public.stock_news (published_at desc, id desc);

create or replace function public.get_portfolio_news()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with selected_news as materialized (
    select n.*
    from public.stock_news n
    where n.published_at >= pg_catalog.now() - interval '7 days'
      and n.published_at <= pg_catalog.now()
      and exists (
        select 1 from public.news_company_links l
        join public.portfolio_holdings h on h.company_id = l.company_id
        where l.news_id = n.id
          and l.explicit_mention = true
          and h.user_id = (select auth.uid())
      )
    order by n.published_at desc, n.id desc
    limit 100
  )
  select pg_catalog.jsonb_build_object(
    'news', coalesce((select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(n) order by n.published_at desc, n.id desc) from selected_news n), '[]'::jsonb),
    'links', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(l))
      from public.news_company_links l
      join selected_news n on n.id = l.news_id
      join public.portfolio_holdings h on h.company_id = l.company_id
      where l.explicit_mention = true and h.user_id = (select auth.uid())
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.get_portfolio_news() from public, anon;
grant execute on function public.get_portfolio_news() to authenticated;
