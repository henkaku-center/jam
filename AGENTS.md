# AGENTS.md

Guidance for Codex and other coding agents working in this repository.

## Runtime Model

Jam is not a standalone web-app scaffold. It is a live collaborative spatial canvas. The server on port `3000` owns the shared Yjs workspace, serves `public/`, and hot-reloads element files from `public/elements/`.

When a user asks for a synth, visualizer, shader, Strudel window, sampler, sequencer, or UI tool, implement it as a jam element:

1. Write or edit one file under `public/elements/`.
2. Export `default function setup(ctx, prevState)` or `default async function setup(ctx, prevState)`.
3. Render only into `ctx.domRoot`.
4. Connect audio only to `ctx.audioOut`.
5. Return `destroy()` that stops timers, unsubscribes, removes listeners, disconnects audio, and releases WebGL resources.
6. Add or reload the element through `npm run jam -- ...`.

Do not create a Vite/React/Next app, do not edit `public/index.html` for element-specific work, and do not start an unrelated server. If you need to run this repo from an isolated worktree, use the assigned `PORT` environment variable.

## Live Workspace Commands

- `npm run jam -- state`
- `npm run jam -- elements`
- `npm run jam -- add '{"id":"elem_example","filePath":"/elements/elem_example_visual.js","type":"visual","prompt":"hand-authored visual","authored":"hand","x":420,"y":120,"width":320,"height":220}'`
- `npm run jam -- patch elem_example '{"authored":"hand"}'`
- `npm run jam -- reload elem_example`
- `npm run agent -- validate .`
- `npm run agent -- promote "$PWD"`

Promotion is the step that brings isolated worktree changes into the live room and triggers reload.

## Element Contract

```js
export default function setup(ctx, prevState) {
  // ctx.domRoot: Shadow DOM container for this element only.
  // ctx.audioCtx: browser AudioContext.
  // ctx.audioOut: parent spatial mix node; all audio must connect here.
  // ctx.clock.onTick(callback): beat-aligned scheduling.
  // ctx.bus.pub/sub: local high-frequency signals.
  // ctx.bus.pubGlobal/subGlobal: shared state and user controls.

  return {
    update(tick) {},
    getState() {
      return {};
    },
    destroy() {}
  };
}
```

For WebGL/shader work, create a canvas inside the element, compile shaders in `setup`, draw from `update`, and delete buffers/programs/textures in `destroy`. Shader work should never become a separate app or a new dev server.
