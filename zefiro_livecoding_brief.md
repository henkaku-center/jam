# Zefiro Live Coding Setup — Briefing for Claude Code

## TL;DR for the agent

The user is going to a live coding event tomorrow (Strudel for sound, Hydra for visuals, both in the browser). They have an Artinoise Zefiro electronic wind instrument (and a Zefiro Pro). They want the Zefiro to drive parameters in Strudel and Hydra as a breath/expression/accelerometer controller.

The laptop is **Windows with WSL2 installed**. The single most important architectural fact:

> **Strudel and Hydra run in the browser on Windows. The browser on Windows can read USB MIDI directly via the Web MIDI API. WSL is not required to get the Zefiro working with Strudel/Hydra.**

WSL is only useful here if the user wants Python-side logging, analysis, or custom MIDI processing. Default to the Windows-native path. Only set up WSL USB forwarding if explicitly requested.

---

## Goal hierarchy (in order of priority)

1. **Confirm the Zefiro is recognized as a USB MIDI device on Windows** and that breath/lip/accelerometer events stream out.
2. **Get Strudel modulating a sound parameter from breath pressure** in Chrome/Edge.
3. **Get Hydra modulating a visual parameter from breath pressure** in Chrome/Edge.
4. **(Stretch)** Get both running simultaneously, with the same breath driving both.
5. **(Optional)** Set up WSL → USB MIDI access via usbipd-win for Python-side processing.

Don't over-engineer. The event is tomorrow. The user explicitly said "celebrate the glitches" is the event's vibe. Aim for working > clever.

---

## Device facts (Artinoise Zefiro)

- **Class-compliant USB MIDI device** (USB-C). No drivers needed on Windows 10/11 — it should appear as a MIDI input automatically.
- **No proprietary SDK or REST API.** Everything comes out as standard MIDI messages over USB.
- **Sample rate:** ~80–100 Hz for continuous sensors.
- **Default MIDI mappings** (user-remappable via the "zefiro Manager" desktop app):
  - **Breath pressure → CC#11** (expression). Alternatives: CC#2 (breath), CC#7 (volume), or channel aftertouch.
  - **Lip/bite sensor → separate CC** (used for both expression and auto-recalibration).
  - **Pro 3D accelerometer → two CCs** (tilt + rotation, mappable).
- **The mouthpiece has no fingering surface.** The phone app normally provides fingering/note generation. For live coding, this is a feature: the Zefiro becomes a pure continuous controller (breath, lip, motion) — exactly what you want to modulate code-generated patterns.
- **Important:** The actual MIDI device name varies (something like `zefiro`, `Artinoise zefiro`, or similar). The agent should discover it programmatically rather than hardcode it.

---

## Environment

- **OS:** Windows (10 or 11). WSL2 installed.
- **Browser needed:** Chrome, Edge, or any other Chromium-based browser. **Not Firefox, not Safari.** Web MIDI works in Chromium on Windows.
- **WSL distro:** unknown — agent should check.
- **Hardware:** USB-C port on laptop, or USB-C to USB-A adapter (user should have this).
- The user is a computational cognitive scientist, comfortable with Linux/Python/terminals. Don't over-explain basics.

---

## Path A (recommended): Windows-native, browser only

This path needs zero WSL. It's the fastest route to a working setup.

### A1. Verify Windows sees the Zefiro

Have the user plug in the Zefiro via USB-C. Then:

- Open **Device Manager → Sound, video and game controllers**. The Zefiro should appear as a USB Audio Device / MIDI device.
- Alternatively, open Chrome and navigate to `chrome://settings/content/midiDevices` to confirm the browser will be allowed to access MIDI.

### A2. Quick MIDI sanity check in the browser

Before touching Strudel or Hydra, confirm Web MIDI sees the device. Create a minimal HTML test page or just use this snippet in the browser console at any page:

```javascript
navigator.requestMIDIAccess({ sysex: false }).then(access => {
  for (const input of access.inputs.values()) {
    console.log('MIDI input:', input.name, input.manufacturer);
    input.onmidimessage = e => console.log(e.data);
  }
});
```

User blows into the Zefiro → console should print a stream of three-byte arrays. CC messages look like `[176, 11, <value 0-127>]` (status byte 0xB0 = CC on channel 1, controller number 11, value).

**Note the exact device name string that prints.** That string is needed for Strudel.

### A3. Strudel integration

