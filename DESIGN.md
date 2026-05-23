# jam — design

A shared 2D world where music and visuals are spatially situated, hot-reloadable, and AI-composable. The map is a collaborative canvas of interactive tools, instruments, and visualizers built on-the-fly.

## Vision

A jam is **a world, not a room**. You drop into a bounded 2D landscape. You see and hear localized pockets of activity — a drum sequencer in the top-left, a generative shader responding to beats, a MIDI-reactive synthesizer, or a custom audio visualizer. You can zoom in to focus and play, zoom out to hear the entire composition, or pan around to find different sections.

*   **Spatial Audio Viewport:** What you hear depends on where you look. Your viewport is your stereo frame. Distance attenuates volume, horizontal offset sets stereo panning, and distant sources are dynamically lowpassed. Two users in the same room hear completely different mixes because they are framing different parts of the map.
*   **A World of Tools, Built Together:** Elements are not just static loops; they are interactive instruments and visualizers. The LLM acts as an agentic toolmaker. If you want to play a synth, you ask the LLM to build you a keyboard interface. Once built, you play it with your MIDI controller or computer keyboard, record sequences, or modulate it with an LFO element running in an adjacent quadrant.
*   **The YOLO Ethos:** This is a high-trust, playful space. Breaking things is part of the fun. We optimize for low latency, rapid iteration, and direct access to Web Audio over strict security boundaries.

## Constraints & Guardrails

- **2-16 participants per room.** Standard Yjs full-doc replication and simple signaling are sufficient.
- **Canvas Boundaries.** Bounded for testing to a standard 1080p workspace (`1920×1080` pixels).
- **No storage, no rewind.** All performances are live and ephemeral. When the last participant leaves, the room's transient state is deleted.
- **Keyboard & Controller-Centric Navigation:** Panning/zooming can be done via mouse (drag and wheel), but also via keyboard (WASD/arrows) and MIDI binds to keep hands free for coding and instrument playing.
- **No Auth / Accounts.** URL hash contains the room ID. Land, jam, leave.

## Core Concepts

### 1. The World
A bounded 2D coordinate space. It holds an array of active **Elements**, a **Signal Bus** for inter-element coordination, and a single shared logical **Global Clock**.

### 2. Elements (Micro-App Contract)
Elements are self-contained visual/audio modules written in pure ES Modules (ESM). Instead of heavy, slow iframes, they run in the main document thread inside isolated **Shadow DOM** containers. This provides perfect CSS style encapsulation and ultra-low latency access to the parent’s `AudioContext` without the overhead, timer throttling, or garbage collection memory leaks of iframes.

*   **Contract:** Every element exports a default `setup` function that can receive optional persistent state from a prior version (during hot-reload or page refresh).
    ```javascript
    export default function setup(ctx, prevState) {
      // ctx: { audioCtx, audioOut, bus, domRoot, clock }
      // clock: { bpm, startTime, onTick(callback) }
      // prevState: Serialized state from previous hot-reloaded instance
      
      let state = {
        frequency: prevState?.frequency || 440,
        ...prevState
      };

      const osc = ctx.audioCtx.createOscillator();
      osc.frequency.setValueAtTime(state.frequency, ctx.audioCtx.currentTime);
      osc.connect(ctx.audioOut);
      osc.start();

      // Bulletproof, leak-proof look-ahead scheduling hook managed by parent:
      // Fires 100ms in advance of every logical 16th note, supplying exact Web Audio timeline target times.
      // This shields the element (and LLMs) from low-level scheduling boilerplate.
      const unsubscribe = ctx.clock.onTick(({ step, time, duration, bpm }) => {
        // Trigger sample-accurate events at 'time'
        if (step % 4 === 0) {
          osc.frequency.setValueAtTime(state.frequency * 1.5, time);
          osc.frequency.exponentialRampToValueAtTime(state.frequency, time + 0.1);
        }
      });

      return {
        update(tick) {
          // Optional: Per-frame visual animation updates
          // Automatically skipped when element is virtualized off-screen
        },
        getState() {
          // Optional: Return serializable state to preserve across hot-reloads
          return state;
        },
        destroy() {
          // Bulletproof cleanup: must disconnect Web Audio nodes,
          // release listeners, and unsubscribe from clock to prevent memory leaks.
          // (Note: Parent also performs safety cleanup of registrations on unload)
          unsubscribe();
          osc.stop();
          osc.disconnect();
        }
      };
    }
    ```

