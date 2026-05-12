# jam

A web-based collaborative live-coding environment for computational art (sound, visuals, interactivity). Multi-modal: code, natural language, and UI widgets are peer ways to contribute. URL hash is the room; many participants jam concurrently.

Repo: github.com/gszep/jam.

## North stars (do not violate)

1. **Never pause the music.** Bad code in any pane must not stop the room. Last-good output keeps running; errors render inline in the pane that broke.
2. **Walking in is free.** Open the URL → see + hear what's there → start contributing. No signup, no password, no setup.
3. **Three peer modalities.** Code panes (Hydra/Strudel), prompt panes (natural language → bus events / patches), widget panes (sliders/buttons/XY pads). All addable by anyone. All publish/subscribe to the **signal bus**.
4. **Agent is invisible plumbing, not a performer.** Agents reshape the *environment* (helpers, effects, new widget kinds, new editor features) and verify before going live. They do NOT have their own pane and do NOT take solos.
5. **Aesthetic: early computer games (NES).** Chunky pixels, beveled buttons, palette colors, customizable. Not minimalist IDE chic.

## Architecture

```
┌─ Stage (always on, last-good wins) ──────────────────────────┐
│   Hydra canvas  ←──┐               ┌──→ Strudel audio        │
│                    │               │                         │
│             evalVisual()    evalAudio()                      │
└────────────────────────────┬─────────────────────────────────┘
                             │
                  ┌──────────┴───────────┐
                  │   Signal Bus         │  ← Y.Map<string, number>
                  │   pub/sub by name    │     synced across peers
                  └──────────┬───────────┘
        ┌────────────────────┼──────────────────────┐
        ▼                    ▼                      ▼
   Code pane            Widget pane            Prompt pane
   (CodeMirror,         (slider/button/        (NL → intent →
   per-pane eval)        XY, NES-skinned)       bus / eval / spawn)
```

- **Sync**: Yjs over WebRTC via `y-webrtc` (public signaling: `signaling.yjs.dev`). URL hash = room name.
- **Awareness**: `y-protocols/awareness` carries user name + color; rendered as presence chips.
- **Panes**: `Y.Map` of `Y.Map` keyed by id. Each pane's data lives in a sub-map. Deletion uses a `_deleted: true` tombstone (don't hard-delete from the outer map or remote peers re-mount).
- **Bus**: just a `Y.Map<string, number>`. Anything can `set(name, value)` or `pulse(name)`. Hydra reads via `b('name')` exposed on `window`.

## File layout

```
src/
  main.ts          — wires everything; creates panes; presence; bus HUD; seed timer
  stage.ts         — Hydra + Strudel init; evalVisual / evalAudio with error isolation
  bus.ts           — SignalBus (pub/sub over Y.Map<number>)
  sync.ts          — y-webrtc setup; random user identity stored in localStorage
  styles.css       — NES skin + pane chrome (uses nes.css + 'Press Start 2P')
  shims.d.ts       — declare modules for untyped deps (hydra-synth, @strudel/*)
  panes/
    base.ts        — shared pane DOM (header, drag, close) + status helper
    code.ts        — CodeMirror pane bound to Y.Text via y-codemirror.next; audio/visual toggle
    widget.ts      — slider/button/xy widget; signal name + value live in Y.Map
    prompt.ts      — stub agent: regex → intent (set/pulse/visual/audio); writes to bus or evals
index.html, vite.config.ts, tsconfig.json, package.json
```

## Dev workflow

```
npm install
npm run dev    # terminal 1: http://localhost:5173
npm run sync   # terminal 2: auto-commit + push on file changes
```

## Git auto-sync

Two developers work on `main` simultaneously. Changes sync automatically:
- `npm run sync` watches `src/` and root config files, debounces 2s, then auto-commits and pushes.
- Claude Code's `PreToolUse` hook auto-pulls before each Edit/Write/Bash via `scripts/pull.sh`.
- Vite HMR picks up incoming file changes on disk automatically.

If you see git conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`) in any file,
resolve them immediately by keeping the best version of both changes, then save.
The sync watcher will auto-commit your resolution. Never force-push on main.

- Audio is gated behind the START AUDIO button (browser autoplay rule — *real* user click required; programmatic clicks don't unblock the AudioContext).
- Open the same `#room-name` in another tab to test multi-user.
- A seed timer (`main.ts` ~line 100) creates 3 starter panes if the room is empty after 1.5s — y-webrtc's `synced` event doesn't fire without peers, so a wall-clock fallback is required.

