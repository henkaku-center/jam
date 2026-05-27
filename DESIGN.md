# jam — design

A shared 2D world where music and visuals are spatially situated, hot-reloadable, and AI-composable. The map is a collaborative canvas of interactive tools, instruments, and visualizers built on-the-fly.

## Vision

A jam is **a collaborative 2D space designed for local, in-person jam sessions and live performances**. Participants bring their laptops, MIDI controllers, and instruments to the physical venue, plug into a local network, and jam together. 

To eliminate multi-machine speaker phasing while keeping collaboration symmetric, the system now runs one **unified jam client** in every browser:
*   **One Shared Source of Truth:** Every participant connects to the same local Yjs room, runs the same canvas, sees the same elements, and executes the same element code.
*   **Audible Room Feed:** The machine connected to the venue's main sound system opens the same client with `?audio=on` (or `?muted=false`). Its master `GainNode` is audible.
*   **Muted Collaborator Clients:** Other participants open the same URL without an audio opt-in. They still initialize a real Web Audio `AudioContext` and execute identical graphs, but their final master `GainNode` is set to `0`. This keeps laptops silent while preserving visualizers, analyzers, and element behavior.
*   **Spatial Focus:** In normal mode, the audible client plays a global mix so panning and zooming around the canvas does not unexpectedly move or attenuate instruments. Holding Focus Mode makes the local viewport drive spatial panning, attenuation, and filtering so the room feed can isolate a canvas region.
*   **A World of Tools, Built Together:** Elements are not just static loops; they are interactive instruments and visualizers. The server-side LLM acts as an agentic toolmaker. If you want to play a synth, you ask the LLM to build you a keyboard interface. Once built, you play it with your MIDI controller, record sequences, or modulate it with an LFO element running in an adjacent quadrant, all rendered instantly in real-time on the master room projector.
*   **The YOLO Ethos:** This is a high-trust, playful space. Breaking things is part of the fun. We optimize for low latency, rapid iteration, and direct access to Web Audio over strict security boundaries.

## Constraints & Guardrails

- **Local Jam Setting:** Specifically designed for 2-16 participants gathered in a physical room sharing a local network (Wi-Fi or Ethernet), feeding a single projector and main sound system.
- **Canvas Boundaries:** Bounded for testing to a standard 1080p workspace (`1920×1080` pixels).
- **Ephemeral State with Server-Backed Recovery:** While transient runtime states (like current LFO phase or unsaved volume faders) are ephemeral, the server automatically commits compiled element source `.js` files and a canvas workspace manifest (`workspace_layout.json`) to disk on every successful build or merge. If any client crashes or is refreshed, it automatically queries the manifest and restores the entire canvas structure.
- **Keyboard & Controller-Centric Navigation:** Panning/zooming can be done via mouse (drag and wheel), but also via keyboard (WASD/arrows) and MIDI binds to keep hands free for coding and instrument playing.
- **No Auth / Accounts:** URL hash contains the room ID. Land, jam, leave.

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

*   **Strudel-Style Code:** Pattern-code surfaces are elements, not floating app-level REPLs. They must schedule from `ctx.clock.onTick`, connect generated sound through `ctx.audioOut`, and sync code/play state with `ctx.bus.pubGlobal` so collaborators share the same timed pattern.

### 3. Spatial Mix & Viewport
*   **Audio Engines:** Every client runs a real Web Audio `AudioContext`. Clients are silent by default because their master output is muted (`gainNode.gain.setValueAtTime(0, now)`); the room feed is just a client opened with `?audio=on`.
*   **Normal Mix:** In normal mode, element audio is routed as a global mix (`volume=1`, centered pan, open lowpass). Camera navigation remains purely visual.
*   **Focus Spatial Mix:** In Focus Mode, each client computes element offset relative to its local viewport to drive the Web Audio spatial pipeline:
    *   **Attenuation:** Full volume inside the local visual viewport; rolls off smoothly to silent as an element moves outside.
    *   **Panning:** Mapped to horizontal offset in the viewport (`-1` far-left, `+1` far-right).
    *   **Lowpass:** A BiQuad filter frequency decreases as the element's distance from the viewport center increases.
*   **Muted Collaboration:** Participant laptops execute identical Web Audio graphs silently. Because they execute the true Web Audio code locally, any canvas visualizers connected to audio nodes (e.g., AnalyserNode FFT) continue to work natively on developers' screens.