### 3. Spatial Mix & Viewport
Each client maintains a local `AudioContext` and an independent `Viewport` `(x, y, zoom)`. Every animation frame, the parent computes each element's relative spatial mix on its local timeline:
*   **Attenuation:** Full volume inside the visible viewport; rolls off to silent as it moves outside.
*   **Panning:** Mapped to horizontal offset in the current viewport (`-1` far-left, `+1` far-right).
*   **Lowpass:** Optional BiQuad filter frequency decreases as distance increases to simulate muffled air absorption.

### 4. Focus Mode (Local Viewport Soloing)
Holding a hotkey (e.g., `Tab`) activates **Focus Mode** on the client. 
*   All audio-producing elements *outside* the client's current visual viewport are instantly and smoothly muted (`gainNode.gain.setTargetAtTime(0, now, 0.1)`).
*   This is entirely client-side and silent to all other peers. It allows a creator to isolate a specific cluster of instruments to debug, program, or code in isolation without disrupting the shared global jam.

### 5. Level of Detail (Visual Virtualization)
To support dozens of elements on a single canvas, we split **Audio Processing** from **DOM Rendering**:
*   **Continuous Audio:** Web Audio nodes are extremely lightweight. Because elements run in the main window context rather than unmounted iframes, the audio sub-graph for every element continues to process continuously in the background.
*   **Visual Virtualization:** If an element is positioned outside the viewport (plus a 1.5x padding margin), its Shadow DOM container is set to `visibility: hidden` (maintaining its layout and running state but saving GPU render cycles) or translated off-screen, and its `update` loop execution is skipped. This keeps the active render context minimal and prevents browser background timer throttling.

### 6. The Global Nervous System (SignalBus)
To support modular synthesizers and cross-element coordination, elements connect via a shared **SignalBus** split into two tiers under `ctx.bus`:

1.  **Local Bus (High Frequency / In-Memory):**
    High-frequency, in-memory client-side pub/sub for real-time modulation (e.g., LFO values, pitch bend, slider modulations). This is local-only, bypassing the network to prevent congestion.
    *   **Publish:** `ctx.bus.pub("filter_cutoff", 0.8)`
    *   **Subscribe:** `const unsub = ctx.bus.sub("filter_cutoff", (val) => { ... })`
2.  **Global Bus (Low Frequency / State Synced):**
    Synced globally across clients using Yjs and WebRTC data channels for low-frequency state-level triggers and configurations (e.g., sequencer step events, play/stop, pattern changes, global instrument selections).
    *   **Publish:** `ctx.bus.pubGlobal("sequencer_pattern", [1, 0, 0, 1])`
    *   **Subscribe:** `const unsub = ctx.bus.subGlobal("sequencer_pattern", (pattern) => { ... })`

*   **Rule of Thumb for LLMs & Developers:**
    *   If a value updates multiple times per second (e.g., > 5Hz), use local `pub/sub`.
    *   If a value updates only on user interaction, state toggles, or structural changes, use `pubGlobal/subGlobal`.

*   **Hot-Reload De-duplication:** During hot-reload crossfades, the old element is marked as "dying." The parent's SignalBus proxy immediately intercepts and discards all publications and subscriptions from the dying element, preventing double-triggering or parameter-clashing while the audio crossfades.

