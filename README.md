# Returns Dashboard

Product Returns Intelligence for Three Bird Nest. Static `index.html` + `data.js` (returns snapshot) + two Vercel serverless functions. No build step.

## Files
- `index.html` — dashboard UI (Chart.js from jsDelivr)
- `data.js` — returns snapshot (`DATA`, `TREND_DATA`, `SKU_DATA`, `RETENTION_DATA`, `OUTLIERS_DATA`). Replace to refresh.
- `api/shopify-sales.js` — 90-day gross sales + orders by product via ShopifyQL (powers return rate + cost estimates)
- `api/ai.js` — streams Claude responses for the AI Recommendations and Customer Feedback tabs

## Vercel env vars
| Var | Notes |
|---|---|
| `SHOPIFY_STORE` | `three-bird-nest.myshopify.com` |
| `SHOPIFY_ADMIN_TOKEN` | Admin API token with `read_reports` scope |
| `SHOPIFY_CLIENT_ID` / `SHOPIFY_CLIENT_SECRET` | Alternative to the token (client-credentials app) |
| `ANTHROPIC_API_KEY` | Required for AI tabs |
| `ANTHROPIC_MODEL` | Optional, defaults to `claude-sonnet-4-5` |
| `SHOPIFY_API_VERSION` | Optional, defaults to `2025-10` |

## Deploy
Import the repo in Vercel (Framework preset: Other, no build command), add the env vars, deploy.
