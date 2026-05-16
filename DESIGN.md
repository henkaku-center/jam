# jam — design

The current `src/` is the v0 prototype. This document is the v1 design: a deliberate pivot from "multi-pane livecoding workspace" to "shared 2D world where music and visuals are spatially situated, hot-reloadable, and AI-composable." Music + visuals are still the point. Everything else here is in service of making the jam feel like a place rather than an IDE.

## Vision

A jam is **a world, not a room**. You open the URL and drop into an ongoing performance that's been continuously happening. You hear what's there. You see a bounded 2D landscape of activity — a corner full of dancing visuals, a region with piled-up UI controllers, a Pong game someone claimed, a cluster of beatboxer waveforms, a section where someone's MIDI keyboard is drawing live melody. You can zoom in to contribute, zoom out to take in the whole composition. You can also just spectate; the transition between watching and contributing is invisible.

Crucially: **what you hear depends on where you're looking.** Your viewport is the instrument. Pan across the world and the mix changes, sources entering and leaving your stereo field. Zoom in tight on the beatbox corner and you hear it mono and loud. Zoom out and the whole map plays at once, panned left-to-right across the stereo image. *Two users in the same room hear different mixes* because they're framing different parts of the world.

Factions and sub-cultures emerge spatially. The electronic-leaning users cluster in one quadrant; the acoustic faction takes another; cross-pollinators work the border. There is no moderator, no curator, no genre tag — only proximity and visible activity.

## Constraints (what we're not doing)

These are deliberate guardrails. Each one collapses a category of complexity.

- **2-16 participants per jam.** Small group. Not r/place. Yjs full-doc replication is fine at this size; one tiny server-per-room is enough.
- **Bounded world, sized to player count.** Age-of-Empires logic — small map for 2 players, big map for 16. ~4096×4096 units feels right as a default; tunable. Not infinite.
- **No rewind, no replay, no time travel.** All live. The system does not help you record, scrub, export, or commodify. When the last person leaves, the room is gone. Ephemeral is a value, not a limitation.
- **No product framing.** Niche audience, passionate users, livecoding/art ethos. We are not building Bolt-for-music. We are not chasing a market.
- **No identity / accounts / auth.** URL is the room. Walk in, jam, leave. Same as today.

## Core concepts (the new vocabulary)

**World.** A bounded 2D map. Coordinates are integers in `[0, mapSize)`. The world holds elements and a single shared global clock.

**Element.** A positioned, sized, self-contained bundle of HTML+CSS+JS that can produce sound, visuals, or interactivity. An element is the new "pane" — but generalized. A drum loop, a synth keyboard UI, a Hydra canvas, a Pong game, a particle system, a markdown note, a video player, a chat bubble, a custom shader — all are elements, all the same primitive. Anyone (human or LLM) can create one.

**Viewport.** Each user's independent camera onto the world: `(camX, camY, zoom)`. Pan with drag, zoom with wheel. Not shared across peers — each user navigates freely.

**Spatial mix.** Each user's local audio output is a per-frame computed mix of all audio-producing elements in the world, weighted by their position relative to the viewport. Distance attenuates volume; horizontal offset sets stereo pan; far things may be lowpassed for "muffled" depth.

**Sub-graph.** The per-element chain of Web Audio nodes (`Gain → StereoPanner → BiquadFilter(lowpass) → master`) that sits between the element's sound output and the user's speakers. The parent updates these nodes' values every animation frame based on element position vs. viewport. The element itself doesn't know about distance or pan — it just emits.

**Global clock.** A single shared `{ bpm, startTime }` lives in the Yjs doc. All elements receive it on init and align their playback to it. Tempo is shared across the world (per-region tempo is not v1).

**Crossfade hot-reload.** When an element's source changes, the old instance keeps playing while the new instance starts in parallel. On the next bar boundary, gain ramps from old→new over 1-2 bars, then the old instance is destroyed. Sample-accurate via `gain.linearRampToValueAtTime`. The music never pauses; the visual fades synchronously. This is **the load-bearing technical idea** — if it works, the rest is straightforward.

## Architecture

```
Yjs doc per room
  ├── elements: Y.Map<id, ElementState>
  │     └── { x, y, w, h, js, version }
  ├── clock: Y.Map<string, any>
  │     └── { bpm, startTime }
  └── awareness (Y.Awareness)
        └── { userId, name, color,
              cursor: { elementId, x, y },
              selection: { elementId, from, to } }

Transport:
  - y-websocket (small Node server, single-process, one Yjs doc per room)
  - In-memory state; no persistence across server restart (matches ephemerality)
  - WebRTC fallback considered but not v1 — keep it simple

Client (parent page):
  - Owns the AudioContext + global clock
  - Owns the camera
  - Hosts one sandboxed iframe per element (same-origin sandbox, see Risks)
  - Maintains a per-element audio sub-graph in the parent's AudioContext
  - Every animation frame: updates each sub-graph based on viewport
  - On Yjs change to element.js: triggers crossfade

Element (inside iframe):
  - Receives a ctx = { audio, audioOut, clock, root } from parent on mount
  - Connects its sound to ctx.audioOut (the Gain node in parent's sub-graph)
  - Renders visuals into ctx.root
  - Returns { destroy() } so parent can cleanly tear it down after crossfade
```

