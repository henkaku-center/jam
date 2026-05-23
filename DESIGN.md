# jam — design

A shared 2D world where music and visuals are spatially situated, hot-reloadable, and AI-composable. The map is a collaborative canvas of interactive tools, instruments, and visualizers built on-the-fly.

## Vision

A jam is **a collaborative 2D space designed for local, in-person jam sessions and live performances**. Participants bring their laptops, MIDI controllers, and instruments to the physical venue, plug into a local network, and jam together. 

To eliminate multi-machine speaker phasing, audio latency, and browser autoplay blockades, the system runs on a **Host-Renderer / Thin-Controller** model:
*   **The Host-Renderer (Master Feed):** A single central machine connected to the venue's main sound system (speakers) and projector. It is the sole client that initializes the Web Audio `AudioContext` and renders the master spatial mix.
*   **The Spatial Projector Viewport:** What the room hears and sees depends on where the **Host** machine looks. The Host viewport acts as the master stereo frame and camera. Distance on the canvas relative to the Host camera attenuates volume, horizontal offset sets stereo panning, and distant sources are dynamically lowpassed. The Host acts like a spatial "Cameraman" or "DJ," focusing the room's attention on different pockets of the canvas.
*   **Thin-Controller Clients:** Other participants connect to the local server on their own laptops. Their local clients are completely silent (the local Web Audio engine is omitted or suspended to conserve CPU/battery). However, they retain full interactive control of the 2D canvas — dragging elements, writing code, editing sequencers, and playing MIDI keyboards. To ensure code runs identically across clients without conditional checks, the Thin-Controller context mocks `audioCtx` and `audioOut` as functional but silent dummy objects.
*   **A World of Tools, Built Together:** Elements are not just static loops; they are interactive instruments and visualizers. The server-side LLM acts as an agentic toolmaker. If you want to play a synth, you ask the LLM to build you a keyboard interface. Once built, you play it with your MIDI controller, record sequences, or modulate it with an LFO element running in an adjacent quadrant, all rendered instantly in real-time on the master room projector.
*   **The YOLO Ethos:** This is a high-trust, playful space. Breaking things is part of the fun. We optimize for low latency, rapid iteration, and direct access to Web Audio over strict security boundaries.

## Constraints & Guardrails

- **Local Jam Setting:** Specifically designed for 2-16 participants gathered in a physical room sharing a local network (Wi-Fi or Ethernet), feeding a single projector and main sound system.
- **Canvas Boundaries:** Bounded for testing to a standard 1080p workspace (`1920×1080` pixels).
- **Ephemeral State with Server-Backed Recovery:** While transient runtime states (like current LFO phase or unsaved volume faders) are ephemeral, the server automatically commits compiled element source `.js` files and a canvas workspace manifest (`workspace_layout.json`) to disk on every successful build or merge. If the Host-Renderer crashes or is refreshed, it automatically queries the manifest and restores the entire canvas structure, preventing catastrophic silence in physical venues.
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

### 3. Spatial Mix & Viewport
Only the **Host-Renderer** maintains an active Web Audio `AudioContext`. 
*   **The Master Viewport:** The Host viewport `(x, y, zoom)` (typically projected on a wall/screen) acts as the master stereo frame. 
*   **Spatial Calculations:** Every animation frame, the Host computes each element's relative coordinate offset relative to the **Host's visual viewport** to drive the Web Audio spatial pipeline:
    *   **Attenuation:** Full volume inside the Host's visual viewport; rolls off smoothly to silent as an element moves outside.
    *   **Panning:** Mapped to horizontal offset in the Host's viewport (`-1` far-left, `+1` far-right).
    *   **Lowpass:** A BiQuad filter frequency decreases as the element's distance from the center of the Host's viewport increases.
*   **Thin Controllers:** Participant laptops render the identical canvas positions but execute silent, mocked audio sub-graphs (via a silent, mocked `audioCtx` and `audioOut` node) to bypass physical sound rendering while preserving identical code execution.