URL: `https://strudel.cc`

```javascript
// Replace 'zefiro' with whatever device name the sanity check printed
let z = await midin('zefiro')

// Breath (CC11) drives gain of a kick
$: s("bd*<4 8 16>").gain(z(11))

// Breath sweeps filter cutoff on a pad
$: note("<c2 eb2 g2 bb2>")
    .s("sawtooth")
    .cutoff(z(11).range(200, 4000))
    .resonance(z(1).range(0, 25))   // lip sensor (CC1) → resonance

// Accelerometer tilt (Pro, CC16) → playback speed of hats
$: sound("hh*8").speed(z(16).range(0.5, 2))
```

The `z(N)` calls return the live normalized value of CC N. They update at the Zefiro's native ~80–100 Hz.

**CC numbers above are the defaults but may need adjustment** based on what the device actually sends. Have the agent verify with the sanity check first, and remap via Artinoise's "zefiro Manager" desktop app if needed.

### A4. Hydra integration

URL: `https://hydra.ojack.xyz`

Use the `hydra-midi` helper (loaded via CDN inside the Hydra editor):

```javascript
await loadScript('https://cdn.jsdelivr.net/npm/hydra-midi@latest/dist/index.js')
await midi.start({ channel: '*', input: '*' })
midi.show()   // small on-screen monitor — useful for debugging

// Breath (CC11) → kaleidoscope folds
osc(40, 0.1, 1.2)
  .kaleid(() => cc(11) * 8 + 2)
  .rotate(() => cc(16) * 6.28)   // accelerometer rotation
  .out()
```

The official Hydra docs also include a vanilla Web MIDI console snippet that populates a global `cc[]` array — use that as a fallback if `hydra-midi` has any issues. See `https://hydra.ojack.xyz/hydra-docs-v2/docs/learning/sequencing-and-interactivity/midi/`.

### A5. Running both simultaneously

Open Strudel in one Chrome tab and Hydra in another. Both will independently subscribe to the same MIDI input through the OS. One breath gesture → both tabs respond. No bridge needed.

---

## Path B (optional): WSL Python processing alongside

Only do this if the user wants to log MIDI data, run computational analysis, or do something the browser can't (e.g., Bayesian inference over the breath stream in real time). For pure performance, skip this.

### B1. Reality check on WSL2 + USB

WSL2 has **no native USB device passthrough.** You need `usbipd-win` to forward USB devices from Windows into WSL.

Repo: `https://github.com/dorssel/usbipd-win`

- Install with `winget install usbipd` (PowerShell, admin).
- In WSL: `sudo apt install linux-tools-generic hwdata` and link `usbip` appropriately.
- Then bind + attach the Zefiro:
  ```powershell
  # In admin PowerShell on Windows:
  usbipd list                         # find Zefiro's BUSID
  usbipd bind --busid <BUSID>         # one-time
  usbipd attach --wsl --busid <BUSID> # each time you want it forwarded
  ```
- Inside WSL, the device should now appear under `/dev/snd/` (ALSA) or `/proc/asound/`.

**Warning:** USB MIDI forwarding via usbipd is known to work but can be flaky. If it doesn't work in 15–20 minutes, abandon this path and have the user run Python on Windows directly (next subsection).

### B2. Simpler alternative — Python on Windows directly

Just use Python on Windows (not in WSL) for any MIDI processing. Install `python-rtmidi` and `mido`:

```powershell
pip install mido python-rtmidi
```

Minimal MIDI logger:

```python
import mido, time, csv, sys

ports = mido.get_input_names()
print("Available ports:", ports)
zefiro = next((p for p in ports if 'zefiro' in p.lower()), None)
if not zefiro:
    sys.exit("Zefiro not found")

with mido.open_input(zefiro) as port, open('zefiro_log.csv', 'w', newline='') as f:
    w = csv.writer(f)
    w.writerow(['t', 'type', 'control', 'value'])
    t0 = time.time()
    for msg in port:
        if msg.type == 'control_change':
            w.writerow([time.time() - t0, msg.type, msg.control, msg.value])
            print(msg)
```

This logs every CC to CSV — useful for the user's computational cognitive science work (timing analysis, signal characterization, etc.) without fighting USB forwarding.

### B3. Bridging Python → browser