### 7. Logical Bar-Aligned Hot-Reload & Precise Sync
We align dynamic module loading and musical sequencing to logical ticks using a **Parent-Managed Look-Ahead Scheduler ("A Tale of Two Clocks")** to ensure jitter-free, musical transitions and zero timing-boilerplate for elements:

*   **The Timeline:** The Yjs doc holds `{ bpm, startTime }`. Each client calculates elapsed logical beats:
    $$\text{elapsedBeats} = (\text{Date.now()} - \text{startTime}) \times \frac{\text{bpm}}{60000}$$
    $$\text{currentBar} = \lfloor \text{elapsedBeats} / 4 \rfloor$$
*   **Parent-Managed Scheduler:** The parent client runs a high-precision look-ahead loop (every 25ms checking 100ms ahead) converting synchronized logical beats to local hardware-locked `audioCtx.currentTime`.
    - Instead of elements managing their own timers, the parent broadcasts these target times in advance via `ctx.clock.onTick(({ step, time, duration, bpm }) => { ... })`.
    - This allows elements to schedule Web Audio events sample-accurately and support micro-timings (like swing or shuffle) effortlessly, while the parent automatically cleans up all subscriptions on reload.
*   **Downbeat Hot-Reload Sequence:** When an element's source code is updated:
    1.  The parent retrieves the old element's state via `oldElement.getState()`.
    2.  The parent creates a Blob URL of the new code and dynamically imports it: `import(URL.createObjectURL(blob))`.
    3.  The parent instantiates the new element inside a new Shadow Root, passing the retrieved `prevState`.
    4.  The parent wires up the parallel audio sub-graph with `gain = 0` and attaches the new `onTick` scheduler events.
    5.  The parent schedules a synchronized crossfade exactly on the **downbeat of the next bar** on the sample-accurate Web Audio timeline:
        $$\text{targetTime} = \text{localAudioCtxStartTime} + ((\text{currentBar} + 1) \times 4 \times \frac{60}{\text{bpm}})$$
    6.  At `targetTime`, the old element's gain is ramped to 0 and the new element's gain is ramped to 1. This downbeat transition is perceived as a natural musical "drop," completely hiding phase jumps without complex state transfer.
    7.  Once the crossfade finishes, the old element's `destroy()` is called (fully disconnecting its audio nodes, clearing listeners, and unsubscribing from ticks), its Shadow DOM wrapper is removed, and its Blob URL is revoked with `URL.revokeObjectURL(url)`.

## System Architecture

```
                       [ Yjs Shared Doc ]
                               │
            ┌──────────────────┼──────────────────┐
            ▼                  ▼                  ▼
      [ elements ]         [ clock ]        [ SignalBus ]
   Y.Map<id, Element>   { bpm, startTime }   Y.Map<name, val>
            │                                     │
            └──────────┬──────────────────────────┘
                       │ (Syncs over y-webrtc / y-websocket)
                       ▼
               [ Client Parent ]
         ┌─────────────┴─────────────┐
         ▼                           ▼
  [ AudioContext ]            [ Canvas / Viewport ]
  ├── Master Out              ├── Camera: (x, y, zoom)
  └── Sub-graphs (per-elem)   ├── Keyboard/Mouse Controller
       Gain ───────┐          ├── Focus Mode Muter (Tab)
       Panner ─────┼──────────┤
       Lowpass ────┘          └── Visually Virtualized Elements
                                    │
                         ┌──────────┴──────────┐ (Dynamic ESM)
                         ▼                     ▼
                   [ Element 1 ]         [ Element 2 ]
                    (Shadow DOM)          (Shadow DOM)
```

### Sandbox & Execution Safety

