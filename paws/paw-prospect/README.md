# @openvole/paw-prospect

Prospect & lead enrichment from a company website URL — paste a domain, get a structured company
profile, rendered in an embedded dashboard panel.

A demonstration of OpenVole's **embedded-app paws**: the panel calls the paw's own tools directly
(proxied over IPC, no LLM in the loop, no extra port), so you get a real interactive app inside the
`vole serve` dashboard. The same tools are available to the Brain, so an agent can research a
prospect in chat too.

## What it does

Give it a company website (`stripe.com` or `https://stripe.com`) and it fetches the public homepage
(and the About page if the homepage blurb is thin) and extracts:

- **Name, tagline, description** — from `<title>`, Open Graph / meta tags, and JSON-LD `Organization` data
- **Logo** — JSON-LD logo, `og:image`, or favicon
- **Social links** — LinkedIn, X/Twitter, GitHub, YouTube, Facebook, Instagram
- **Detected tech** — WordPress, Shopify, Next.js, HubSpot, Stripe, analytics, and more
- **Location** — from JSON-LD postal address, when published
- **Key pages** — About, Careers, Pricing, Contact, Blog
- **Contact emails** — from `mailto:` links

It's deterministic and free — no LLM call to build the profile.

## Tools

| Tool | Purpose |
|------|---------|
| `prospect_lookup` | Fetch a company site (URL or bare domain) → structured profile. Call this, then summarize/assess the prospect. |
| `prospect_history` | Recent lookups (powers the panel's recent list). `action: 'list' \| 'clear'`. |

## Panel

Adds a **Prospect** panel to the dashboard's **Apps** tab: a search box, a profile card, and a list
of recent lookups you can re-open with one click.

## Install

```bash
npx vole paw add @openvole/paw-prospect
```

## Config

| Env | Default | Purpose |
|-----|---------|---------|
| `VOLE_PROSPECT_DIR` | `.openvole/paws/paw-prospect` | Where recent-lookup history is stored |

Requires `network` permission (granted by default for this paw) to fetch company sites.

## A note on responsible use

This paw makes a **single, on-demand request** to a public company website when you ask — the same
thing a browser does when you visit. It is not a crawler and does not bulk-scrape. Use it on public
company sites, and respect each site's terms of service and `robots.txt`. For person-level data or
large-scale enrichment, use a licensed, ToS-compliant enrichment API instead.

## License

[MIT](../../LICENSE)
