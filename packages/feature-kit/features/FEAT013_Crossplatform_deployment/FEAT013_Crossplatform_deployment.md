# F13 — Cross-platform deployment

Run the same codebase on Node, web, Electron, mobile, and Docker.

---

## What this delivers

One TypeScript codebase that works everywhere. The filesystem abstraction handles the differences between platforms so modules don't need platform-specific code.

## Capabilities (shipped)

- **Universal filesystem** — `filesystem.ts` provides read/write/list/exists operations that work identically on Node.js, web (IndexedDB), Electron (local fs), and React Native (expo-file-system).
- **Docker support** — Dockerfile for both the web app and the headless scheduler. Compose file runs both together with shared data volume.
- **Environment detection** — runtime platform detection for conditional behavior (e.g., file paths, notification APIs).

## Architecture

- Filesystem interface defined once, implemented per platform.
- Docker images built from the same source, different entry points.
- Data folder mounted as a volume for persistence across container restarts.