## Gotchas (learned the hard way)

1. **Hydra needs a `global` polyfill in Vite.** `hydra-synth` (via `right-now` / `raf-loop`) references `global`. In `vite.config.ts`: `define: { global: 'globalThis' }` *and* `optimizeDeps.esbuildOptions.define.global = 'globalThis'` (the second covers the pre-bundled `.vite/deps` cache). Clear `node_modules/.vite` after changing this.
2. **Strudel `getTime` callback.** Use `getAudioContext().currentTime` imported from `@strudel/webaudio`. Do NOT try to call `scheduler.getAudioContext()` — that method doesn't exist on the scheduler.
3. **PaneKind vs WidgetKind collision.** Don't reuse the key `'kind'` for both `PaneKind` ('code'|'prompt'|'widget') and the widget sub-shape. The widget pane stores its shape under `'shape'` (slider|button|xy).
4. **Hydra/Strudel global collision.** Hydra is initialized with `makeGlobal: true`, so `osc`, `noise`, `shape`, `src`, `o0..o3`, `speed`, `bpm`, `fps`, etc. live on `window`. Strudel's `evalScope` overwrites many of those names. If you call `evalScope` after Hydra init without protection, Hydra's render loop dies silently (next `tick()` reads a Strudel `speed` instead of the Hydra one). The current fix in `stage.ts` snapshots Hydra's globals before `evalScope` and re-applies them after. Any new audio module that calls `evalScope`/`evalContext` must do the same dance.
5. **Eval globals leak to `window`.** Beyond the Hydra/Strudel set, the bus helper `b(name)` is also `window`-scoped. Be careful adding more globals — name collisions will surprise users.
6. **y-webrtc has no persistence.** A reload with no peers gives you a fresh empty doc. Add `y-indexeddb` for local persistence if needed.
7. **Audio gesture gate.** Strudel's `initAudioOnFirstClick` waits for *any* real user click and is finicky with programmatic clicks; prefer `initAudio()` followed by `getAudioContext().resume()` triggered from the START AUDIO button. Audio starts on the first click that way (not the second).

## v0 status

What works:
- Three pane types, drag, per-pane eval, last-good error semantics.
- Bus: slider → bus → Hydra (`b('knob')`); prompt → bus; prompt → visual/audio recipes.
- Multi-user sync via y-webrtc; presence chips; URL-as-room.
- NES skin throughout.

What's stubbed / missing:
- **Prompt agent is regex-based.** Real LLM endpoint with intent classification is v2.
- **Verify-before-merge** (agent stages a patch, smoke-tests in sandbox, promotes to live room) — not built. This is the architectural differentiator vs. Flok and the main thing to tackle next.
- **No pane resize.** Drag works, resize doesn't.
- **No persistence.** Refresh = empty room (unless a peer keeps state).
- **No editor IDE affordances yet.** v0 has plain CodeMirror; the feel-doc calls for autocomplete + hover docs + jump-to-def for Hydra/Strudel APIs. v1 task.

## Roadmap (in priority order)

1. **Modern editor feel**: autocomplete, hover docs, inline error suggestions for Hydra and Strudel APIs (CodeMirror 6 hooks).
2. **Agent verify-before-merge**: `/agent/propose` endpoint or local hook; offscreen-iframe smoke test; promote on clean.
3. **More widget kinds**: piano-roll, drum pad, color picker.
4. **Persistence**: `y-indexeddb` so refresh doesn't wipe the room.
5. **Customizable theming** of widgets (per the original vision — "early computer games" is current; users should be able to swap palettes).

## Working on this repo

- **No worktrees, no hidden folders in the repo.** Work directly in `/Users/vanbalen/__robot` on `main`. The `.claude/` directory is gitignored.
- **Boring stack**: TypeScript, Vite, CodeMirror 6, Yjs, nes.css. Don't introduce a framework (React/Vue/etc.) for the prototype.
- **Don't add features the task didn't ask for.** Especially: don't add error handling that swallows real bugs (the v0 audio bug hid behind a try/catch that just logged).
