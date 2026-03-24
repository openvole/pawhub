# @openvole/paw-computer

[![npm version](https://img.shields.io/npm/v/@openvole/paw-computer.svg)](https://www.npmjs.com/package/@openvole/paw-computer)

Control the desktop like a human — mouse, keyboard, screenshots.

A Tool Paw for [OpenVole](https://github.com/openvole/openvole) that provides desktop automation capabilities using native OS APIs via [nut-tree/nut-js](https://github.com/nut-tree/nut.js).

## Install

```bash
vole paw add @openvole/paw-computer
```

## Configuration

In your `vole.json`:

```json
{
  "paws": {
    "@openvole/paw-computer": {
      "allow": [
        "computer_screenshot",
        "computer_click",
        "computer_double_click",
        "computer_type",
        "computer_key",
        "computer_mouse_move",
        "computer_scroll",
        "computer_drag",
        "computer_active_window"
      ]
    }
  }
}
```

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `VOLE_COMPUTER_DELAY_MS` | Delay in ms between mouse actions for reliability | `100` |

## Platform Requirements

### macOS

- **Accessibility permission** — required for mouse and keyboard control. Grant it to your terminal app in **System Settings > Privacy & Security > Accessibility**.
- **Screen Recording permission** — required for screenshots. Grant it in **System Settings > Privacy & Security > Screen Recording**.

### Windows

Works out of the box. No additional permissions needed.

### Linux

- **X11** is required. Wayland has limited support for screen capture and input simulation.
- Ensure `libxtst-dev` and `libpng-dev` are installed for nut-js native bindings.

## Tools

| Tool | Description |
|---|---|
| `computer_screenshot` | Capture the screen and return as base64 PNG with active window info |
| `computer_click` | Click at screen coordinates (x, y) with left or right button |
| `computer_double_click` | Double click at screen coordinates |
| `computer_type` | Type text at the current cursor position |
| `computer_key` | Press a key combination (e.g. `ctrl+c`, `cmd+tab`, `enter`) |
| `computer_mouse_move` | Move the mouse cursor to coordinates without clicking |
| `computer_scroll` | Scroll up or down at a screen position |
| `computer_drag` | Drag from one screen position to another |
| `computer_active_window` | Get the title and bounds of the currently active window |

## Usage

The typical Brain workflow with paw-computer:

1. **Screenshot** — capture the current screen state
2. **Analyze** — the Brain (vision-capable model) interprets the screenshot
3. **Act** — click, type, or press keys based on what was seen
4. **Verify** — take another screenshot to confirm the action worked

```
User: "Open Safari and go to example.com"

Brain:
  1. computer_screenshot → sees the desktop
  2. computer_click(x=50, y=780) → clicks Safari in the dock
  3. computer_screenshot → sees Safari opened
  4. computer_click(x=400, y=52) → clicks the URL bar
  5. computer_type(text="example.com") → types the URL
  6. computer_key(keys="enter") → presses Enter
  7. computer_screenshot → verifies the page loaded
```

## License

MIT
