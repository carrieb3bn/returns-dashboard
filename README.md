# Returns Dashboard

Product Returns Intelligence for Three Bird Nest. Static `index.html` + `data.js` (returns snapshot) + two Vercel serverless functions. No build step.

## Files
- `index.html` — dashboard UI (Chart.js from jsDelivr)
- `data.js` — published returns snapshot (`DATA`, `TREND_DATA`, `SKU_DATA`, `RETENTION_DATA`, `OUTLIERS_DATA`)
- `import.js` — "Import Loop export" button: rebuilds the dashboard from a Loop CSV in the browser
- `api/shopify-sales.js` — 90-day gross sales + orders by product via ShopifyQL (powers return rate + cost estimates)
- `api/shopify-install.js` — one-time OAuth install that shows the Admin token to copy
- `api/ai.js` — streams Claude responses for the AI Recommendations and Customer Feedback tabs

## Vercel env vars
| Var | Notes |
|---|---|
| `SHOPIFY_STORE` | `three-bird-nest.myshopify.com` |
| `SHOPIFY_ADMIN_ACCESS_TOKEN` | Admin API token (`read_reports`), from `/api/shopify-install` |
| `SHOPIFY_CLIENT_ID` / `SHOPIFY_CLIENT_SECRET` | Only during install; delete after saving the token |
| `ANTHROPIC_API_KEY` | Required for AI tabs |
| `ANTHROPIC_MODEL` | Optional, defaults to `claude-sonnet-4-5` |
| `SHOPIFY_API_VERSION` | Optional, defaults to `2025-10` |

## Deploy
Import the repo in Vercel (Framework preset: Other, no build command), add the env vars, deploy.

## Getting the Shopify token
1. Create an app in the Shopify Partner / Dev Dashboard. Redirect URL: `https://<your-app>.vercel.app/api/shopify-install`. Scope: `read_reports`.
2. Add `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, `SHOPIFY_STORE` in Vercel → Redeploy.
3. Visit `/api/shopify-install` → Install → copy the token.
4. Add it as `SHOPIFY_ADMIN_ACCESS_TOKEN` → Redeploy.
5. Delete `SHOPIFY_CLIENT_ID` and `SHOPIFY_CLIENT_SECRET` (disables the install route) → Redeploy.

## Refreshing returns data
1. Click **Import Loop export** on the dashboard and pick the Loop CSV.
2. Check the column matches → **Build dashboard**. The import stays in your browser.
3. To publish it for everyone: **Download data.js** → replace `data.js` in GitHub.

Retention customer figures (returning-customer rate) aren't in Loop exports, so they stay as published; return counts and quadrants refresh from the import.
