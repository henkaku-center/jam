# CLAUDE.md

Guidance for Claude Code and other coding agents working in this repository.

## Commands

- `npm start` runs the Express/WebSocket server on `PORT` or `3000`.
- `npm run jam -- <command>` calls the live workspace control plane. Start with `npm run jam -- state`.
- `npm run agent -- create <name> [port]` creates an isolated worktree for parallel agent work.
- `npm run agent -- promote <worktree-path> [--commit]` validates and applies a finished worktree diff to the live checkout.
- `npm run agent -- validate [worktree-path] [--full]` runs syntax checks, with `--full` also running Playwright.
- `npm run smoke:live` opens the running app with Chrome Canary/headless Playwright and reports mounted elements plus browser errors.
- `npm test` runs the Playwright end-to-end suite with `CODEGEN_PROVIDER=mock`.
- `npm run test:e2e:headed` runs the same suite headed.
- Single test: `npx playwright test tests/e2e/jam.performance.spec.js -g "<name>"`.

There is no build step. This is pure ESM JavaScript served from `public/`.

Do not scaffold a separate Vite/React/Next app for creative requests. A request for a shader, cube, visualizer, synth, sampler, Strudel window, sequencer, or UI tool means “create or edit a hot-reloaded jam element under `public/elements/`,” then add/reload it through `npm run jam -- ...`.

## Read First

`DESIGN.md` is the product and architecture spec. The key runtime idea is a shared spatial canvas where elements are hot-reloadable micro-apps. A single server hosts the UI, Yjs sync, and browser-visible Codex/Claude PTY terminals.

## Parallel Agent Rule

Do not treat the live checkout as a multiplayer scratchpad. The live server normally runs on port `3000`; browser-connected agents should work in their assigned git worktree with their assigned `PORT` and `JAM_BASE_URL`.

If you need to run the app from an agent worktree, use the `PORT` already in your environment:

```bash
PORT="${PORT:-3001}" npm start
```

Validate in the worktree first, then promote to the live checkout:

```bash
npm run agent -- validate . --full
npm run agent -- promote "$PWD"
```

Promotion is the step that brings code into the live room and triggers hot reload. See `docs/AGENT_WORKTREES.md`.

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

- Every browser runs the same jam client. Clients are muted by default; the audible room feed opts in with `?audio=on`.
- `/yjs` syncs the shared `jam-workspace` doc.
- `/controller` is a legacy low-latency relay.
- `/agent-terminal` bridges one Codex/Claude PTY per browser into xterm.js. By default, each PTY starts in an isolated git worktree under `../jam-agent-worktrees` with its own `PORT`.
- Elements export `default function setup(ctx, prevState)` and are evaluated with `new Function()` after server-side transpilation from ESM default export syntax.
- Hot reload is bar-aligned and crossfaded. State transfers through `runtime.getState()`.
- Element code must connect audio to `ctx.audioOut`, render into `ctx.domRoot`, and publish controller/user state through `ctx.bus.pubGlobal(...)` unless the signal is purely local and high-frequency.
- Strudel-style code belongs inside normal jam elements. Do not add a floating Strudel REPL or app-level generator; use `/elements/strudel_clocked_element.js` or another element that schedules from `ctx.clock.onTick`.
- WebGL/shader code belongs inside normal jam elements. Create a canvas in `ctx.domRoot`, compile shaders in `setup`, draw from `update`, and release buffers/programs/textures in `destroy`. Do not launch a separate shader app or server.

See `public/elements/element-contract.d.ts` and `public/elements/_template_element.js` for the machine-readable contract and a minimal reference element.
