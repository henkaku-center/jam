# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm start` — run the Express + WebSocket server (`server.js`) on `PORT` (default 3000).
- `npm test` / `npm run test:e2e` — Playwright e2e suite. Spawns its own server on port 3100 with `CODEGEN_PROVIDER=mock` (see `playwright.config.js`); reuses an existing server outside CI.
- `npm run test:e2e:headed` — same, headed. Tests target Chrome Canary at `/usr/bin/google-chrome-canary` unless `CHROME_CANARY_PATH` overrides it.
- Single test: `npx playwright test tests/e2e/jam.performance.spec.js -g "<name>"`.

There is no lint, build, or typecheck step — pure ESM JS, served as-is from `public/`.

## Codegen provider configuration

The server's `/api/compile` endpoint generates element source via a configurable provider chain (`CODEGEN_PROVIDER` env var, comma-separated or `auto`):
- `codex` — spawns `codex exec` CLI (resumes via session id when available).
- `claude` — spawns `claude --print` CLI.
- `gemini` — REST call, requires `GEMINI_API_KEY`.
- `mock` — local heuristic generator in `getMockCode()` (synth/LFO/sequencer/visualizer templates). The e2e suite forces this.

Failing providers fall through to the next; the mock is the ultimate fallback. The persistent in-browser "agent terminal" is a separate PTY (`getInteractiveAgentConfig`) using `codex --yolo` or `claude --permission-mode dontAsk`, not the compile pipeline.

## Architecture

Read `DESIGN.md` first — it is the authoritative spec. Key points that aren't obvious from reading any single file:

**Host vs. Thin-Controller is one codebase, one query param.** `?host=true` / button choice flips `isHost` in `public/client.js`. Both modes build the full Web Audio graph; controllers route their `masterGain` to `0` so element code runs identically (visualizers, AnalyserNodes, etc.) but stays silent. Never branch element code on host/controller — the harness handles muting.

**Three WebSocket channels on one HTTP server** (`server.js` `upgrade` handler):
- `/yjs` — y-websocket for the shared `jam-workspace` doc (`elements`, `clock`, `global_bus` Y.Maps). Persisted to `workspace_layout.json` on every change; restored on server startup.
- `/controller` — raw low-latency relay. Controllers send, host receives. Bypasses Yjs for sub-15ms MIDI/slider events.
- `/agent-terminal` — bridges a single shared `node-pty` PTY (the codex/claude CLI) into all connected browsers via xterm.js. History is replayed to new connections.

**Element lifecycle.** Elements are pure ESM modules in `public/elements/` exporting `default function setup(ctx, prevState)`. The server transpiles `export default` → `return` and the client evaluates the IIFE via `new Function()` — *not* dynamic `import()`. This is deliberate: dynamic ESM imports leak in V8, `new Function()` closures are fully GC'd on `destroy()`. Do not "fix" this back to `import()`.

**Hot-reload is bar-aligned.** When an element's `prompt` or `filePath` changes in the Yjs map, all clients re-fetch and re-evaluate. The new instance is wired up at `gain=0`, then a Web Audio `linearRampToValueAtTime` crossfade is scheduled for the next bar downbeat (computed from `clockMap.{bpm,startTime}` and the synced clock offset). If the setup window is <200ms, the harness automatically bumps to bar+2. State transfers via `prevState = oldRuntime.getState()`.

**Visual NTP.** Clients estimate `serverClockOffset` by hitting `/api/compile` with `{prompt: 'PING'}` (fast-pathed in the server). All beat math uses `getSyncTime()`, never `Date.now()` directly. BPM changes use a pivot formula in `changeBPM()` to keep the beat count continuous.

**Element harness sandbox** (`createElementHarnessContext` in `client.js`). The `ctx` passed to `setup()` wraps `audioCtx`, `domRoot` (Shadow DOM), `clock`, and `bus` with proxies that track every audio node, event listener, interval, and clock subscription created. On reload/destroy, `forceTearDown()` runs even if the element's own `destroy()` is missing or throws. When editing element code, you can rely on this safety net but should still implement `destroy()` cleanly.

**Two-tier SignalBus**, both auto-namespaced to the element's instance id:
- `ctx.bus.pub/sub` — local, in-memory, high-frequency (LFO modulation). Never publishes user input to here, because controllers wouldn't reach the host.
- `ctx.bus.pubGlobal/subGlobal` — Yjs-synced, low-frequency state (slider positions, sequencer patterns).
- Cross-element keys must be prefixed `global:` (e.g. `global:tempo_bpm`) to bypass auto-namespacing.

**Compile-time wiring.** When an element prompt mentions another element (e.g. "connect this LFO to that synth"), the codegen agent is expected to hardcode the *other element's namespaced key* (`elem_xxx:lfo_value`) into the generated source. There is no runtime patch matrix.

## Editing element source

Element files in `public/elements/` follow the Micro-App Contract in `DESIGN.md` §2. Constraints worth repeating:
- No top-level `import` statements — use dynamic `await import('https://esm.sh/...')` inside `setup`.
- Connect audio to `ctx.audioOut`, never to `ctx.audioCtx.destination`.
- User-input handlers must publish via `pubGlobal` (or `sendControllerData` for raw low-latency) — local `pub` from a controller will be silently dropped at the host.
- Render UI into `ctx.domRoot` (a Shadow Root). Inline `<style>` is the convention.

When changing element code while the server is running, edits to `public/elements/*.js` are *not* picked up by an existing in-browser instance. Trigger a hot-reload by bumping the element's `prompt` in `workspace_layout.json` (the server will write changes back, so use Yjs/the UI when possible) or by re-instantiating from the canvas.

## E2E test caveats

Tests snapshot and restore `workspace_layout.json` and `public/elements/` around each run (see `snapshotMutableWorkspaceFiles` / `restoreMutableWorkspaceFiles`). If a test aborts mid-run, those files may be left in a modified state — check `git status` before re-running.
