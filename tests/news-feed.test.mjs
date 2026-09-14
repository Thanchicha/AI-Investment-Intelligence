import test from 'node:test';
import assert from 'node:assert/strict';
import { recentPortfolioNews, loadPortfolioNews } from '../news-feed.js';

const now = new Date('2026-09-14T12:00:00Z');
test('shows at most 100 related articles within seven days, including the boundary', () => {
  const news = Array.from({ length: 110 }, (_, i) => ({ id: `held-${i}`, published_at: '2026-09-14T10:00:00Z' }));
  news.push({ id: 'boundary', published_at: '2026-09-07T12:00:00Z' },
    { id: 'expired', published_at: '2026-09-07T11:59:59Z' },
    { id: 'future', published_at: '2026-09-15T12:00:00Z' },
    { id: 'invalid', published_at: 'invalid' },
    { id: 'other', published_at: '2026-09-14T11:00:00Z' });
  const links = news.map(n => ({ news_id: n.id, company_id: n.id === 'other' ? 'other' : 'held', explicit_mention: true }));
  assert.equal(recentPortfolioNews(news, links, ['held'], now).length, 100);
  assert.deepEqual(recentPortfolioNews(news.slice(110), links, ['held'], now).map(n => n.id), ['boundary']);
  assert.deepEqual(recentPortfolioNews(news, links, [], now), []);
});

test('returns selected articles together with their matching links and surfaces database errors', async () => {
  const payload = { news: [{ id: 'latest' }], links: [{ news_id: 'latest', company_id: 'held' }] };
  const client = { rpc: async name => { assert.equal(name, 'get_portfolio_news'); return { data: payload, error: null }; } };
  assert.deepEqual(await loadPortfolioNews(client), payload);
  await assert.rejects(loadPortfolioNews({ rpc: async () => ({ error: new Error('unavailable') }) }), /unavailable/);
});
