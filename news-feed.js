import { articlesForHoldings } from './supabase/functions/_shared/news-rules.js';

export function recentPortfolioNews(news, links, holdingIds, now = new Date()) {
  const end = now.getTime();
  const start = end - 7 * 24 * 60 * 60 * 1000;
  return articlesForHoldings(news, links, holdingIds)
    .filter(article => { const date = Date.parse(article.published_at); return date >= start && date <= end; })
    .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at) || String(b.id).localeCompare(String(a.id)))
    .slice(0, 100);
}

export async function loadPortfolioNews(client) {
  const { data, error } = await client.rpc('get_portfolio_news');
  if (error) throw error;
  return { news: data?.news || [], links: data?.links || [] };
}