### 4. Focus Mode (Viewport Soloing)
Holding a hotkey (e.g., `Tab`) activates **Focus Mode** on that client:
*   Audio-producing elements *outside* the local visual viewport are instantly and smoothly muted (`gainNode.gain.setTargetAtTime(0, now, 0.1)`).
*   This lets the audible room-feed client isolate a specific cluster of instruments for the physical audience while collaborators can use the same behavior locally with muted output.
*   Focus Mode can visually dim all other canvas elements to help the developer focus on their current code block.

### 5. Level of Detail (Visual Virtualization)
To support dozens of elements on a single canvas, we split **Audio Processing** from **DOM Rendering**:
*   **Continuous Audio:** Web Audio nodes run in the main window context rather than unmounted iframes. Even if an element is off-screen, its audio sub-graph continues to process continuously.
*   **Visual Virtualization:** If an element is positioned outside a client's local viewport (plus a padding margin), its Shadow DOM container is set to `visibility: hidden` (maintaining its layout and running state but saving GPU render cycles), and its `update` loop execution is skipped. This keeps the active render context minimal and prevents browser background timer throttling.

### 6. The Global Nervous System (SignalBus)
To support modular synthesizers and cross-element coordination, elements connect via a shared **SignalBus** split into two tiers under `ctx.bus`:

1.  **Local Bus (High Frequency / In-Memory):**
    High-frequency, in-memory client-side pub/sub for real-time algorithmic modulation (e.g., LFO values, envelope gates, frequency modulations). This is local-only, bypassing the network to prevent congestion.
    *   **Local Modulation:** Since this bus is strictly in-memory, it is reserved for automated signal pathways running within one browser's active audio engine (e.g., an LFO element modulating a synthesizer filter).
    *   **No local-bus UI controls:** User-driven interactions (knobs, sliders, button triggers) must *never* publish only to the Local Bus, as those events would not reach other clients. Instead, all user-initiated UI events must be routed via the **Global Bus**.
    *   **Publish:** `ctx.bus.pub("filter_cutoff", 0.8)`
    *   **Subscribe:** `const unsub = ctx.bus.sub("filter_cutoff", (val) => { ... })`
2.  **Global Bus (Low Frequency / State Synced):**
    Synced globally across clients using Yjs and a local `y-websocket` server for low-frequency state-level triggers and configurations (e.g., sequencer step events, play/stop, pattern changes, global instrument selections). To ensure absolute offline reliability in physical venues, signaling completely bypasses public internet servers and runs strictly over the local LAN WebSocket server.
    *   **Publish:** `ctx.bus.pubGlobal("sequencer_pattern", [1, 0, 0, 1])`
    *   **Subscribe:** `const unsub = ctx.bus.subGlobal("sequencer_pattern", (pattern) => { ... })`

*   **Instance Namespacing vs. Global Routing:**
    To prevent collisions when multiple instances of the same element are created (e.g., two "Drum Synth" modules), keys used in `pubLocal`, `pubGlobal`, `subLocal`, and `subGlobal` are **automatically namespaced** to the element's unique instance ID by the parent container's bus proxy.
    
    If an element explicitly wants to communicate globally with other elements (e.g., a master clock publishing BPM), it must prefix the key with `global:`, for example:
    *   `ctx.bus.pubGlobal("global:tempo_bpm", 120)`
    *   `ctx.bus.subGlobal("global:tempo_bpm", (bpm) => { ... })`

*   **Zero-Boilerplate Compile-Time Routing:**
    Because the LLM compiler resides in the same environment as the server and possesses complete awareness of the workspace layout and element IDs, we completely bypass complex dynamic routing/patching UI boilerplate. When a user asks to "connect LFO 1 to Synthesizer 2," the server-side LLM identifies the precise unique IDs of both target elements and **hardcodes the namespaced subscription key** directly into the compiled ESM code for the target elements. This creates direct, zero-overhead point-to-point local pathways.

*   **Rule of Thumb for LLMs & Developers:**
    *   If a value is generated algorithmically and updates multiple times per second (e.g., > 5Hz, like an LFO or clock generator), use local `pub/sub`.
    *   If a value is modified by a human user interacting with a UI component (dragging a slider, pressing a virtual key, toggling a step), it must be broadcast over the **Low-Latency WebSocket Channel** or the **Global Bus (Yjs)** so the Host-Renderer receives the action and alters the active sound wave.
    *   Keep keys instance-specific (default) unless explicit cross-element communication is required (use `global:` prefix) or established via LLM compile-time link mapping.

