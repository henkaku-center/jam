# Zefiro Wind Controller → jam

Pipes an Artinoise Zefiro (USB-C electronic wind instrument) into the multi-person jam over the global bus, so any element in the room can subscribe to breath / lip / accelerometer CCs.

## Bus contract

The `elem_zefiro_midi` element publishes to the Yjs-synced global bus. All keys live under `global:zefiro:`:

| Key                              | Type            | Notes                                     |
|----------------------------------|-----------------|-------------------------------------------|
| `global:zefiro:cc<N>`            | float 0..1      | Latest CC value normalized (raw / 127).   |
| `global:zefiro:cc<N>_raw`        | int 0..127      | Raw CC value.                             |
| `global:zefiro:active`           | number[]        | CC numbers seen this session, sorted.     |
| `global:zefiro:device`           | string          | Human-readable device name.               |

Publish rate is throttled to ~30 Hz to keep Yjs traffic sane. The Zefiro itself samples sensors at ~80–100 Hz; we coalesce per CC between ticks. For straight breath modulation this feels continuous after the consumer applies a short audio-param slew (e.g. `setTargetAtTime(value, t, 0.015)`).

Whichever browser tab has the Zefiro plugged in becomes the source of truth — Yjs propagates the values to every other peer (host included).

### Default CC mapping (Artinoise factory settings)

- **CC 11** — breath pressure (most useful)
- **CC 1**  — lip / mod sensor
- **CC 2**  — alternate breath
- **CC 7**  — volume
- **CC 16 / 17** — Pro accelerometer tilt / roll

These are remappable via Artinoise's "Zefiro Manager" desktop app. The element auto-discovers whatever the device actually sends — check the meter UI for live CC numbers.

## Pre-event checklist (tomorrow)

1. Plug the Zefiro into the Windows laptop via USB-C. Confirm it shows up in Device Manager → Sound, video and game controllers.
2. `npm start` from `~/work/music_play/jam` inside WSL. Open `http://localhost:3000` in **Chrome or Edge** on Windows (not Firefox — Web MIDI is Chromium-only).
3. Chrome will prompt for MIDI access the first time. Allow it.
4. The `ZEFIRO MIDI` element on the canvas should:
   - say `listening: <device-name>` in green
   - populate meter rows for each CC as you blow / bite / tilt
5. The `BREATH DRONE` element next to it should switch its `breath` and `cutoff` source labels from `manual` → `zefiro` as soon as data arrives, and you should hear the drone respond to breath.

If only one of breath / lip lights up, the other sensor may be mapped to a different CC. Open Zefiro Manager to inspect and remap, or wire a new subscriber to whichever CC numbers are showing in the meter.

## Writing new subscribers

Any hand-authored element can subscribe. The pattern:

```js
const unsub = ctx.bus.subGlobal('global:zefiro:cc11', (value) => {
  // value is 0..1, undefined if not yet published
  if (!Number.isFinite(value)) return;
  // smooth it through an audio param to avoid zipper noise
  gain.gain.setTargetAtTime(value, ctx.audioCtx.currentTime, 0.015);
});
// ... in destroy(): unsub();
```

The bus delivers any cached value immediately on subscribe, then live updates after each publish tick.

## Architecture notes / future work

- **No `/controller` path yet.** The low-latency `/controller` WebSocket exists server-side but the client doesn't connect to it (see `CLAUDE.md` — it's marked legacy). For breath-shaping audio modulation the throttled global-bus path is fine; if we ever need sub-frame latency for *every* element on *every* peer, wire `/controller` into `public/client.js` and have the Zefiro element fan out raw CC bytes through it.
- **One source at a time.** Web MIDI is per-tab and per-OS; if two laptops both run `elem_zefiro_midi` against two different physical devices, the global bus will get interleaved publishes. Either run the element on a single laptop, or namespace per device (e.g. `global:zefiro:<deviceId>:cc11`).
- **Not just for the Zefiro.** Any class-compliant USB MIDI device will work. The picker in the meter UI lists every input the browser sees, so a regular controller can feed CCs through the same bus contract.

## Files

- `public/elements/elem_zefiro_midi.js` — MIDI source + meter UI.
- `public/elements/elem_zefiro_breath_drone.js` — demo subscriber: two-saw drone, breath → amp, lip → cutoff. Manual sliders take over when no MIDI data is present.
- `public/elements/elem_crystal_lead_synth.js` — production synth, now Zefiro-aware: breath multiplies its master output gain (EWI-style expression), lip biases the FX delay-filter brightness around the existing `tone` slider. With no Zefiro data the synth behaves exactly as before.
- Source + demo registered in `workspace_layout.json` as hand-authored.

## Pre-built test harness

`public/zefiro-test.html` is a standalone, jam-free Web MIDI tester. Open `http://localhost:3000/zefiro-test.html` in Chrome to see device name, live per-CC meters with Hz counters, and a decoded raw MIDI log. Use this to verify the device and discover the actual CC mapping before tweaking element subscribers.
