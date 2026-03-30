# @openvole/paw-social

**Post to Twitter/X and LinkedIn.**

[![npm](https://img.shields.io/npm/v/@openvole/paw-social)](https://www.npmjs.com/package/@openvole/paw-social)

Part of [OpenVole](https://github.com/openvole/openvole) — the microkernel AI agent framework.

## Install

```bash
npm install @openvole/paw-social
```

## Config

```json
{
  "name": "@openvole/paw-social",
  "allow": {
    "network": ["api.twitter.com", "api.x.com", "api.linkedin.com"],
    "env": ["TWITTER_BEARER_TOKEN", "TWITTER_API_KEY", "TWITTER_API_SECRET",
            "TWITTER_ACCESS_TOKEN", "TWITTER_ACCESS_SECRET", "LINKEDIN_ACCESS_TOKEN"]
  }
}
```

## Environment Variables

### Twitter/X

| Variable | Description |
|----------|-------------|
| `TWITTER_BEARER_TOKEN` | For search (read-only) |
| `TWITTER_API_KEY` | OAuth 1.0a consumer key (for posting) |
| `TWITTER_API_SECRET` | OAuth 1.0a consumer secret |
| `TWITTER_ACCESS_TOKEN` | OAuth 1.0a access token |
| `TWITTER_ACCESS_SECRET` | OAuth 1.0a access secret |

### LinkedIn

| Variable | Description |
|----------|-------------|
| `LINKEDIN_ACCESS_TOKEN` | OAuth token with `w_member_social` scope |

## Tools

| Tool | Description |
|------|-------------|
| `twitter_post` | Post a tweet (max 280 chars). Supports reply threading |
| `twitter_search` | Search recent tweets with public metrics |
| `linkedin_post` | Post to LinkedIn feed |

## License

[MIT](https://github.com/openvole/pawhub/blob/main/LICENSE)
