# Changelog

## r2026-6-18

### New
- **`@openvole/paw-prospect` 0.1.0** — company & lead enrichment from a website URL. Paste a domain (e.g. `stripe.com`) and it fetches the public site and returns a structured company profile: name, tagline, description, logo, social links, detected tech stack, location, key pages, and contact emails. Ships an embedded **Prospect** dashboard panel and is callable by the Brain. Deterministic — no LLM in the loop. A second embedded-app paw example alongside `paw-markets`.

### Changed
- **`@openvole/paw-markets` 0.1.1** — recategorized from `infrastructure` to `tool` so it groups with the other agent tools in the dashboard. Cosmetic only; no change to polling, alerts, tools, or the panel.
