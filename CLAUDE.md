# CLAUDE.md

Guidance for Claude Code and other coding agents working in this repository.

## Commands

- `npm start` runs the Express/WebSocket server on `PORT` or `3000`.
- `npm run jam -- <command>` calls the live workspace control plane. Start with `npm run jam -- state`.
- `npm run smoke:live` opens the running app with Chrome Canary/headless Playwright and reports mounted elements plus browser errors.
- `npm test` runs the Playwright end-to-end suite with `CODEGEN_PROVIDER=mock`.
- `npm run test:e2e:headed` runs the same suite headed.
- Single test: `npx playwright test tests/e2e/jam.performance.spec.js -g "<name>"`.

There is no build step. This is pure ESM JavaScript served from `public/`.

## Read First

`DESIGN.md` is the product and architecture spec. The key runtime idea is a shared spatial canvas where elements are hot-reloadable micro-apps. A single server hosts the UI, Yjs sync, low-latency controller relay, and the browser-visible Codex/Claude PTY terminal.

## Agent Control Plane

When the user has the app open, prefer the HTTP workspace API over devtools snippets, page refreshes, or direct edits to `workspace_layout.json`. The server owns the live Yjs doc and broadcasts these mutations to connected browsers.

- `GET /api/workspace/state` returns elements, clock, and global bus state.
- `GET /api/workspace/elements` returns the current layout list.
- `POST /api/workspace/elements` adds an element.
- `PATCH /api/workspace/elements/:id` edits layout metadata.
- `DELETE /api/workspace/elements/:id` removes an element.
- `POST /api/workspace/elements/:id/reload` re-fetches that element file from disk without codegen.
- `POST /api/workspace/clock` updates `{ bpm, startTime }`.
- `POST /api/workspace/global-bus/:key` writes `{ value }`.

Example for adding a hand-authored element after writing its file:

```bash
npm run jam -- add '{"id":"elem_example","filePath":"/elements/elem_example_visual.js","type":"visual","prompt":"hand-authored visual","authored":"hand","x":420,"y":120,"width":320,"height":220}'
```

Example for pushing an edited element file into the running browser:

```bash
npm run jam -- reload elem_example
```

## Codegen vs Hand-Authored Elements

Elements have an `authored` field:

- `authored: "codegen"` means prompt changes may regenerate and overwrite the element file.
- `authored: "hand"` means the file is the source of truth. `/api/compile` will reuse the file on disk even if a prompt change asks for a forced compile.

When editing a file directly, mark the element as hand-authored before reloading:

```bash
npm run jam -- patch elem_example '{"authored":"hand"}'
```

Do not bump `prompt` as a generic reload trick. Use `/api/workspace/elements/:id/reload`; it changes `reloadToken`, which clients observe as a codegen-free hot reload.

## Architecture Notes

- Host and controller are the same client code. Controllers create normal element graphs but mute `masterGain`.
- `/yjs` syncs the shared `jam-workspace` doc.
- `/controller` relays low-latency controller messages to the host.
- `/agent-terminal` bridges a single shared `node-pty` Codex/Claude session into xterm.js.
- Elements export `default function setup(ctx, prevState)` and are evaluated with `new Function()` after server-side transpilation from ESM default export syntax.
- Hot reload is bar-aligned and crossfaded. State transfers through `runtime.getState()`.
- Element code must connect audio to `ctx.audioOut`, render into `ctx.domRoot`, and publish controller/user state through `ctx.bus.pubGlobal(...)` unless the signal is purely local and high-frequency.

See `public/elements/element-contract.d.ts` and `public/elements/_template_element.js` for the machine-readable contract and a minimal reference element.