### Spatial audio model

For each element, on each animation frame:

```
gain.value     = viewportRelativeAttenuation(elementPos, camera, viewport)
pan.value      = horizontalOffsetInViewport(elementPos.x, camera.x, zoom)
filter.freq    = lowpassFromDistance(distance)
```

Where:
- **viewportRelativeAttenuation:** inside the viewport → full volume; one viewport-width outside → ~30%; many viewport-widths away → silent. As the user zooms out, the viewport grows, so more elements end up "inside" and play at full. At maximum zoom-out the whole map plays at full mix — by design.
- **horizontalOffsetInViewport:** element's x-position within the visible frame maps to stereo pan (-1 left, +1 right, 0 center). Works at all zoom levels — even fully zoomed out you hear a wide stereo image of the whole map laid out left-to-right.
- **lowpassFromDistance:** optional, makes distant things sound muffled instead of just quieter. One `BiquadFilterNode` per source. Cheap.

### Element lifecycle

```js
// element module shape
export default function (ctx) {
  // ctx = { audio: AudioContext, audioOut: GainNode,
  //         clock: { bpm, startTime, nextBar() },
  //         root: HTMLElement }

  const osc = ctx.audio.createOscillator()
  osc.frequency.value = 220
  osc.connect(ctx.audioOut)
  osc.start(ctx.clock.nextBar())   // align to next downbeat

  return {
    destroy() { osc.stop(); osc.disconnect() }
  }
}
```

The element doesn't know about distance, pan, viewport, or other elements. It receives a clock, an audio output bus, and a DOM root. It produces audio and visuals. It cleans up on `destroy()`. That's the entire contract.

### Crossfade procedure (the validation milestone)

When Yjs reports `elements[id].js` has changed:

1. Keep the old instance running. Do not destroy it yet.
2. Construct a second sub-graph for the same `id`. Mount the new element into it with `gain = 0`.
3. Wait for the next bar boundary from the global clock so both instances are downbeat-aligned.
4. Ramp old gain `1 → 0` and new gain `0 → 1` over 1-2 bars using `gain.linearRampToValueAtTime`. Sample-accurate; no clicks.
5. At ramp end, call old instance's `destroy()` and free its sub-graph.

Visual mirror: keep the old iframe rendering, mount the new one on top, ramp opacity 0→1 over the same duration, remove the old. Visuals and audio fade synchronously.

This is **Punctual's `<>` crossfade semantics applied at the element level instead of the language level** — one of the most useful patterns surfaced in the prior-art research, finally landing somewhere concrete. The cost is temporarily doubling that element's audio cost for 1-2 bars; well inside Web Audio's budget for 16 simultaneous reloads.

### LLM integration

The LLM is a first-class creation tool, not a separate "prompt pane" type.

- A simple prompt input (fixed UI bar at the bottom of the screen, not yet itself an element).
- User can click an element to select it before prompting → LLM operates on that element's source. Empty selection → LLM creates a new element at the click position (or default position).
- LLM returns a full element source bundle (a JS module exporting `default function (ctx) { ... }`).
- Client inserts/replaces in the Yjs doc.
- Crossfade fires automatically on the Yjs change observer.
- Both A and B's browsers experience the same seamless transition.

The LLM is *not* a special peer. Its edits flow through the same Yjs update channel any human edit would. ("Agent is invisible plumbing" — falls out of the architecture, not enforced by convention.)

## MVP scope

The MVP exists to validate one thing: **can two browsers experience a seamless audio+visual element swap, driven by an LLM prompt, without interrupting the music?** Everything else is deferred until that works.

### In

- Bounded 4096×4096 world, mouse wheel zoom, drag-to-pan, independent viewport per user
- 4 hardcoded seed elements at fixed positions, each looping one simple pattern
- Per-element spatial audio sub-graph with viewport-relative falloff (volume, pan, optional lowpass)
- Single global clock (`{ bpm, startTime }`) in the Yjs doc
- y-websocket server (small Node process) + Yjs doc per room
- One LLM prompt input bar (fixed UI, single textarea + send)
- LLM returns element source → insert/replace in Yjs doc
- Crossfade triggered on every element-source change, bar-aligned
- Two browsers experience identical seamless transitions

### Out (deferred)

- Cursors / selections / peer presence (cosmetic, add after MVP works)
- Manual code editing of elements (LLM is the only authoring path for MVP)
- Persistence across server restart (in-memory only, matches ephemerality)
- Inter-element signal bus (each element is self-contained for now; revive bus later for synth-button-drives-synth scenarios)
- Sampler / MIDI / mic / Hydra-specific element types (those become element templates later)
- NES UI chrome / styling (functional only for MVP)
- Multi-room logic, room discovery, auth
- OSC bridge to Sonic Pi / Tidal / SuperCollider (later — small, high-leverage)
- Verify-before-merge for LLM-authored elements (later — sandbox the new element offscreen, smoke-test, only then crossfade)