### 4. Focus Mode (Host Viewport Soloing)
Holding a hotkey (e.g., `Tab`) on the **Host-Renderer** activates **Focus Mode**:
*   All audio-producing elements *outside* the Host's current visual viewport are instantly and smoothly muted (`gainNode.gain.setTargetAtTime(0, now, 0.1)`).
*   This allows the live spatial "DJ" or operator running the Host machine to instantly isolate a specific cluster of instruments on the projector for the physical audience.
*   On Thin-Controller clients, Focus Mode can visually dim all other canvas elements to help the developer focus on their current code block.

### 5. Level of Detail (Visual Virtualization)
To support dozens of elements on a single canvas, we split **Audio Processing** from **DOM Rendering**:
*   **Continuous Audio (Host-Only):** Web Audio nodes run in the main window context rather than unmounted iframes. Even if an element is off-screen, its audio sub-graph continues to process continuously on the Host machine.
*   **Visual Virtualization (All Clients):** If an element is positioned outside a client's local viewport (plus a 1.5x padding margin), its Shadow DOM container is set to `visibility: hidden` (maintaining its layout and running state but saving GPU render cycles), and its `update` loop execution is skipped. This keeps the active render context minimal and prevents browser background timer throttling on both Host and Controller screens.

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

*   **Instance Namespacing vs. Global Routing:**
    To prevent collisions when multiple instances of the same element are created (e.g., two "Drum Synth" modules), keys used in `pubLocal`, `pubGlobal`, `subLocal`, and `subGlobal` are **automatically namespaced** to the element's unique instance ID by the parent container's bus proxy.
    
    If an element explicitly wants to communicate globally with other elements (e.g., a master clock publishing BPM), it must prefix the key with `global:`, for example:
    *   `ctx.bus.pubGlobal("global:tempo_bpm", 120)`
    *   `ctx.bus.subGlobal("global:tempo_bpm", (bpm) => { ... })`

*   **Zero-Boilerplate Compile-Time Routing:**
    Because the LLM compiler resides in the same environment as the server and possesses complete awareness of the workspace layout and element IDs, we completely bypass complex dynamic routing/patching UI boilerplate. When a user asks to "connect LFO 1 to Synthesizer 2," the server-side LLM identifies the precise unique IDs of both target elements and **hardcodes the namespaced subscription key** directly into the compiled ESM code for the target elements. This creates direct, zero-overhead point-to-point local pathways.

*   **Rule of Thumb for LLMs & Developers:**
    *   If a value updates multiple times per second (e.g., > 5Hz), use local `pub/sub`.
    *   If a value updates only on user interaction, state toggles, or structural changes, use `pubGlobal/subGlobal`.
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
    1.  **Pre-flight Module Fetching:** To mitigate network latency risks, the parent client initiates the dynamic ESM import and caches the module *before* scheduling any downbeat: `import(fileUrl + '?v=' + Date.now())`.
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
                                 │ (Syncs over Local Wi-Fi / y-websocket / WebRTC)
                                 ▼
         ┌───────────────────────┴───────────────────────┐
         ▼                                               ▼
  [ Host-Renderer Client ]                       [ Thin-Controller Client ]
  (Main Projector / Sound System)                (Participant Laptops)
  ├── AudioContext (Active)                      ├── AudioContext (Mocked / Silent)
  │    ├── Master Out                            └── Canvas & Viewport (Independent)
  │    └── Sub-graphs (per-elem)                      ├── Edit / Code panel
  │         ├── Gain                                  ├── Coordinate navigation
  │         ├── Panner (Host viewport)                └── MIDI / Keyboard controller
  │         └── Lowpass                                        │
  └── Canvas & Viewport (Master Camera)                        │
       └── Visually Virtualized Elements                       ▼
                │                                    [ Fast Controller Channel ]
                │                                     (Low-Latency Raw WebSocket)
                ▼                                              │
         [ Dynamic ESM ] <─────────────────────────────────────┘
          (Shadow DOM)
