# YeetSend

Wired file transfer between your computer and Android device via ADB, directly in the browser.

## Tech Stack

### Frontend (Client-Side)

| Technology | Purpose |
|---|---|
| **HTML / CSS / JavaScript** | Core UI — no frameworks, no build step |
| [@yume-chan/adb](https://www.npmjs.com/package/@yume-chan/adb) | ADB protocol implementation in JavaScript (Tango ADB) |
| [@yume-chan/adb-daemon-webusb](https://www.npmjs.com/package/@yume-chan/adb-daemon-webusb) | WebUSB transport layer for ADB connections |
| [@yume-chan/adb-credential-web](https://www.npmjs.com/package/@yume-chan/adb-credential-web) | Browser-based RSA key storage for ADB authentication |
| [@yume-chan/stream-extra](https://www.npmjs.com/package/@yume-chan/stream-extra) | Stream utilities (`WrapConsumableStream`, `WrapReadableStream`) for file uploads |
| [esm.sh](https://esm.sh) | CDN for loading ES modules directly in the browser without bundling |
| [Google Fonts (Inter)](https://fonts.google.com/specimen/Inter) | Typography |
| [WebUSB API](https://developer.mozilla.org/en-US/docs/Web/API/WebUSB_API) | Browser API for direct USB device communication |

### Backend (Optional — Local Development)

| Technology | Purpose |
|---|---|
| **Go** (1.26+) | Local HTTP server with ADB bridge for development |
| **ADB** (Android Debug Bridge) | Command-line tool for device communication in server mode |

### Deployment

| Technology | Purpose |
|---|---|
| [Vercel](https://vercel.com) | Static site hosting and deployment |

## Prerequisites

- **Browser**: Use a Chromium-based browser (Chrome, Edge, Brave, Opera). Safari and Firefox do not support WebUSB.
- **ADB Status**: Ensure no other native ADB server is running on your machine (run `adb kill-server` if you have Android Studio or platform-tools running, as they claim the USB interface).
- **USB Debugging**: Enable USB Debugging in your phone's Developer Options.

## Development

### Option 1: Just open in browser
Open `web/index.html` directly in a Chromium browser. Everything runs client-side.

### Option 2: Launch Go server (optional)
```bash
go run .
```
Then open `http://localhost:8080` in your browser.

## Vercel Deployment

Deploy directly by connecting your repository to Vercel. The included `vercel.json` automatically routes your domain root to the `web` folder.

## Special Thanks & Credits

### Tango ADB by [@yume-chan](https://github.com/yume-chan)

Massive thanks to **Simon Chan** ([@yume-chan](https://github.com/yume-chan)) for creating the incredible [Tango ADB](https://github.com/yume-chan/ya-webadb) library. This project would not be possible without it. Tango ADB provides a complete, pure-JavaScript implementation of the ADB protocol that runs entirely in the browser via WebUSB — no native binaries, no drivers, no server.

- Documentation: [tangoadb.dev](https://tangoadb.dev)
- Source: [github.com/yume-chan/ya-webadb](https://github.com/yume-chan/ya-webadb)
- Sponsor: [opencollective.com/ya-webadb](https://opencollective.com/ya-webadb)

### WebUSB API

Thanks to the Chromium team for implementing the [WebUSB API](https://wicg.github.io/webusb/) which makes direct USB device access from web pages possible.

### esm.sh

Thanks to [esm.sh](https://esm.sh) for providing a fast, reliable CDN that serves npm packages as ES modules, letting this project avoid any build tooling entirely.

### LocalSend

Inspired by [LocalSend](https://github.com/localsend/localsend), the open-source cross-platform file sharing app. YeetSend takes the same idea but goes wired for maximum speed and simplicity.
