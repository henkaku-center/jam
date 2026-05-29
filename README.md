# jam

A live-coding music room where the stage is a shared 2D canvas.

Jam is built for people in the same physical room, on the same Wi-Fi, making sound and visuals together. One laptop feeds the speakers and projector. Everyone else joins from their own machine, edits the same spatial canvas, and asks coding agents to build instruments, Strudel pattern windows, MIDI tools, samplers, shaders, and visualizers that hot-reload into the performance.

It is not a normal web app. It is closer to a tiny collaborative venue that happens to run in Chrome.

## What It Feels Like

- A spatial Ableton-meets-browser-canvas where instruments live at coordinates.
- A local jam server that keeps one shared source of truth with Yjs.
- A transparent Codex/Claude terminal sitting over the canvas, ready to modify the room.
- Elements that are real files in `public/elements/`, hot-reloaded on the beat.
- Strudel-style pattern code as canvas elements, not as a separate panel app.
- One audible host machine, with everyone else muted by default but still fully synced.

## Quick Start

```bash
npm install
npm start
```

Open the room:

```text
http://localhost:3000
```

The host machine connected to speakers should opt into audio:

```text
http://localhost:3000/?audio=on
```

Collaborators on the same Wi-Fi join from their laptops using the host machine's LAN address:

```text
http://<host-ip>:3000
```

Collaborator clients are muted by default, but they still run the same Web Audio graphs and see the same shared canvas.

## The Big Rule

If you are adding a synth, visualizer, sampler, sequencer, shader, Strudel window, MIDI controller, or tiny UI tool, build it as a jam element.

Do not create a new Vite app. Do not start a side server. Do not build a floating app on port 3006.

Create or edit one file under:

```text
public/elements/
```

Each element exports:

```js
export default function setup(ctx, prevState) {
  // Render only into ctx.domRoot.
  // Connect audio only to ctx.audioOut.
  // Use ctx.clock.onTick for beat-aligned scheduling.
  // Use ctx.bus for local/global element communication.

  return {
    update(tick) {},
    getState() {
      return {};
    },
    destroy() {
      // Stop timers, remove listeners, disconnect audio, release WebGL.
    }
  };
}
```

See [AGENTS.md](AGENTS.md) for the full contract.

## Useful Commands

Inspect the live room:

```bash
npm run jam -- state
npm run jam -- elements
```

Add an element:

```bash
npm run jam -- add '{"id":"elem_example","filePath":"/elements/elem_example_visual.js","type":"visual","prompt":"hand-authored visual","authored":"hand","x":420,"y":120,"width":320,"height":220}'
```

Reload an element after editing its file:

```bash
npm run jam -- reload elem_example
```

Change the shared clock:

```bash
npm run jam -- clock '{"bpm":92}'
```

Run validation:

```bash
npm run validate:quick
npm run validate:full
```

## Agent Workflow

Jam is designed for multiple coding agents working in parallel without trampling the live room.

Create an isolated worktree:

```bash
npm run agent -- create alice 3001
```

Validate it:

```bash
npm run agent -- validate ../jam-agent-worktrees/alice
```

Promote ready changes into the live room:

```bash
npm run agent -- promote ../jam-agent-worktrees/alice --commit
```

Promotion applies the diff to the main checkout, validates it, hot-reloads changed live elements when possible, and can commit the change with provenance.

## How Audio Works

Every browser runs the same element code and a real `AudioContext`.

- Normal mode uses a global mix, so panning and zooming around the canvas does not change the sound.
- Focus mode makes the viewport spatial: elements inside the view stay present, while distant elements pan, filter, and fall away.
- Only clients opened with `?audio=on` are audible. Other clients are silent at the master output.

This keeps local jams from turning into a multi-laptop phasing problem while preserving symmetric collaboration.

## Strudel

Strudel support lives inside jam elements. Pattern windows start blank, evaluate only when the user asks them to, and route audio through the same element audio graph as everything else.

Multiple Strudel elements should behave independently. If one pattern gets weird, stop or delete that element rather than silencing the whole room.

## Project Map

```text
server.js                 Local jam server, WebSocket/Yjs state, compile endpoints
public/client.js          Shared browser client and spatial canvas runtime
public/elements/          Hot-reloadable instruments, tools, shaders, visualizers
public/strudel-runtime.js Strudel integration helpers
scripts/jamctl.mjs        CLI for inspecting and mutating the live room
scripts/agent-worktree.mjs Parallel agent worktree workflow
tests/e2e/                Playwright integration and performance checks
sessions/                 Archived jam agent logs
DESIGN.md                 Long-form system design
AGENTS.md                 Required instructions for coding agents
```

## Status

This is an experimental live-performance system. It is intentionally high-trust and local-first: great for a room full of collaborators, not hardened for arbitrary public internet traffic.

The current goal is to make the loop fast and musical:

1. Ask for a thing.
2. The agent writes an element.
3. The room hot-reloads it.
4. Everyone hears or sees it in the same shared jam.

Breakage is expected. Recovery, hot reload, validation, and session logs are part of the instrument.