### Build order

1. **Spatial canvas + 4 static elements, no audio.** Verify zoom/pan feels right.
2. **Wire each element's hardcoded audio into a per-element sub-graph.** All four play together at fixed volume.
3. **Implement viewport-relative falloff in the animation-frame loop.** Pan around; verify the mix changes naturally.
4. **Single Node y-websocket server, two browsers, same doc.** Verify positions sync.
5. **Crossfade triggered manually via devtools.** Change an element's source from the console; confirm no audible interruption. **This is the validation milestone.**
6. **LLM prompt integration.** Once the crossfade is solid, plug in prompt → element source → Yjs insert.

## Risks

1. **Same-origin sandboxed iframes** let elements share the parent's `AudioContext` directly (zero latency). But same-origin means a buggy or malicious element's JS can in principle reach into the parent. Acceptable for an MVP run by trusted testers. Future hardening = `MediaStreamAudioDestinationNode` bridge with ~50ms latency, or Web Worker / AudioWorklet isolation.
2. **LLM round-trip latency** is 2-10s. The crossfade itself is seamless, but the *wait* between prompt and music change is felt. Stream the response, show progress.
3. **Tempo sync for new elements.** They must start on a bar boundary. Each element gets `clock.nextBar()` on init and uses `osc.start(nextBar)`. Strudel patterns can be evaluated immediately but scheduled to start at the next cycle.
4. **Element targeting from prompts.** "Replace this with funkier bass" needs the LLM to know which element you meant. MVP answer: click selects, prompt operates on selection.
5. **Performance ceiling for many iframes.** Each iframe is a JS realm + render context. ~50 elements is fine; ~500 is not. Element count cap implicit in map size + 16-player constraint.

## Open questions (decide before or during build)

- Map dimensions: 4096×4096 is a placeholder. Scale with `mapSize = 1024 + 256 * playerCount`?
- Falloff curve shape: linear ramp from full-volume-inside-viewport to silent-one-viewport-out, or something with a steeper edge?
- Bar length for crossfade: 1 bar feels punchy, 2 bars feels musical, 4 bars feels ambient. Default 2, expose later.
- Does the LLM see *all* element source in the doc as context, or only the selected one? Full context is more powerful but expensive on tokens.
- Visual styling: is the world a flat color, a grid, an image, generative? Probably a subtle grid for spatial reference.

## What's deliberately out of scope (and why)

- **R/place-scale architecture, MMO area-of-interest sharding, lazy hydration by viewport.** The 2-16-player constraint makes these unnecessary. Full-doc Yjs replication just works.
- **Op-log + snapshots for time travel.** No rewind is a design value. Current state is the only state.
- **OT (operational transformation).** Yjs CRDTs are the right pick; OT is legacy.
- **Croquet-style reflector for deterministic replay.** Replay isn't a goal. Time-deterministic audio scheduling across peers is interesting but a v2 question; for MVP, "everyone applies Yjs changes as they arrive" + crossfade absorbs the small latency.
- **Pure P2P (current y-webrtc setup).** Breaks cross-machine sync, breaks persistence, makes server-side LLM participation impossible. Replaced by y-websocket.
- **A central, opinionated taxonomy of pane types.** Elements are general; templates provide opinionation. A starter room seeds 4 musical elements so the affordances feel musical, but the substrate is general.

## Lineage (where ideas came from)

The MVP draws explicitly from research into prior livecoding tools and adjacent collaboration architectures:

- **Flok** (codeberg.org/munshkr/flok) — Yjs over y-websocket as the sync layer, central server holds the doc, per-runtime iframe sandboxing to avoid global collisions. Direct architectural ancestor.
- **Ravioli** (codeberg.org/hardpasta/ravioli) — "there is only one document" + spatial layout as metadata. Inspired the "world, not workspace" framing, though we use positioned elements rather than ASCII flood-fill.
- **Punctual** (David Ogborn) — the `<>` crossfade-on-cycle-boundary as a language feature. Lifted to the element level as the hot-reload mechanism.
- **Sonic Pi** — `live_loop` name-indirection (redefine a running loop without stopping it) and `cue`/`sync` as a blocking event bus. Patterns to revisit when we restore inter-element messaging.
- **Figma** — per-property LWW CRDT, server is dumb relay, no merge logic on server. Validates the "elements as objects with typed cells" model.
- **Linear** — "not everything needs a CRDT." Strongly-typed objects + LWW is enough for most state; reserve true CRDT for the editor text buffer.
- **Croquet** — reflector model for deterministic-replay multiplayer. Considered, deferred — not needed at 16-player scale with no replay requirement.
- **Game audio** (Wwise / FMOD / Minecraft positional Note Blocks / Halo zone music) — spatial audio mixing patterns translated to viewport-relative attenuation + stereo pan.
- **r/place, MMO area-of-interest management** — surveyed, mostly rejected as overkill at our scale. The "factions emerge from spatial proximity" social dynamic is the part we keep.