*   **Hot-Reload De-duplication:** During hot-reload crossfades, the old element is marked as "dying." The parent's SignalBus proxy immediately intercepts and discards all publications and subscriptions from the dying element, preventing double-triggering or parameter-clashing while the audio crossfades.

### 7. Logical Bar-Aligned Hot-Reload & Precise Sync
We align dynamic module loading and musical sequencing to logical ticks using a **Parent-Managed Look-Ahead Scheduler ("A Tale of Two Clocks")** to ensure jitter-free, musical transitions and zero timing-boilerplate for elements:

*   **The Timeline & Synchronized Sync (Visual NTP):** The Yjs doc holds `{ bpm, startTime }`. To handle device-to-device clock drift over local Wi-Fi without full hardware synchronization protocols, clients perform a visual NTP-style handshake with the server upon connection:
    1.  The client transmits local timestamp $T_1$.
    2.  The server/host replies with its clock timestamp $T_2$.
    3.  The client registers receipt at $T_3$.
    4.  The round-trip latency is estimated as $RTT = T_3 - T_1$, and the client's clock offset is computed as $\text{offset} = T_2 - T_1 - (RTT / 2)$.
    
    Using this, each client calculates the synchronized time $\text{syncTime} = \text{Date.now()} + \text{offset}$ and derives continuous logical beats:
    $$\text{elapsedBeats} = (\text{syncTime} - \text{startTime}) \times \frac{\text{bpm}}{60000}$$
    $$\text{currentBar} = \lfloor \text{elapsedBeats} / 4 \rfloor$$
    
    This visual NTP handshake brings client-to-host drift down to under $5\text{ms}$ on typical local networks, aligning visual playheads perfectly with the master audio mix.

*   **Continuous Tempo Pivot (BPM Transitions):** 
    If a user adjusts the BPM dynamically, recalculating the beat count directly would cause a catastrophic playhead jump on the timeline. To perform a continuous tempo change, the changing client calculates a new pivot `startTime` atomically and commits it to Yjs alongside the new `bpm`.
    
    Let $T$ be the current synchronized time ($\text{syncTime}$). First, the exact beat count $B$ at the pivot point is computed using the old clock configuration:
    $$B = (T - \text{startTime}_{\text{old}}) \times \frac{\text{bpm}_{\text{old}}}{60000}$$
    
    Then, the new `startTime` is derived using the target BPM such that the beat count $B$ is perfectly continuous at time $T$:
    $$\text{startTime}_{\text{new}} = T - \left(\frac{B \times 60000}{\text{bpm}_{\text{new}}}\right)$$
    
    Both `bpm` and `startTime` are updated simultaneously in the shared Yjs document, transitioning the room's tempo with zero phase jumps or sequencer glitches.

*   **Parent-Managed Scheduler:** The parent client runs a high-precision look-ahead loop (every 25ms checking 100ms ahead) converting synchronized logical beats to local hardware-locked `audioCtx.currentTime`.
    - Instead of elements managing their own timers, the parent broadcasts these target times in advance via `ctx.clock.onTick(({ step, time, duration, bpm }) => { ... })`.
    - This allows elements to schedule Web Audio events sample-accurately and support micro-timings (like swing or shuffle) effortlessly, while the parent automatically cleans up all subscriptions on reload.
*   **Downbeat Hot-Reload Sequence:** When an element's synced source file URL is updated:
    1.  **Pre-flight Function/Module Compilation:** To mitigate network latency and completely eliminate V8 engine memory leaks caused by dynamic ESM caching, the parent fetches the module source as raw text. The server-side LLM compiler transpiles/wraps this module into a self-contained Immediately Invoked Function Expression (IIFE) string. The parent client fetches this string and compiles/evaluates it locally using `new Function()`. This ensures that when the element is eventually destroyed, the entire closure is 100% garbage-collected.
    2.  Once the module successfully compiles and is loaded in memory, the parent retrieves the old element's state via `oldElement.getState()`.
    3.  The parent instantiates the new element inside a new Shadow Root, passing the retrieved `prevState`.
    4.  The parent wires up the parallel audio sub-graph with `gain = 0` and attaches the new `onTick` scheduler events.
    5.  **Adaptive Boundary Offsetting:** The parent calculates the downbeat target time:
        $$\text{targetTime} = \text{localAudioCtxStartTime} + ((\text{currentBar} + 1) \times 4 \times \frac{60}{\text{bpm}})$$
        If the module load finished late—leaving a transition window of less than 200ms before `targetTime`—the parent automatically bumps the transition target to the subsequent bar downbeat ($\text{currentBar} + 2$) to prevent scheduling events in the past or audio popping.
    6.  At `targetTime`, the old element's gain is ramped to 0 and the new element's gain is ramped to 1. This downbeat transition is perceived as a natural musical "drop," completely hiding phase jumps without complex state transfer.
    7.  Once the crossfade finishes, the old element's `destroy()` is called (fully disconnecting its audio nodes, clearing listeners, and unsubscribing from ticks), and its Shadow DOM wrapper is removed.

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
                                 │ (Syncs over Local Wi-Fi / local y-websocket)
                                 ▼
         ┌───────────────────────┴───────────────────────┐
         ▼                                               ▼
  [ Jam Client ?audio=on ]                       [ Jam Client muted ]
  (Main Projector / Sound System)                (Participant Laptops)
  ├── AudioContext (Audible master gain)         ├── AudioContext (Muted master gain)
  │    ├── Master Out                            │    └── Same per-element graph
  │    └── Sub-graphs (per-elem)                 └── Canvas & Viewport
  │         ├── Gain                                  ├── Edit / Code panel
  │         ├── Panner (focus mode)                   ├── Coordinate navigation
  │         └── Lowpass (focus mode)                  └── MIDI / Keyboard controller
  └── Canvas & Viewport
       └── Visually Virtualized Elements
                │
                ▼
         [ Dynamic ESM ]
          (Shadow DOM)
