# jam — design

A shared 2D world where music and visuals are spatially situated, hot-reloadable, and AI-composable. The map is a collaborative canvas of interactive tools, instruments, and visualizers built on-the-fly.

## Vision

A jam is **a world, not a room**. You drop into a bounded, ongoing 2D landscape. You see and hear localized pockets of activity — a drum sequencer in the top-left, a generative shader responding to beats, a MIDI-reactive synthesizer, or a custom audio visualizer. You can zoom in to focus and play, zoom out to hear the entire composition, or pan around to find different sections.

*   **Spatial Audio Viewport:** What you hear depends on where you look. Your viewport is your stereo frame. Distance attenuates volume, horizontal offset sets stereo panning, and distant sources are dynamically lowpassed. Two users in the same room hear completely different mixes because they are framing different parts of the map.
*   **A World of Tools, Built Together:** Elements are not just static loops; they are interactive instruments and visualizers. The LLM acts as an agentic toolmaker. If you want to play a synth, you ask the LLM to build you a keyboard interface. Once built, you play it with your MIDI controller or computer keyboard, record sequences, or modulate it with an LFO element running in an adjacent grid quadrant.
*   **The YOLO Ethos:** This is a high-trust, playful space. Breaking things is part of the fun. We optimize for low latency, rapid iteration, and direct access to Web Audio over strict security boundaries.

## Constraints & Guardrails

- **2-16 participants per room.** Standard Yjs full-doc replication and simple signaling are sufficient.
- **Bounded world.** Sized to `4096×4096` pixels as a baseline.
- **No storage, no rewind.** All performances are live and ephemeral. When the last participant leaves, the room's transient state is deleted.
- **Keyboard & Controller-Centric Navigation:** Panning/zooming can be done via mouse (drag and wheel), but also via keyboard (WASD/arrows) and MIDI binds to keep hands free for coding and instrument playing.
- **No Auth / Accounts.** URL hash contains the room ID. Land, jam, leave.

## Core Concepts

### 1. The World
A bounded 2D coordinate space. It holds an array of active **Elements**, a **Signal Bus** for inter-element coordination, and a single shared logical **Global Clock**.

### 2. Elements (Micro-App Contract)
An Element is a self-contained visual/audio module. It is written in pure HTML/CSS/JS and runs in a same-origin iframe to allow zero-latency connection to the parent's `AudioContext`.

*   **Contract:** Every element exports a single default setup function:
    ```javascript
    export default function setup(ctx) {
      // ctx: { audioCtx, audioOut, bus, domRoot, clock }
      
      const osc = ctx.audioCtx.createOscillator();
      osc.connect(ctx.audioOut);
      osc.start();

      return {
        update(tick) {
          // Optional: Per-frame animation / parameter updates
        },
        destroy() {
          // Bulletproof cleanup
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
To support hundreds of elements on a single canvas, we split **Audio Processing** from **DOM Rendering**:
*   **Continuous Audio:** Web Audio nodes are incredibly lightweight. The audio sub-graph for every element continues to process in the background, ensuring a continuous global soundscape.
*   **Visual Virtualization:** If an element is positioned outside the viewport (plus a 1.5x padding margin), its iframe is set to `display: none` or unmounted, and its `requestAnimationFrame` loop is suspended. This keeps the active DOM footprint and render context count minimal, capping CPU/GPU usage regardless of total element count.

### 6. The Global Nervous System (SignalBus)
To restore rich collaboration and build interconnected modular synthesizers across the canvas, elements are connected via a shared, lightweight **SignalBus**:
*   An element can publish a value to a named signal: `ctx.bus.pub("kick_trig", 1.0)`.
*   Other elements can subscribe to that signal: `ctx.bus.sub("kick_trig", (val) => flash(val))`.
*   The parent proxies this pub/sub stream. Signals can be scoped locally or synced globally across peers using Yjs or transient WebRTC data channels.
*   This lets users build modular setups: an LFO element modulating a synth in another corner, or a sequencer sending gates to multiple sound generators.

### 7. Logical Bar-Aligned Hot-Reload
We align dynamic module loading to logical sequence ticks rather than absolute clock synchronization.
*   **Timeline Mapping:** The Yjs doc holds `{ bpm, startTime }`. Each client calculates elapsed logical beats:
    $$\text{elapsedBeats} = (\text{Date.now()} - \text{startTime}) \times \frac{\text{bpm}}{60000}$$
    $$\text{currentBar} = \lfloor \text{elapsedBeats} / 4 \rfloor$$
*   **Hot-Reload Sequence:** When an element's source code is updated:
    1.  The parent creates a Blob URL of the new code and dynamically imports it: `import(URL.createObjectURL(blob))`.
    2.  The parent instantiates a parallel audio sub-graph with `gain = 0` and mounts the new element.
    3.  The parent schedules a synchronized crossfade at the exact timestamp of the **next local bar boundary**:
        $$\text{targetTime} = \text{localAudioCtxStartTime} + ((\text{currentBar} + 1) \times 4 \times \frac{60}{\text{bpm}})$$
    4.  At `targetTime`, the old gain ramps $1 \to 0$ and the new gain ramps $0 \to 1$ over 1 or 2 bars.
    5.  Once the crossfade finishes, the old element's `destroy()` is called and its iframe is dismantled.
*   This ensures musical continuity with zero clicks or interruptions. Transitions feel like planned arrangements.

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
       Lowpass ────┘          └── Visually Virtualized Viewports
                                    │
                         ┌──────────┴──────────┐ (Same-Origin)
                         ▼                     ▼
                   [ Element 1 ]         [ Element 2 ]
                     (Iframe)              (Iframe)
```