Because we embrace the YOLO space, we use simple, high-performance isolation:
*   The parent wraps element setup, tick updates, and event callbacks in `try/catch` blocks.
*   If an element throws a runtime error, the parent intercepts it, freezes its visual update loop, and overlay-displays the console error on that specific element on the canvas while leaving other elements untouched.
*   **Latest Stable Fallback Recovery:** The parent retains a cache of the last successfully initialized and error-free ESM code blob for each element. If a newly hot-reloaded code version fails during `setup()` or throws errors in its first few execution frames, the parent automatically and gracefully rolls back to the previous stable version. This ensures that a single buggy change or syntax slip never permanently breaks the live performance for other users.
*   More robust thread-isolated sandboxing (such as offscreen canvas in Web Workers) is deferred for post-PoC development.

---

## MVP Scope

The core objective of the MVP is to prove the viability of **a spatial 2D world where dynamically loaded, modular Shadow DOM elements can be hot-reloaded seamlessly on beat boundaries and interact via a shared Signal Bus**.

### IN (MVP Scope)
1.  **Spatial 2D Canvas:** Viewport navigation via mouse drag/wheel and keyboard arrow/WASD keys on a fixed 1080p canvas.
2.  **Element Portability:** Elements are draggable by default, and resizable if explicitly requested.
3.  **Modular Shadow DOM Elements:** Direct Shadow DOM mounting utilizing ESM Blob URL dynamic imports with full support for CDN imports (e.g. `esm.sh`).
4.  **Basic Spatial Mix:** Distance-based volume attenuation, stereo panning, and lowpass filter.
5.  **Local Focus Mode:** Hold `Tab` to mute everything outside the current viewport.
6.  **Two-Tier Signal Bus:** High-frequency local pub/sub combined with low-frequency global state sync over Yjs.
7.  **Bar-Aligned Hot-Reload:** Look-ahead scheduler combining global beats with sample-accurate Web Audio timelines to perform gain-ramped crossfades.
8.  **In-Memory State Preservation:** Contract utilizing `setup(ctx, prevState)` and `getState()` to transfer state seamlessly on hot-reload.
9.  **LLM Integration & Prompt Injection:** Prompt bar that transmits instructions to the model along with a context injection describing the current canvas elements and active SignalBus keys. The model outputs clean ES Modules and pushes back on ambiguous targeting requests.

### OUT (Deferred)
- Multi-room routing and room discovery.
- Persistent database storage (ephemerality matches design).
- Advanced sandbox boundaries / off-main-thread Web Workers.
- Sophisticated collaborative mouse pointers / presence avatars.

---

## Build Order

1.  **Visual Canvas & Viewport Navigation:** Render a subtle reference coordinate grid. Implement smooth WASD/arrow keyboard panning and mouse drag/wheel zoom. Make elements draggable by default.
2.  **Static Element Rendering & Virtualization:** Place 4 dummy visual elements inside Shadow Roots on the canvas. Implement the Visual Level-of-Detail (LOD) system—marking elements off-screen with `visibility: hidden` and skipping their `update` loop execution.
3.  **Spatial Audio Sub-graphs & Look-Ahead Scheduler:** Wire a continuous synthesizer loop to each element. Implement the spatial coordinate formulas updating gain, pan, and filter frequency. Establish the look-ahead scheduler converting logical beats to local `audioCtx.currentTime`.
4.  **Signal Bus Integration:** Enable a simple LFO element to publish a value, and a visual element to subscribe and animate. Implement de-duplication flags for "dying" elements during reload.
5.  **Yjs Synchronization:** Integrate `y-webrtc` (or stable signaling). Synchronize element coordinates, Signal Bus events, and the logical clock across multiple browser tabs.
6.  **Blob URL dynamic imports & Hot-Reload Crossfades:** Implement dynamic ESM imports. Combine the look-ahead scheduler, `getState()`, and `setup(ctx, prevState)` to trigger seamless gain-ramped crossfades at the next bar boundary.
7.  **LLM Toolmaker Prompt Integration:** Build the prompt panel. Connect it to the LLM agent, configuring it to receive canvas state injections, output clean ESM modules, and push back on ambiguous targeting requests.
