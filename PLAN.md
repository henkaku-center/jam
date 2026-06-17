# Henkaku JAM — Plan

## Strudel
- Strudel needs to be working well and robust. When adding a new Strudel window, it should be populated with a very simple default pattern so it doesn't sound overwhelming — e.g. a metronome-like closed hihat every beat.
- (not essential) It would be nice if JAM also has the Strudel reference and sounds, and can display a list of sounds with previews of what they sound like (like the Strudel REPL).
- Strudel can do a lot of things well. Any elements added should initially try to interact with Strudel, or be UI to Strudel elements that may be harder to access.

## MIDI Input / Output
- We want to control elements with external MIDI controllers. Assigning the controller and channel should be simple and intuitive.
- Ideally these controllers could be connected to any remote machine. If that's hard or causes issues, they could be connected to the 'central' machine.

## Hydra
- Hydra needs to be robust and visually very present.
- There should only be one Hydra code window and the visualisation should take the full screen as much as possible.
- Any other windows should be as transparent as possible to show the visualisations.

## Sampler
- We'd like to have a sampler that can record a sound, or load a sound from a local computer or online source.
- The interface should display the waveform and allow cutting the sample, and give the sound a name.
- These cuts should be addressable from any other Strudel window in the jam — e.g. `name:0` plays the first cut of a sample called `name`.

## Bounce
- We'd like to export a 30-second snippet of the overall sound playing at the moment, along with a screenshot image of the current state of the screen — as a souvenir, not a production tool.

## Medium Priority
- Presence avatars — basic cursor sharing so collaborators can see what others are doing on the canvas.
- Element error overlay — when an element crashes, show the error directly on that element on the canvas without affecting others.

## Low Priority
- Focus mode (Caps Lock) — test whether Caps Lock feels natural as a hold-to-solo key in a real jam; consider adding a visible on-canvas indicator when Focus Mode is active.

---

## Later / Extras
- Import Mutable Instruments modules (Clouds etc.): https://pichenettes.github.io/mutable-instruments-documentation/modules/clouds/open_source/ and https://github.com/pichenettes/eurorack
- Connect / implement Kabelsalat: https://codeberg.org/froos/kabelsalat/ and https://kabel.salat.dev
- Roland 909 + interface
- Load VST plugins
- Video sampler
