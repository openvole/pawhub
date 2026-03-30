# @openvole/paw-image

**Resize, crop, watermark, compress, and convert images.**

[![npm](https://img.shields.io/npm/v/@openvole/paw-image)](https://www.npmjs.com/package/@openvole/paw-image)

Part of [OpenVole](https://github.com/openvole/openvole) — the microkernel AI agent framework.

## Install

```bash
npm install @openvole/paw-image
```

## Config

```json
{
  "name": "@openvole/paw-image",
  "allow": {
    "filesystem": ["./"]
  }
}
```

## Tools

| Tool | Description |
|------|-------------|
| `image_info` | Get metadata: dimensions, format, channels, color space, file size |
| `image_resize` | Resize with aspect ratio preservation (fit modes: cover, contain, fill, inside, outside) |
| `image_crop` | Crop a region by pixel coordinates |
| `image_compress` | Reduce file size with configurable quality (1-100) |
| `image_convert` | Convert between formats: PNG, JPEG, WebP, AVIF, TIFF |
| `image_watermark` | Add text watermark with configurable position and opacity |

## Dependencies

Uses [sharp](https://sharp.pixelplumbing.com/) — high-performance image processing powered by libvips.

## License

[MIT](https://github.com/openvole/pawhub/blob/main/LICENSE)
