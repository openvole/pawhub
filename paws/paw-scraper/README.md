# @openvole/paw-scraper

**Extract structured data from web pages.**

[![npm](https://img.shields.io/npm/v/@openvole/paw-scraper)](https://www.npmjs.com/package/@openvole/paw-scraper)

Part of [OpenVole](https://github.com/openvole/openvole) — the microkernel AI agent framework.

## Install

```bash
npm install @openvole/paw-scraper
```

## Config

```json
{
  "name": "@openvole/paw-scraper",
  "allow": {
    "network": ["*"]
  }
}
```

## Tools

| Tool | Description |
|------|-------------|
| `scrape_page` | Fetch a URL and extract structured content: title, headings, text, links, metadata |
| `scrape_links` | Extract all links from a page with optional text filter |
| `scrape_tables` | Extract HTML tables as structured arrays (headers + rows) |
| `scrape_selector` | Extract content matching a CSS selector (text or attributes) |

## vs paw-browser

`paw-scraper` uses [cheerio](https://cheerio.js.org/) for fast HTML parsing — no browser needed. Use it when you just need to extract data from static HTML. Use `paw-browser` when you need JavaScript execution, clicking, or form interaction.

## License

[MIT](https://github.com/openvole/pawhub/blob/main/LICENSE)
