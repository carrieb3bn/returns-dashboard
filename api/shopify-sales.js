// GET /api/shopify-sales
// 90-day gross sales + orders by product title via ShopifyQL (Admin GraphQL).
// Env: SHOPIFY_STORE (e.g. three-bird-nest.myshopify.com) and either
//   SHOPIFY_ADMIN_ACCESS_TOKEN (shpat_…, from /api/shopify-install), or SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET (client-credentials app).
// Required scope: read_reports.

const API_VERSION = process.env.SHOPIFY_API_VERSION || '2025-10';
// Non-product line items (return-protection fees etc.) to drop from results.
const EXCLUDE = [/unlock free returns/i, /shipping protection/i, /package protection/i];
const QUERY = 'FROM sales SHOW gross_sales, orders GROUP BY product_title ORDER BY orders DESC SINCE -90d UNTIL today LIMIT 1000';

let cachedToken = null; // { token, expires }

async function getToken(store) {
  const t = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN || process.env.SHOPIFY_ADMIN_TOKEN;
  if (t) return t;
  const id = process.env.SHOPIFY_CLIENT_ID, secret = process.env.SHOPIFY_CLIENT_SECRET;
  if (!id || !secret) return null;
  if (cachedToken && cachedToken.expires > Date.now() + 60_000) return cachedToken.token;
  const r = await fetch(`https://${store}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret }),
  });
  if (!r.ok) throw Object.assign(new Error(`token exchange failed (${r.status})`), { code: 'auth' });
  const j = await r.json();
  cachedToken = { token: j.access_token, expires: Date.now() + (j.expires_in || 3600) * 1000 };
  return cachedToken.token;
}

export default async function handler(req, res) {
  const store = (process.env.SHOPIFY_STORE || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  try {
    const token = store && await getToken(store);
    if (!token) return res.status(500).json({ code: 'not_configured', error: 'Set SHOPIFY_STORE and SHOPIFY_ADMIN_ACCESS_TOKEN (run /api/shopify-install to get one).' });

    const r = await fetch(`https://${store}/admin/api/${API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
      body: JSON.stringify({
        query: 'query Sales($q: String!) { shopifyqlQuery(query: $q) { parseErrors tableData { columns { name } rows } } }',
        variables: { q: QUERY },
      }),
    });
    if (r.status === 401 || r.status === 403) return res.status(502).json({ code: 'auth', error: `Shopify rejected the token (${r.status})` });
    const j = await r.json();
    if (j.errors?.length) return res.status(502).json({ code: 'shopify', error: j.errors.map(e => e.message).join('; ') });
    const out = j.data?.shopifyqlQuery;
    if (out?.parseErrors?.length) return res.status(502).json({ code: 'shopify', error: out.parseErrors.join('; ') });

    // Normalize rows to [title, gross_sales, orders] whether Shopify returns arrays or keyed objects.
    const cols = (out?.tableData?.columns || []).map(c => c.name);
    const want = ['product_title', 'gross_sales', 'orders'];
    const rows = (out?.tableData?.rows || []).map(row =>
      Array.isArray(row) ? want.map(k => row[cols.indexOf(k)]) : want.map(k => row[k]))
      .filter(r => r[0] && !EXCLUDE.some(rx => rx.test(r[0])));

    res.setHeader('Cache-Control', 's-maxage=900, stale-while-revalidate=3600');
    return res.status(200).json({ rows, fetchedAt: new Date().toISOString() });
  } catch (e) {
    return res.status(502).json({ code: e.code || 'error', error: e.message });
  }
}
