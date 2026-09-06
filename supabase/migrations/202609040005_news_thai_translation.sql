alter table public.stock_news
  add column title_th text,
  add column summary_th text,
  add column translated_at timestamptz,
  add column translation_provider text;
