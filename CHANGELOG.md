# Changelog

## r2026-6-21

### Changed
- **`@openvole/paw-brain` 2.2.0** — new **mock provider** (`BRAIN_PROVIDER=mock`) for free, deterministic testing without a real LLM: echo replies (`BRAIN_MOCK_REPLY`) or scripted turns (`BRAIN_MOCK_SCRIPT`). Useful for exercising VoleNet meshes and hubs without API cost.
- **`@openvole/paw-session` 2.2.0** — new **`session_append`** tool for writing a single transcript entry outside the brain loop (backs VoleNet peer-to-peer chat persistence), plus an optional `maxMessages` retention cap (`trimToLast`) to bound transcript growth.

## r2026-6-18

### New
- **`@openvole/paw-prospect` 0.1.0** — company & lead enrichment from a website URL. Paste a domain (e.g. `stripe.com`) and it fetches the public site and returns a structured company profile: name, tagline, description, logo, social links, detected tech stack, location, key pages, and contact emails. Ships an embedded **Prospect** dashboard panel and is callable by the Brain. Deterministic — no LLM in the loop. A second embedded-app paw example alongside `paw-markets`.

### Changed
- **`@openvole/paw-markets` 0.1.1** — recategorized from `infrastructure` to `tool` so it groups with the other agent tools in the dashboard. Cosmetic only; no change to polling, alerts, tools, or the panel.
