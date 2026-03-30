# @openvole/paw-pdf

**Read, merge, split, and extract text from PDFs.**

[![npm](https://img.shields.io/npm/v/@openvole/paw-pdf)](https://www.npmjs.com/package/@openvole/paw-pdf)

Part of [OpenVole](https://github.com/openvole/openvole) — the microkernel AI agent framework.

## Install

```bash
npm install @openvole/paw-pdf
```

## Config

```json
{
  "name": "@openvole/paw-pdf",
  "allow": {
    "filesystem": ["./"]
  }
}
```

## Tools

| Tool | Description |
|------|-------------|
| `pdf_read` | Extract text from a PDF file. Supports page range selection |
| `pdf_info` | Get metadata: page count, title, author, creation date, file size |
| `pdf_merge` | Merge multiple PDFs into a single file |
| `pdf_split` | Extract specific pages into a new PDF |

## Dependencies

Uses [pdf-lib](https://pdf-lib.js.org/) — pure JavaScript, no native dependencies.

## License

[MIT](https://github.com/openvole/pawhub/blob/main/LICENSE)
