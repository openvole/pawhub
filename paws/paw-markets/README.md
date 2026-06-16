# @openvole/paw-markets

US stock market **tracking, news, and trend monitoring** for OpenVole.

The tracking/reporting/trend math is **deterministic and brain-free** — the paw polls on its own
schedule (no LLM, no tokens) and writes a snapshot report. The Brain is only involved when you
want it: ask it to call `market_report` and *comment* on the trends.

## How it works

- **Brain-free poller** — on load, the paw starts an internal `setInterval` (default every 15 min,
  market-hours-aware: US 9:30–16:00 ET, weekdays). Each tick it fetches quotes + daily history for
  the watchlist, computes indicators, detects notable events, and writes
  `.openvole/paws/paw-markets/reports/latest.json` + appends `alerts.jsonl`. Zero LLM.
- **Brain commentary (optional)** — the Brain calls `market_report` / `stock_trend` and writes the
  human take. *Data from the paw, opinion from the Brain.*

## Markets panel (embedded in the dashboard)

The paw contributes a **Markets** tab to the OpenVole control-plane dashboard — **no separate port,
no extra web server**. Watchlist table with live price/%change, sparklines, RSI and signal chips;
click a row for a 120-day chart + headlines; a live alerts feed; add/remove symbols inline. It
auto-refreshes every 30s and reads everything through the paw's tools (proxied by the control plane
over IPC) — **brain-free**. Declared in the manifest: `"panel": { "title": "Markets", "html": "panel.html" }`.

## Channel alerts

When a notable event fires (`big-gain`/`big-drop`/`volume-spike`/`near-52w-high`/`near-52w-low`),
the paw pushes a formatted message **directly** to whatever channels you've configured — no other
paw or LLM involved:

- **Slack** — set `MARKETS_SLACK_WEBHOOK` (Incoming Webhook URL)
- **Telegram** — set `MARKETS_TELEGRAM_TOKEN` + `MARKETS_TELEGRAM_CHAT_ID`
- **Discord / generic** — set `MARKETS_WEBHOOK_URL` (posts `{content, alerts}` JSON)

Each event is sent once per day (deduped per symbol+signal).

## Tools

| Tool | What it does |
|------|--------------|
| `stock_quote` | Latest price + 1-day change for one or more tickers |
| `stock_trend` | %change (1d/5d/1mo), SMA20/50, 52-wk high/low, volume vs avg, RSI, signal flags |
| `stock_news` | Recent headlines for a ticker |
| `stock_watchlist` | `list` / `add` / `remove` tracked symbols |
| `market_report` | Cached snapshot of the whole watchlist (+ `refresh:true` to force a poll) |

## Data sources (free)

- **Quotes + history (default, no key)**: Nasdaq's public quote/historical API — returns the latest
  price (real-time during market hours) and daily OHLCV history, no authentication required.
- **Reliable keyed option**: set `TWELVEDATA_KEY` (free tier, 800 req/day, 8/min) — an official API
  for both quotes and daily history; used in preference when set.
- **Real-time quotes (optional)**: set `FINNHUB_KEY` (free tier, 60 req/min) for live intraday prices.
- **Last-resort fallback**: Yahoo Finance v8 chart API (no key) — kept only if Nasdaq is unavailable.
  It rate-limits aggressively and frequently returns **429**, which is why it's no longer the default.
- **News**: Yahoo Finance RSS — no key.

Provider order — **history**: Twelve Data (if keyed) → Nasdaq → Yahoo. **Quotes**: Finnhub → Twelve
Data → Nasdaq → Yahoo.

> These endpoints are **unofficial** and can change or rate-limit; the paw polls gently (sequential,
> market-hours-aware) to stay well under limits. For production/commercial use, point it at a paid
> feed (Finnhub paid, Polygon, etc.). Output is informational, **not financial advice**.

## Configuration (env)

| Var | Default | Meaning |
|-----|---------|---------|
| `MARKETS_SYMBOLS` | — | Comma-separated seed watchlist on first run (e.g. `AAPL,MSFT,NVDA`) |
| `MARKETS_POLL_SECONDS` | `900` | Poll interval |
| `MARKETS_MOVE_ALERT_PCT` | `5` | Flag a `big-gain`/`big-drop` at this 1-day % move |
| `MARKETS_VOLUME_SPIKE_X` | `1.5` | Flag a `volume-spike` at this × 20-day avg volume |
| `TWELVEDATA_KEY` | — | Optional, reliable free quotes + history (recommended over Yahoo) |
| `FINNHUB_KEY` | — | Optional, enables real-time intraday quotes |
| `MARKETS_SLACK_WEBHOOK` | — | Slack Incoming Webhook URL for alerts |
| `MARKETS_TELEGRAM_TOKEN` / `MARKETS_TELEGRAM_CHAT_ID` | — | Telegram bot alerts |
| `MARKETS_WEBHOOK_URL` | — | Discord/generic JSON webhook for alerts |
| `VOLE_MARKETS_DIR` | `.openvole/paws/paw-markets` | Data dir override |

## Notes

- Holidays aren't in the market-hours check (weekday + time only).
- The watchlist is seeded from `MARKETS_SYMBOLS` once, then managed via `stock_watchlist`.
