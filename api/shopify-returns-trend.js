// GET /api/shopify-returns-trend
// Weekly returned units per product (last 13 full weeks) from Shopify, by refund date.
// Feeds the Trends tab when the returns export has no dates.
// Env: SHOPIFY_STORE + SHOPIFY_ADMIN_ACCESS_TOKEN (same as shopify-sales). Scope: read_reports.

const API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-10';
const WEEKS = 13, TOP_N = 50;
const EXCLUDE = [/unlock free returns/i, /shipping protection/i, /package protection/i];

async function shopifyql(store, token, q) {
  const r = await fetch(`https://${store}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
    body: JSON.stringify({
      query: 'query Q($q: String!) { shopifyqlQuery(query: $q) { parseErrors tableData { columns { name } rows } } }',
      variables: { q },
    }),
  });
  if (r.status === 401 || r.status === 403) throw Object.assign(new Error(`Shopify rejected the token (${r.status})`), { code: 'auth' });
  const j = await r.json();
  if (j.errors?.length) throw Object.assign(new Error(j.errors.map(e => e.message).join('; ')), { code: 'shopify' });
  const out = j.data?.shopifyqlQuery;
  if (out?.parseErrors?.length) throw Object.assign(new Error(out.parseErrors.join('; ')), { code: 'shopify' });
  const cols = (out?.tableData?.columns || []).map(c => c.name);
  return (out?.tableData?.rows || []).map(row => Array.isArray(row) ? Object.fromEntries(cols.map((c, i) => [c, row[i]])) : row);
}

const quote = s => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
const ymd = d => d.toISOString().slice(0, 10);

export default async function handler(req, res) {
  const store = (process.env.SHOPIFY_STORE || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  const token = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || process.env.SHOPIFY_ADMIN_TOKEN;
  if (!store || !token) return res.status(500).json({ code: 'not_configured', error: 'Set SHOPIFY_STORE and SHOPIFY_ADMIN_ACCESS_TOKEN.' });

  try {
    // Full weeks only: Monday 13 weeks back through last Sunday.
    const now = new Date();
    const thisMon = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - ((now.getUTCDay() + 6) % 7)));
    const since = new Date(thisMon); since.setUTCDate(since.getUTCDate() - 7 * WEEKS);
    const until = new Date(thisMon); until.setUTCDate(until.getUTCDate() - 1);
    const range = `SINCE ${ymd(since)} UNTIL ${ymd(until)}`;

    // 1) Top products by units returned in the window (returned qty is negative in Shopify).
    const top = (await shopifyql(store, token,
      `FROM sales SHOW quantity_returned GROUP BY product_title ${range} ORDER BY quantity_returned ASC LIMIT ${TOP_N + 10}`))
      .map(r => ({ name: r.product_title, total: -parseInt(r.quantity_returned, 10) || 0 }))
      .filter(p => p.name && p.total > 0 && !EXCLUDE.some(rx => rx.test(p.name)))
      .slice(0, TOP_N);
    if (!top.length) return res.status(200).json({ weeks: [], products: [], range: { since: ymd(since), until: ymd(until) } });

    // 2) Weekly breakdown for those products.
    const rows = await shopifyql(store, token,
      `FROM sales SHOW quantity_returned WHERE product_title IN (${top.map(p => quote(p.name)).join(', ')}) GROUP BY week, product_title ${range} ORDER BY week ASC LIMIT 1000`);

    const weekKeys = Array.from({ length: WEEKS }, (_, i) => { const d = new Date(since); d.setUTCDate(d.getUTCDate() + 7 * i); return ymd(d); });
    const weekly = {};
    rows.forEach(r => {
      const wk = String(r.week || '').slice(0, 10);
      if (!weekKeys.includes(wk)) return;
      (weekly[r.product_title] = weekly[r.product_title] || {})[wk] = -parseInt(r.quantity_returned, 10) || 0;
    });

    const half = Math.floor(WEEKS / 2);
    const products = top.map(p => {
      const vals = weekKeys.map(w => (weekly[p.name] || {})[w] || 0);
      const first = vals.slice(0, half).reduce((a, b) => a + b, 0);
      const last = vals.slice(WEEKS - half).reduce((a, b) => a + b, 0);
      const avg = vals.reduce((a, b) => a + b, 0) / WEEKS;
      const pctChange = first > 0 ? Math.round(Math.abs(last - first) / first * 100) : (last > 0 ? 100 : 0);
      const direction = first === 0 && last === 0 ? 'flat' : last >= first * 1.2 ? 'up' : last <= first * 0.8 ? 'down' : 'flat';
      return { name: p.name, weekly: Object.fromEntries(weekKeys.map((w, i) => [w, vals[i]])), direction, pctChange, hasSpike: vals.some(v => v >= 5 && v >= avg * 2.5) };
    });

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=21600');
    return res.status(200).json({ weeks: weekKeys, products, range: { since: ymd(since), until: ymd(until) }, fetchedAt: new Date().toISOString() });
  } catch (e) {
    return res.status(502).json({ code: e.code || 'error', error: e.message });
  }
}
