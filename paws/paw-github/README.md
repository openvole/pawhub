# @openvole/paw-github

**GitHub API integration via Octokit.**

[![npm](https://img.shields.io/npm/v/@openvole/paw-github)](https://www.npmjs.com/package/@openvole/paw-github)

Part of [OpenVole](https://github.com/openvole/openvole) — the microkernel AI agent framework.

## Install

```bash
npm install @openvole/paw-github
```

## Config

```json
{
  "name": "@openvole/paw-github",
  "allow": {
    "network": ["api.github.com"],
    "env": ["GITHUB_TOKEN"]
  }
}
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GITHUB_TOKEN` | GitHub personal access token |

## Tools

| Tool | Description |
|------|-------------|
| `github_create_issue` | Create a GitHub issue in a repository |
| `github_list_issues` | List issues in a GitHub repository |
| `github_create_pr` | Create a pull request in a GitHub repository |
| `github_list_prs` | List pull requests in a GitHub repository |
| `github_search_repos` | Search GitHub repositories |
| `github_get_file` | Get file content from a GitHub repository |

## License

[MIT](https://github.com/openvole/pawhub/blob/main/LICENSE)