```

### Sandbox & Execution Safety

Because we embrace the YOLO space, we use high-performance main-thread execution with robust wrapper defenses:
*   **Automated Resource Tracking & Cleanup:** The parent container does not rely solely on the element's custom `destroy()` hook to prevent resource leaks. The `ctx` object passed to `setup` contains wrapped proxies for standard constructors and listeners (e.g., `ctx.audioCtx`, `ctx.domRoot`, and global listeners). The parent automatically tracks every event listener, timer, and Web Audio node created through this context. On reload or destruction, the parent forcefully tears down, disconnects, and unsubscribes these tracked resources to guarantee zero memory or audio leakages.
*   **LLM-Driven State Schema Migration:** During hot-reloads, the parent retrieves the old instance's state via `getState()`. Since the LLM operates in the server environment with full context, the code generator automatically inspects the previous version's state schema and includes custom inline translation helpers within the new code to map older schemas (e.g., `prevState.tempo` to the new `state.bpm`) seamlessly.
*   **Runtime Error Catching:** The parent wraps element setup, tick updates, and event callbacks in `try/catch` blocks. If an element throws a runtime error, the parent intercepts it, freezes its visual update loop, and overlay-displays the console error on that specific element on the canvas while leaving other elements untouched.
*   **Latest Stable Fallback Recovery:** The parent retains a cache of the last successfully initialized and error-free ESM file URL/version for each element. If a newly hot-reloaded code version fails during `setup()` or throws errors in its first few execution frames, the parent automatically and gracefully rolls back to the previous stable version. This ensures that a single buggy change or syntax slip never permanently breaks the live performance for other users.
*   **ESM Memory Leak Limitation:** Because V8 and other modern browser JS engines do not support garbage collection or unloading of dynamically imported ES Modules (`import('...?v=...')`), every hot-reload leaves a minute trace of JS engine heap memory. For the PoC, we accept this platform constraint as the cost of zero-boilerplate main-thread execution, but mitigate it by ensuring that all associated DOM, closure reference, and Web Audio resources are aggressively garbage collected. Users are advised to perform a simple browser refresh during extended multi-hour coding runs.
*   More robust thread-isolated sandboxing (such as offscreen canvas in Web Workers) is deferred for post-PoC development.

---

## MVP Scope

The core objective of the MVP is to prove the viability of **a spatial 2D world where dynamically loaded, modular Shadow DOM elements can be hot-reloaded seamlessly on beat boundaries and interact via a shared Signal Bus**.

### IN (MVP Scope)
1.  **Dual-Mode Client Architecture:** Supports `Host-Renderer` mode (active Web Audio relative to host viewport) and `Thin-Controller` mode (silent participant laptops for coding, tweaking, and navigation). To keep codebase logic identical, Thin-Controller clients are provided with a robust mockup of `audioCtx` and `audioOut` that replication-tracks connections silently rather than throwing runtime errors.
2.  **Low-Latency Controller Channel:** A raw, lightweight local WebSocket relay on the server to route high-frequency, instantaneous controller inputs (MIDI keys, CC slider values, and real-time gate triggers) directly from Thin-Controllers to the Host-Renderer, completely bypassing the heavier Yjs document synchronization cycle. This bypasses network CRDT overhead to deliver a sub-$15\text{ms}$ controller-to-sound response time, with the Host scheduling incoming socket events with an optional tiny $5\text{ms}$ safety buffer to mask network jitter.
3.  **Spatial 2D Canvas:** Viewport navigation via mouse drag/wheel and keyboard arrow/WASD keys on a fixed 1080p canvas. Elements are draggable by default and resizable on request.
4.  **Modular Shadow DOM Elements:** Direct Shadow DOM mounting utilizing dynamic ESM imports of server-served/compiled modules, with full support for CDN imports (e.g. `esm.sh`).
5.  **Host-Side Spatial Mix:** Distance-based volume attenuation, stereo panning, and lowpass filter calculated relative to the Host camera.
6.  **Host Focus Mode:** Hold `Tab` on the Host client to mute everything outside the main projector viewport.
7.  **Two-Tier Signal Bus:** High-frequency local pub/sub combined with low-frequency global state sync over Yjs.
8.  **Bar-Aligned Hot-Reload (Host):** Look-ahead scheduler combining global beats with sample-accurate Web Audio timelines to perform gain-ramped crossfades.
9.  **In-Memory State Preservation:** Contract utilizing `setup(ctx, prevState)` and `getState()` to transfer state seamlessly on hot-reload.
10. **Server-Side LLM Compiler & Target Mapping:** An active LLM agent session on the server managing dynamic element generation in the workspace:
    - **Canvas-to-File Mapping:** The Yjs document maps each canvas Element ID 1-to-1 with its physical source file path on the server (e.g., `element_123 -> /public/elements/sequencer_123.js`).
    - **Targeted Prompt Routing:** The client-side prompt bar routes the prompt along with the target element's active file path to the server. The LLM agent receives both, enabling direct, surgical modification of the correct source file.
    - **Automated Wrapper Instrumentation:** During compile-time, the server can wrap the generated ES modules to inject safety hooks, intercepting Web Audio nodes and EventListeners for bulletproof parent-managed tracking and teardown.
    - **State Migration Injector:** The server compiles old state structures back into the LLM context, instructing the model to generate custom translation helpers to automatically bridge schema gaps inside the returned module.
11. **Audio Autoplay Policy Handling:** A "Click to join" landing screen requiring an explicit user gesture to resume the Host's `AudioContext` before any synchronization, coordinates, or audio nodes initialize.

### OUT (Deferred)
- Multi-room routing and room discovery.
- Persistent database storage (ephemerality matches design).
- Advanced sandbox boundaries / off-main-thread Web Workers.
- Sophisticated collaborative mouse pointers / presence avatars.

---

## Build Order

1.  **Dual-Mode Canvas & Autoplay:** Render the subtle reference coordinate grid. Implement smooth mouse and keyboard WASD navigation on the 1080p canvas. Create the `?host=true` (Host-Renderer) vs. `?host=false` (Thin-Controller) toggle. Add the autoplay overlay requiring a Host user gesture to resume the `AudioContext` while letting Controller clients skip the overlay.
2.  **Low-Latency WebSocket Controller Channel:** Build a raw Node.js WebSocket server relay. Enable Thin-Controllers to send high-frequency MIDI and slider control events, broadcasting them directly to the Host-Renderer to bypass Yjs latency and verify $<15\text{ms}$ controller response.
3.  **Static Element Rendering & Virtualization:** Place 4 dummy visual elements inside Shadow Roots on the canvas. Implement the Visual Level-of-Detail (LOD) virtualization system, testing that elements off-screen are correctly set to `visibility: hidden` and their `update` loops are skipped.
4.  **Host-Side Spatial Audio Sub-graphs & Look-Ahead Scheduler:** Wire a continuous synthesizer loop to each element on the Host-Renderer client. Implement the spatial panning, volume attenuation, and lowpass filter calculations relative to the Host camera. Establish the Host's look-ahead scheduler converting logical beats to local `audioCtx.currentTime`.
5.  **Two-Tier Signal Bus Integration:** Implement the two-tier SignalBus. Verify that local pub/sub works in-memory and global pub/sub syncs state via Yjs. Integrate the instance-ID namespacing proxy.
6.  **Yjs Synchronization:** Integrate `y-webrtc` (or stable local signaling) on the local Wi-Fi network. Synchronize elements coordinates, clock configs `{ bpm, startTime }`, and global SignalBus events across multiple browser tabs and participant laptops.
7.  **Dynamic ESM imports & Hot-Reload Crossfades:** Implement dynamic ESM imports of server-compiled modules on the Host-Renderer. Integrate pre-flight fetching, adaptive boundary offsets, `getState()`, and `setup(ctx, prevState)` to trigger seamless gain-ramped crossfades at the next bar boundary.
8.  **Server-Side LLM Compiler Integration:** Set up the server-side LLM compiler with targeted prompt routing (sending the active file path along with the user's prompt). Implement the canvas-to-file mapping via Yjs. Construct the compile-time wrapper to automatically inject Web Audio/DOM tracker instrumentation and state translation logic into compiled ESM modules.