### Sandbox & Execution Safety

Because we embrace the YOLO space, we use simple, high-performance try/catch isolation:
*   The parent wraps element setup, tick updates, and event callbacks in `try/catch` blocks.
*   If an element throws a runtime error, the parent intercepts it, freezes its visual update loop, overlay-displays the console error on that specific element on the canvas, and leaves other elements untouched.

---

## MVP Scope

The core objective of the MVP is to prove the viability of **a spatial 2D world where dynamically loaded, modular iframe elements can be hot-reloaded seamlessly on beat boundaries and interact via a shared Signal Bus**.

### IN (MVP Scope)
1.  **Spatial 2D Canvas:** Viewport navigation via mouse drag/wheel and keyboard arrow/WASD keys.
2.  **Modular Iframe Elements:** Direct same-origin iframe mounting utilizing ESM Blob URL dynamic imports.
3.  **Basic Spatial Mix:** Distance-based volume attenuation, stereo panning, and lowpass filter.
4.  **Local Focus Mode:** Hold `Tab` to mute everything outside the current viewport.
5.  **Signal Bus:** Direct pub/sub engine available to elements via `ctx.bus`.
6.  **Bar-Aligned Hot-Reload:** Logical timeline mapping using Yjs clock to trigger gain-ramped crossfades.
7.  **LLM Integration:** Prompt bar that transmits instructions to the model, which outputs ES Modules.
8.  **Conversational Prompt Pushback:** If a prompt is ambiguous (e.g. "make it louder"), the model pushes back asking exactly which element/track is being modified.

### OUT (Deferred)
- Multi-room routing and room discovery.
- Persistent database storage (ephemerality matches design).
- Advanced audio isolation structures (Web Workers/AudioWorklets).
- Sophisticated collaborative mouse pointers / presence avatars (added post-MVP).

---

## Build Order

1.  **Visual Canvas & Viewport Navigation:** Render a subtle reference coordinate grid. Implement smooth WASD/arrow keyboard panning and mouse drag/wheel zoom.
2.  **Static Element Rendering & Virtualization:** Place 4 dummy visual elements on the canvas. Implement the Visual Level-of-Detail (LOD) system—hiding or pausing elements outside the padded viewport.
3.  **Spatial Audio Sub-graphs:** Wire a continuous synthesizer loop to each element. Implement the spatial coordinate formulas updating gain, pan, and filter frequency on every animation frame. Verify that panning and zooming change the stereo image and distance attenuation perfectly.
4.  **Signal Bus Integration:** Enable a simple LFO element to publish a value, and a visual element to subscribe and animate. Verify that modular signal connections work seamlessly on the same canvas.
5.  **Yjs Synchronization:** Integrate `y-webrtc` (or stable signaling). Synchronize element coordinates, Signal Bus events, and the logical clock across multiple browser tabs.
6.  **Blob URL dynamic imports & Hot-Reload Crossfades:** Set up console-triggered code injections. Implement the logical timeline-matching code to execute a smooth $1 \to 0 \to 1$ crossfade on the exact next bar boundary.
7.  **LLM Toolmaker Prompt Integration:** Build the prompt panel. Connect it to the LLM agent, configuring it to return clean ESM modules and push back on ambiguous targeting requests.