```

### Sandbox & Execution Safety

Because we embrace the YOLO space, we use high-performance main-thread execution with robust wrapper defenses:
*   **Automated Resource Tracking & Cleanup:** The parent container does not rely solely on the element's custom `destroy()` hook to prevent resource leaks. The `ctx` object passed to `setup` contains wrapped proxies for standard constructors and listeners (e.g., `ctx.audioCtx`, `ctx.domRoot`, and global listeners). The parent automatically tracks every event listener, timer, and Web Audio node created through this context. On reload or destruction, the parent forcefully tears down, disconnects, and unsubscribes these tracked resources to guarantee zero memory or audio leakages.
*   **LLM-Driven State Schema Migration:** During hot-reloads, the parent retrieves the old instance's state via `getState()`. Since the LLM operates in the server environment with full context, the code generator automatically inspects the previous version's state schema and includes custom inline translation helpers within the new code to map older schemas (e.g., `prevState.tempo` to the new `state.bpm`) seamlessly.
*   **Runtime Error Catching:** The parent wraps element setup, tick updates, and event callbacks in `try/catch` blocks. If an element throws a runtime error, the parent intercepts it, freezes its visual update loop, and overlay-displays the console error on that specific element on the canvas while leaving other elements untouched.
*   **Latest Stable Fallback Recovery:** The parent retains a cache of the last successfully initialized and error-free ESM file URL/version for each element. If a newly hot-reloaded code version fails during `setup()` or throws errors in its first few execution frames, the parent automatically and gracefully rolls back to the previous stable version. This ensures that a single buggy change or syntax slip never permanently breaks the live performance for other users.
*   **Leak-Proof Dynamic Evaluation:** Because V8 and other modern browser JS engines do not support garbage collection or unloading of dynamically imported ES Modules (`import('...?v=...')`), standard dynamic hot-reloading can accumulate heap memory leaks over time. To achieve infinite continuous uptime for multi-hour venue performances, we bypass dynamic imports entirely for hot-reloads. The server-side LLM compiler transpiles modules into a self-contained functional string wrapper (e.g., an IIFE), and the parent client compiles and evaluates it via `new Function()`. Once an element's `destroy()` is called and its outer bindings are released, the dynamic function closure is 100% garbage-collected by the browser engine, ensuring a leak-proof execution environment.
*   More robust thread-isolated sandboxing (such as offscreen canvas in Web Workers) is deferred for post-PoC development.

---

## MVP Scope

The core objective of the MVP is to prove the viability of **a spatial 2D world where dynamically loaded, modular Shadow DOM elements can be hot-reloaded seamlessly on beat boundaries and interact via a shared Signal Bus**.

### IN (MVP Scope)
1.  **Unified Client Architecture:** Every browser runs the same full jam client and shares the same Yjs source of truth. Clients are locally muted by default; the room-feed device opts into audible output with `?audio=on`.
2.  **Global Interaction Sync:** User-facing controls publish via the Global Bus/Yjs so collaborator actions update the same element state on every browser. Local bus remains available for high-frequency in-process modulation.
3.  **Spatial 2D Canvas:** Viewport navigation via mouse drag/wheel and keyboard arrow/WASD keys on a fixed 1080p canvas. Elements are draggable by default and resizable on request.
4.  **Modular Shadow DOM Elements:** Direct Shadow DOM mounting utilizing dynamic `new Function()` evaluation of server-transpiled modules to guarantee leak-proof continuous performance, with full support for CDN imports (e.g. `esm.sh`).
5.  **Focus-Scoped Spatial Mix:** Normal mode uses a global mix; Focus Mode applies distance-based volume attenuation, stereo panning, and lowpass filtering relative to the local viewport.
6.  **Focus Mode:** Hold `Tab` to mute everything outside the current viewport.
7.  **Two-Tier Signal Bus:** High-frequency local pub/sub combined with low-frequency global state sync over a local, offline LAN `y-websocket` server.
8.  **Bar-Aligned Hot-Reload:** Look-ahead scheduler combining global beats with sample-accurate Web Audio timelines to perform gain-ramped crossfades.
9.  **In-Memory State Preservation:** Contract utilizing `setup(ctx, prevState)` and `getState()` to transfer state seamlessly on hot-reload.
10. **Server-Side LLM Compiler & Target Mapping:** An active LLM agent session on the server managing dynamic element generation in the workspace:
    - **Canvas-to-File Mapping:** The Yjs document maps each canvas Element ID 1-to-1 with its physical source file path on the server (e.g., `element_123 -> /public/elements/sequencer_123.js`).
    - **Targeted Prompt Routing:** The client-side prompt bar routes the prompt along with the target element's active file path to the server. The LLM agent receives both, enabling direct, surgical modification of the correct source file.
    - **Automated Wrapper Instrumentation:** During compile-time, the server can wrap the generated ES modules to inject safety hooks, intercepting Web Audio nodes and EventListeners for bulletproof parent-managed tracking and teardown.
    - **State Migration Injector:** The server compiles old state structures back into the LLM context, instructing the model to generate custom translation helpers to automatically bridge schema gaps inside the returned module.
11. **Audio Autoplay Policy Handling:** A "Click to join" landing screen requiring an explicit user gesture before any synchronization, coordinates, or audio nodes initialize.

### OUT (Deferred)
- Multi-room routing and room discovery.
- Persistent database storage (ephemerality matches design).
- Advanced sandbox boundaries / off-main-thread Web Workers.
- Sophisticated collaborative mouse pointers / presence avatars.

---

## Build Order

1.  **Unified Canvas & Autoplay:** Render the subtle reference coordinate grid. Implement smooth mouse and keyboard WASD navigation on the 1080p canvas. Create the default-muted join flow and `?audio=on` audible-room-feed opt-in.
2.  **Global Interaction Sync:** Ensure UI controls use the Global Bus/Yjs for shared state so every client observes the same interaction results.
3.  **Static Element Rendering & Virtualization:** Place 4 dummy visual elements inside Shadow Roots on the canvas. Implement the Visual Level-of-Detail (LOD) virtualization system, testing that elements off-screen are correctly set to `visibility: hidden` and their `update` loops are skipped.
4.  **Spatial Audio Sub-graphs & Look-Ahead Scheduler:** Wire a continuous synthesizer loop to each element. Implement global normal mix plus Focus Mode spatial panning, volume attenuation, and lowpass filtering relative to the local viewport. Establish the look-ahead scheduler converting logical beats to local `audioCtx.currentTime`.
5.  **Two-Tier Signal Bus Integration:** Implement the two-tier SignalBus. Verify that local pub/sub works in-memory and global pub/sub syncs state via Yjs. Integrate the instance-ID namespacing proxy.
6.  **Yjs Synchronization:** Integrate a local, offline LAN `y-websocket` server. Synchronize element coordinates, clock configs `{ bpm, startTime }`, and global SignalBus events across multiple browser tabs and participant laptops with zero internet dependencies.
7.  **Dynamic new Function Evaluation & Hot-Reload Crossfades:** Implement dynamic `new Function()` compilation of server-transpiled functional modules. Integrate pre-flight fetching/compilation, adaptive boundary offsets, `getState()`, and `setup(ctx, prevState)` to trigger seamless gain-ramped crossfades at the next bar boundary with 100% garbage collectability.
8.  **Server-Side LLM Compiler Integration:** Set up the server-side LLM compiler with targeted prompt routing (sending the active file path along with the user's prompt). Implement the canvas-to-file mapping via Yjs. Construct the compile-time wrapper to automatically inject Web Audio/DOM tracker instrumentation and state translation logic into compiled ESM modules.
