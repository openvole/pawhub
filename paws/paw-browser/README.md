# @openvole/paw-browser

**Browser automation Paw using Puppeteer.**

[![npm](https://img.shields.io/npm/v/@openvole/paw-browser)](https://www.npmjs.com/package/@openvole/paw-browser)

Part of [OpenVole](https://github.com/openvole/openvole) — the microkernel AI agent framework.

## Install

```bash
npm install @openvole/paw-browser
```

## Config

```json
{
  "name": "@openvole/paw-browser",
  "allow": {
    "network": ["*"],
    "env": ["VOLE_BROWSER_HEADLESS"]
  }
}
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `VOLE_BROWSER_HEADLESS` | Run browser in headless mode (`true`/`false`, default `true`) |

## Tools

| Tool | Description |
|------|-------------|
| `browser_navigate` | Navigate to a URL in the browser |
| `browser_click` | Click an element on the page by CSS selector |
| `browser_type` | Type text into an input element by CSS selector |
| `browser_screenshot` | Take a full-page screenshot (returns base64 PNG) |
| `browser_content` | Get page text content and accessibility tree |
| `browser_evaluate` | Run arbitrary JavaScript in the page context |

## License

[MIT](https://github.com/openvole/pawhub/blob/main/LICENSE)
