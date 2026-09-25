// GET /api/shopify-install
// One-time OAuth install to get a permanent Admin API token.
//  1st visit (no ?code)  → redirects to Shopify's install/approve screen
//  Shopify redirects back here with ?code → exchanges it and shows the token to copy
// Env: SHOPIFY_STORE, SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET
// Redirect URL to set in the app: https://<your-app>.vercel.app/api/shopify-install
// Delete SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET after copying the token to disable this route.

import crypto from 'crypto';

const SCOPES = 'read_reports';

const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>body{font:15px -apple-system,BlinkMacSystemFont,sans-serif;max-width:640px;margin:60px auto;padding:0 16px;color:#1c1a24}
code{display:block;word-break:break-all;background:#f3f1f7;border:1px solid #e4e1ea;border-radius:8px;padding:14px;margin:12px 0;font-size:14px}
button{font:inherit;padding:8px 14px;border-radius:8px;border:1px solid #5b3fb8;background:#5b3fb8;color:#fff;cursor:pointer}
.err{color:#c2352b}</style></head><body>${body}</body></html>`;

function validHmac(query, secret) {
  const { hmac, signature, ...rest } = query;
  if (!hmac) return false;
  const msg = Object.keys(rest).sort().map(k => `${k}=${Array.isArray(rest[k]) ? rest[k].join(',') : rest[k]}`).join('&');
  const digest = crypto.createHmac('sha256', secret).update(msg).digest('hex');
  return digest.length === hmac.length && crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmac));
}

export default async function handler(req, res) {
  const store = (process.env.SHOPIFY_STORE || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const secret = process.env.SHOPIFY_CLIENT_SECRET;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');

  if (!store || !clientId || !secret) {
    return res.status(404).send(page('Install disabled', '<h2>Install is disabled</h2><p>Set SHOPIFY_STORE, SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET in Vercel to run the install.</p>'));
  }

  const q = req.query || {};
  const redirectUri = `https://${req.headers['x-forwarded-host'] || req.headers.host}/api/shopify-install`;

  // Step 1: send to Shopify's approval screen
  if (!q.code) {
    const state = crypto.randomBytes(16).toString('hex');
    res.setHeader('Set-Cookie', `shopify_oauth_state=${state}; Path=/api/shopify-install; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
    const url = `https://${store}/admin/oauth/authorize?` + new URLSearchParams({
      client_id: clientId, scope: SCOPES, redirect_uri: redirectUri, state,
    });
    return res.redirect(302, url);
  }

  // Step 2: Shopify sent us back with a code
  const cookieState = (req.headers.cookie || '').match(/shopify_oauth_state=([a-f0-9]+)/)?.[1];
  if (!validHmac(q, secret)) return res.status(400).send(page('Error', '<p class="err">HMAC check failed. Start again from /api/shopify-install.</p>'));
  if (!cookieState || cookieState !== q.state) return res.status(400).send(page('Error', '<p class="err">State mismatch. Start again from /api/shopify-install in the same browser.</p>'));
  if (q.shop !== store) return res.status(400).send(page('Error', `<p class="err">Shop ${q.shop} doesn’t match SHOPIFY_STORE (${store}).</p>`));

  const r = await fetch(`https://${store}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: secret, code: q.code }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    return res.status(502).send(page('Error', `<p class="err">Token exchange failed (${r.status}): ${String(j.error_description || j.error || '').replace(/</g, '&lt;')}</p>`));
  }

  res.setHeader('Set-Cookie', 'shopify_oauth_state=; Path=/api/shopify-install; Max-Age=0');
  return res.status(200).send(page('Shopify token', `
    <h2>Installed ✓</h2>
    <p>Scopes granted: <b>${j.scope}</b></p>
    <p>Add this in Vercel as <b>SHOPIFY_ADMIN_ACCESS_TOKEN</b>, redeploy, then delete SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET.</p>
    <code id="t">${j.access_token}</code>
    <button onclick="navigator.clipboard.writeText(document.getElementById('t').textContent);this.textContent='Copied'">Copy token</button>
    <p style="color:#6c6879;font-size:13px">This token isn’t stored anywhere. Close this tab once it’s saved.</p>`));
}