If you want Python to *process* MIDI and feed transformed values back to Strudel/Hydra, set up a virtual MIDI port on Windows with **loopMIDI** (free, by Tobias Erichsen). Python writes to the virtual port; the browser subscribes to it via Web MIDI alongside the raw Zefiro input.

---

## Diagnostic commands

### On Windows (PowerShell)
```powershell
# List MIDI devices via PowerShell (requires running a short C# snippet, or:)
# Easier: just check Device Manager, or list via Python:
python -c "import mido; print(mido.get_input_names())"
```

### In WSL (after usbipd attach)
```bash
aconnect -l                  # list ALSA MIDI clients
amidi -l                     # list raw MIDI devices
amidi -p hw:1,0,0 -d         # dump raw MIDI from a port (Ctrl-C to stop)
# Or via aseqdump:
aseqdump -p <client:port>
```

### In the browser console
```javascript
// Quick re-check of MIDI device list
navigator.requestMIDIAccess().then(a => [...a.inputs.values()].forEach(i => console.log(i.name)));
```

---

## Troubleshooting

- **Zefiro doesn't appear in Device Manager:** try a different USB-C cable (some are charge-only), or a different port. The Zefiro should not require drivers on Windows 10/11.
- **Web MIDI access denied:** Chrome will prompt the first time. If denied, reset via `chrome://settings/content/midiDevices`. Some pages require HTTPS — both strudel.cc and hydra.ojack.xyz are HTTPS, so this is fine.
- **Device name is empty string or weird Unicode:** use `input.id` instead of `input.name` to identify it programmatically. Strudel's `midin()` accepts a partial name match.
- **CC numbers don't match the defaults:** download Artinoise "zefiro Manager" desktop app, connect Zefiro, inspect/remap CC mappings. Or just adjust the code to whatever CC numbers the sanity check reveals.
- **Pro accelerometer CCs not arriving:** confirm in zefiro Manager that accelerometer output is enabled (may be off by default).
- **Strudel `midin()` returns undefined for a CC:** the value is only populated after the first message on that CC arrives. Blow into the Zefiro first, then re-evaluate the pattern.
- **Choppy / laggy:** close other tabs, especially anything using audio. Web MIDI itself is low-latency; the bottleneck is usually the Web Audio scheduler under load.

---

## Pre-event checklist

To complete tomorrow before the event:

1. [ ] Plug Zefiro in via USB-C; confirm it appears in Windows Device Manager.
2. [ ] Open Chrome → run the Web MIDI sanity-check snippet → confirm CC stream from breath.
3. [ ] Note the exact device name string and the actual CC numbers being sent.
4. [ ] Optionally run "zefiro Manager" to confirm/customize CC mappings.
5. [ ] Open strudel.cc → paste minimal pattern with `midin()` → confirm breath modulates audio.
6. [ ] Open hydra.ojack.xyz → load hydra-midi → confirm breath modulates visuals.
7. [ ] Save a working starter sketch for each (Strudel + Hydra) to local files so they survive a page reload.
8. [ ] If using Pro, repeat with accelerometer CCs.
9. [ ] Confirm USB cable + adapter (if needed) are packed.

---

## Reference URLs

- Strudel MIDI docs: `https://strudel.cc/learn/input-output/`
- Strudel input devices: `https://strudel.cc/learn/input-devices/`
- Hydra MIDI docs: `https://hydra.ojack.xyz/hydra-docs-v2/docs/learning/sequencing-and-interactivity/midi/`
- hydra-midi npm: `https://github.com/arnoson/hydra-midi`
- usbipd-win: `https://github.com/dorssel/usbipd-win`
- Mido (Python MIDI): `https://mido.readthedocs.io/`
- Artinoise Zefiro: `https://www.artinoise.com/zefiro`

---

## What the agent should produce

At minimum:
- A `test_midi.html` or browser-console-paste snippet that proves the Zefiro is being seen.
- A working **Strudel sketch** (saved as a `.txt` or `.md` file the user can paste into strudel.cc) that maps Zefiro breath to at least one audio parameter.
- A working **Hydra sketch** (same idea) mapping breath to at least one visual parameter.
- A short README summarizing the actual device name, the actual CC numbers observed, and any quirks discovered during setup.

Optional if time allows:
- A Python logger that records breath signal to CSV for later analysis.
- A combined Strudel+Hydra "starter set" that's visually and sonically coherent for the algorave.

Bias toward shipping a working minimum first, then iterating. The event is tomorrow.
