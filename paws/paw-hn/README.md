# @openvole/paw-hn

A **Hacker News reader that lives inside your agent's dashboard** — live front page, stories, and
threads, with an embedded panel. Built on HN's public Firebase API (no key, read-only).

A second showcase of OpenVole's **embedded-app paws**: the panel calls the paw's own tools directly
(proxied over IPC, no LLM in the loop, no extra port), so it's a real interactive app inside the
`vole serve` dashboard. The same tools are available to the Brain — so you can also ask your agent
*"what's trending on HN, and summarize the top discussion?"*

## What it does

- **Panel (Apps tab):** the live HN front page (top / new / best / ask / show), each story with
  points, comments, domain, author, and age. Click *comments* to open the thread — story text plus
  top-level comments — without leaving the dashboard.
- **Brain tools:** the same `hn_top` and `hn_story` are callable by the agent, so it can read HN and
  summarize a thread on request. Deterministic — building the panel costs no tokens.

## Tools

| Tool | Purpose |
|------|---------|
| `hn_top` | Stories for a feed: `top` (default) / `new` / `best` / `ask` / `show` / `job`. Title, points, comments, url, domain, author, age. |
| `hn_story` | A single item with its top-level comments — for reading or summarizing a thread. |

## Install

```bash
npx vole paw add @openvole/paw-hn
```

## Config

No configuration and no API key. Requires `network` access to `hacker-news.firebaseio.com`
(granted in the paw manifest).

## Build your own panel paw

`paw-hn` is deliberately small — it's a template for **agents-with-apps**. A panel paw is just:

1. A folder with a `vole-paw.json` manifest declaring tools and a panel: `"panel": { "title": "…", "html": "panel.html" }`.
2. One or more tools (`execute(params)` returning data) — deterministic, no LLM required.
3. A static `panel.html` that calls those tools with `fetch('tool/<name>', { method: 'POST', body: JSON.stringify(params) })`.

That's the whole contract. Copy `paw-hn`, swap the data source, and you have your own app in the
dashboard. See also `paw-markets` and `paw-prospect`.

## License

[MIT](../../LICENSE)
