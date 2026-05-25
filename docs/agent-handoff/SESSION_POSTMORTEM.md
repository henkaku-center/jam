# Session Post-Mortem: Agent Working on `jam` Repo

This document records one agent's experience working in this repo so a second
agent can analyze the friction points. The work itself succeeded; the
friction was about **how the repo communicates its own affordances to an
agent**. The user's framing: "the issue is with the code repo and the way it
shared information with you."

Read this alongside `INFRASTRUCTURE_GAPS.md` (companion doc) which translates
this narrative into concrete requirements for a future agent to implement.

---

## What the session was

A user pair-programming live on a running Jam instance (`npm start` already in
the foreground), asking for incremental features in a browser tab they were
actively viewing. Each request had the implicit constraint: **don't make me
refresh, don't make me paste anything into devtools, don't make me restart the
server**. That constraint was never written down anywhere in the repo, but it
was the dominant tension throughout.

Requests, in order:
1. Pause the music.
2. Map spacebar to set global volume to zero.
3. Set all synth volumes to zero.
4. Remove all the synths.
5. (Reaction to a proposed devtools snippet) "There should be a way to change
   it and hot reload without me refreshing or using devtools."
6. Add a spoken-word Shatner element that reads a webpage. *(Cancelled mid-build.)*
7. Create a recording interface to add my own voice.
8. "I don't see it." → "Buddy, I don't see it. You need to make it happen."
9. Add clip editing and longer recording — actual symptom: "just makes a
   click sound" when looped.

---

## What the repo told me up front

`CLAUDE.md` is unusually good. It surfaces the non-obvious architecture
explicitly:

- Host vs. thin-controller is one codebase, flipped by `?host=true`.
- Three WebSocket channels (`/yjs`, `/controller`, `/agent-terminal`) on one
  HTTP server.
- Element lifecycle uses `new Function()` not dynamic `import()` (GC reason
  given).
- Hot-reload is **bar-aligned** and triggers when prompt/filePath changes in Yjs.
- Element harness sandbox tracks every audio node, listener, interval, clock
  sub for guaranteed teardown.
- Two-tier SignalBus, auto-namespaced.
- The "+ Add" button uses codegen; element files in `public/elements/` are
  pure ESM with a Micro-App Contract.

Plus an explicit warning: **"edits to `public/elements/*.js` are not picked
up by an existing in-browser instance. Trigger a hot-reload by bumping the
element's `prompt` in `workspace_layout.json`"**.

That last sentence is where things went sideways. More below.

---

## What worked well

- **Static reads were fast.** `grep` for `masterGain`, `keydown`, `clockCallbacks`,
  `elementsMap.delete` — the codebase is small enough that I could trace any
  feature in 2–3 reads. CLAUDE.md telling me to read `DESIGN.md` first would
  have helped if I'd done it, but I never needed to: variable names were
  self-explanatory.
- **Adding the spacebar mute, the `M` synth-mute, the `Delete` keybinding,
  the `addElement`/`removeElementsByType` helpers** all landed correctly on
  the first edit. The shape of the existing keydown handler (line 928) made
  it obvious where to drop new bindings, and the existing focus-mode mute
  code (line 958) gave me a working pattern to copy.
- **The agent terminal + xterm bridge + `window.activeElements` exposure**
  meant I had several plausible escape hatches for "do this from inside the
  page without devtools." I leaned on `window.removeSynths()`,
  `window.addElement()` etc. as a deliberate ergonomic affordance — symmetric
  helpers callable from the agent terminal.

---

## Where I got stuck, and why

### Friction 1: I couldn't reach the running browser

When the user said "set all the synth volumes to zero" or "remove all the
synths," the most natural fulfillment was a single mutation on `activeElements`
or `elementsMap` from inside the running page. I have no tool to drive their
browser. My options collapsed to:

- Tell them to paste in devtools (rejected: "I don't want to use devtools").
- Edit a file → make them refresh (rejected: "don't make me refresh").
- Edit `workspace_layout.json` (silently overwritten by Yjs persistence loop).
- **Hit the live Yjs doc from outside** — eventually worked, but I had to
  write a custom one-shot Node script (`scripts/add-recorder.mjs`) using
  `WebsocketProvider` + `WebSocket` polyfill, on the fly, to insert one
  element. That's three turns of fumbling for what should be a one-line tool
  call.

The repo has **no documented agent-facing control surface**. Every mutation I
wanted to make was technically possible — Yjs is open over WebSocket on
localhost, the server has the doc in memory — but reaching it required
me to invent the path each time.

### Friction 2: The hot-reload mechanism is booby-trapped for hand-written code

The biggest single mistake of the session, in retrospect, was bumping the
prompt to force a hot-reload of my hand-written recorder element. I'd done it
once successfully (to get the user to see the element in the first place,
before realizing the helpers in `client.js` required a refresh to load).

When I tried the same trick to push my recorder *code* update, the server's
`/api/compile` saw `forceCompile: true` (because the host saw a prompt change
in Yjs), ran codegen against the prompt `"voice recorder, ska upbeats
(r4538)"`, and the mock provider returned **drum step sequencer code**, which
the server wrote to disk, **silently overwriting my recorder file**.

CLAUDE.md says hot-reload triggers on prompt change. It does not say
**prompt change re-invokes codegen, which can destroy hand-written element
files**. The honest model is:

- **Codegen-authored elements**: prompt is the source of truth. Bumping it
  asks the LLM to re-author. Existing file is treated as a draft, not a
  spec.
- **Hand-authored elements** (the case I was in): prompt is irrelevant. The
  file is the source of truth. Any path that calls `/api/compile` with
  `forceCompile: true` is a footgun.

These are two different lifecycles wearing the same hat. The repo has no way
to mark a file as hand-authored / protected from codegen.

### Friction 3: The only hot-reload path I had access to was the one that destroys files

Once I'd written the recorder file with the click-fix, I needed to push it
to the live browser. My options:

- Bump prompt → file gets clobbered by codegen (Friction 2).
- Ask user to refresh → violates the "no refresh" constraint.
- Toggle `filePath` → same thing, triggers re-instantiate which calls
  `/api/compile` which (with `forceCompile: false` and existing file on disk)
  *would* serve the file as-is. Worth trying. Didn't think of it in time.
- Send a synthetic Yjs message that triggers re-instantiate without prompt
  change → no such message type exists.
- Send a custom WebSocket message on `/controller` → that channel exists for
  raw MIDI/slider data; there's no message router that says "re-instantiate
  element X."

The "right" answer in this architecture would be: **a hot-reload that
re-fetches the file from disk without touching codegen**. The infrastructure
to do this is mostly already there (`/api/compile` with `forceCompile: false`
serves from disk), but no client-side trigger exposes that path independently
of a prompt change.

### Friction 4: Element file naming forces type into the path

`elem_<id>_<type>.js`. Cute, but it means changing an element's type (e.g.,
synth → rec) requires renaming the file, which means the `filePath` in Yjs
no longer matches, which means I either edit Yjs *and* rename the file
atomically (no tool for that), or accept the type tag becoming wrong.

For the recorder I named it `elem_voicerec01_rec.js` and registered with
`type: 'rec'`. This worked, but the `_rec` part of the filename is invisible
to humans reading `workspace_layout.json` and irrelevant to the runtime — it
exists only to satisfy a soft naming convention I inferred from the other
files. Future agents will either guess wrong or skip the convention silently.

### Friction 5: The session had two competing "make it happen" pressures

Several times the user wanted *immediate visible result in their browser*
("buddy, I don't see it"). The same user wanted *no destructive shortcuts*
("don't push to the agent terminal what I didn't ask for"; "ask before
multi-file changes"). These pressures point opposite directions:

- Fast-acting paths (write straight to Yjs, restart the server, etc.) are
  the easiest way to deliver a visible result.
- Cautious paths (ask, confirm, surface the change) feel slow.

I think I navigated this roughly correctly — I asked before bulk-deleting
synths, I didn't restart the server when I could write a Yjs client script
instead — but the lack of safe in-band tools meant the cautious path was
*always* slower than it had to be.

### Friction 6: I didn't always read the right file first

When the user first asked for the recorder, I designed it bottom-up before
re-reading the Micro-App Contract section of DESIGN.md. The element worked
on the first try anyway (the contract is mostly intuitive), but I got
*lucky*. A future agent might not. The repo would benefit from a
machine-readable schema for the contract (TypeScript types, JSON schema,
or even a checked example).

---

## What I'd tell the next agent if I could leave one note

**The constraint to optimize for is "user keeps their browser tab open,
their audio uninterrupted, their Yjs state intact."** Every architectural
decision in this repo either supports that (the Yjs sync, the harness
teardown, bar-aligned reload, server-side persistence) or undermines it
(the codegen-on-prompt-change footgun, the lack of in-band mutation tools,
the file naming friction). The supporting half is excellent; the
undermining half is what made the session feel chaotic.

If you're an agent reading this and about to make a code change in this
repo, your first question should not be "where does this code live" — the
codebase is small, you'll find it. Your first question should be **"how do
I push this change into the running app without breaking my user's flow?"**
Today, the answer is "fumble." Tomorrow, hopefully, it'll be a tool call.

---

## Session metadata

- Agent: Claude Code (Opus 4.7, 1M context)
- Date: 2026-05-25
- Files touched: `public/client.js`, `server.js`,
  `public/elements/elem_voicerec01_rec.js` (new),
  `scripts/add-recorder.mjs` (new), `scripts/reload-recorder.mjs` (new).
- New features shipped: spacebar mute toggle, `M` synth-mute toggle,
  `Delete` key for focused-element removal, `window.addElement` /
  `window.removeElementsByType` / `window.removeSynths` helpers,
  `/api/add-element` server endpoint, voice recorder element with
  waveform trim editor and ska upbeat playback.
- Known regressions: none.
- Outstanding TODOs noted but not done: server-side audio clip persistence
  (clips currently die on browser refresh).
