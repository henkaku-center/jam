# Infrastructure Gaps: What `jam` Needs for Agent-Friendly Iteration

Companion to `SESSION_POSTMORTEM.md`. Where the post-mortem describes what
happened, this doc describes what the repo should grow to prevent it from
happening again.

Audience: an implementer-agent (or human) tasked with making this repo
agent-navigable. Each gap is stated with the symptom, the underlying cause,
and a concrete proposed fix sized to a single PR.

---

## Gap 1: No agent-facing mutation API for the running app

### Symptom

An agent working on the repo while the user has it open in a browser has no
way to mutate the running workspace (add element, remove element, change
position, change BPM, mute, etc.) from outside the browser. Every change
requires one of:

- A devtools paste (rejected by users actively jamming).
- A page refresh (drops audio context, loses recording state).
- A server restart (drops PTY session, WebSockets, controller connections).
- Editing `workspace_layout.json` (silently overwritten by Yjs persistence).
- A hand-rolled Yjs WebSocket client script (the path used this session;
  works but takes 3+ turns to write each time).

### Cause

The server holds the canonical Yjs doc (`server.js:45`) but exposes only
two write paths to it: codegen (`/api/compile`) and indirectly via WebSocket
y-protocol messages. There is no REST-style "mutate the workspace" surface.

### Proposed fix

A small HTTP API that mirrors the Yjs operations an agent would want to
perform. Each route mutates `elementsMap` / `clockMap` / `globalBusMap`
inside `doc.transact(...)` so the change broadcasts to all peers.

```
POST   /api/workspace/elements           { id?, filePath, type, prompt, x?, y?, w?, h? }
DELETE /api/workspace/elements/:id
PATCH  /api/workspace/elements/:id       { x?, y?, width?, height?, prompt? }
GET    /api/workspace/elements           → full layout snapshot
POST   /api/workspace/elements/:id/reload  → forces re-fetch *without* codegen (see Gap 2)
POST   /api/workspace/clock              { bpm?, startTime? }
POST   /api/workspace/global-bus/:key    { value }
```

One precedent: this session added `/api/add-element` as a stop-gap. Generalize
it into the suite above and document it in CLAUDE.md as **the agent control
plane**.

### Why this matters

It collapses every "make it happen in the running browser" task from "fumble
for 3 turns" to "one curl." It also gives the agent a stable contract that
won't break when internal Yjs details change.

---

## Gap 2: The hot-reload mechanism re-invokes codegen, destroying hand-written code

### Symptom

Bumping an element's `prompt` field in Yjs to trigger hot-reload causes the
server to run codegen against the new prompt. If the element was
hand-authored (not generated), the file on disk is silently overwritten with
whatever the codegen provider returns. During this session, a recorder
element was replaced with drum-sequencer code mid-iteration.

### Cause

Two element lifecycles share one trigger:

| Lifecycle | Source of truth | What "hot-reload" should mean |
|---|---|---|
| Codegen-authored | The `prompt` in Yjs | Re-generate the file from the new prompt |
| Hand-authored | The file on disk | Re-fetch the file, no codegen |

`/api/compile` collapses them: any client-side reload sets `forceCompile`
based only on whether the prompt changed, and codegen runs unconditionally
when `forceCompile: true`. The server's "reuse existing source" branch
(`server.js:223`) only fires when `forceCompile: false`.

### Proposed fix

Two changes, both small:

1. **Mark elements as hand-authored.** Add an `authored: 'codegen' | 'hand'`
   field to the element layout (default `'codegen'` for backward compat).
   When `authored === 'hand'`, `/api/compile` always reuses the file on disk
   regardless of `forceCompile`.

2. **Add a codegen-free reload trigger.** A new field like
   `layout.reloadToken` (or just bumping a `version` integer) that the
   client observes the same way it observes prompt changes, but which sets
   `forceCompile: false`. Or, equivalently, expose
   `POST /api/workspace/elements/:id/reload` per Gap 1 which the server
   handles by broadcasting a y-doc-level signal.

Combined, an agent that edits a hand-authored file can call the reload
endpoint and the change propagates without risk of destroying the file.

### Why this matters

This was the most expensive mistake of the session. It's structural — any
future agent will hit it the same way. Once both lifecycles are explicit, the
guardrail is automatic.

---

## Gap 3: No machine-readable element contract

### Symptom

The Micro-App Contract (DESIGN.md §2) is prose. An agent writing a new
element from scratch has to infer:
- What goes in `ctx` (audioCtx, audioOut, domRoot, clock, bus,
  sendControllerData)
- What `clock.onTick` callbacks receive (`{step, time, duration, bpm}`)
- That `domRoot` is a Shadow Root
- That `audioOut` is the harness's gain node, not `audioCtx.destination`
- That `prevState` is the return of the previous instance's `getState()`
- That `destroy()` is best-effort — the harness will tear down tracked
  resources regardless
- Naming convention: `elem_<id>_<type>.js`

This session, the agent got it right by reading other elements as examples.
That's a fragile contract.

### Proposed fix

A TypeScript declaration file at `public/elements/element-contract.d.ts`
that defines:

```typescript
export interface ElementContext {
  audioCtx: AudioContext;
  audioOut: AudioNode;
  domRoot: ShadowRoot;
  clock: {
    bpm: number;
    startTime: number;
    onTick(cb: (info: { step: number; time: number; duration: number; bpm: number }) => void): () => void;
  };
  bus: {
    pub(key: string, val: unknown): void;
    sub(key: string, cb: (val: unknown) => void): () => void;
    pubGlobal(key: string, val: unknown): void;
    subGlobal(key: string, cb: (val: unknown) => void): () => void;
  };
  sendControllerData(data: unknown): void;
}

export interface ElementRuntime {
  getState?(): unknown;
  destroy?(): void;
  update?(tick: number): void;
}

export type ElementSetup = (ctx: ElementContext, prevState: unknown) => ElementRuntime | Promise<ElementRuntime>;
```

Plus a canonical reference element at
`public/elements/_template_element.js` that exercises every contract field
in a working minimal example. Agents are likely to read it; humans can too.

The naming convention (`elem_<id>_<type>.js`) should either be enforced (the
server rejects non-conformant filenames) or eliminated (the type goes in
Yjs only, never the filename). Right now it's optional, which is the worst
state — it looks load-bearing but isn't.

### Why this matters

Agents that write elements correctly the first time don't need a debugging
round-trip. Elements are this repo's primary creative surface; lowering the
barrier to authoring them is high-leverage.

---

## Gap 4: No way to differentiate read-only state from agent-mutable state

### Symptom

`window.activeElements`, `window.ydoc`, `window.elementsMap` are all exposed
on the global for "remote diagnostics/debugging" (client.js:149-151). The
session leaned heavily on these as devtools entry points. An agent has no
way to know from outside the browser:
- What the current element list is
- What the BPM is
- Whether playback is muted
- Which elements are currently focused

It can read `workspace_layout.json` for a stale snapshot, but anything
runtime-only (selection state, mute state, current audio levels) is opaque.

### Proposed fix

A read endpoint that returns a JSON snapshot of the runtime state the agent
might care about:

```
GET /api/workspace/state
→ {
    elements: [...],
    clock: { bpm, startTime, currentBeat },
    mutes: { master, synths },
    focused: 'elem_xyz' | null,
    peers: 3,
  }
```

The server already has access to most of this (the Yjs doc); for browser-only
state (mutes, focused element) the host page would post updates back to a
new server endpoint or expose them through awareness states in Yjs.

### Why this matters

Without it, agent observation of the running app is limited to "ask the
user." Even a partial snapshot would let an agent self-verify after a
mutation ("I removed all synths, server confirms 0 synths in elementsMap").

---

## Gap 5: No protection against agent-vs-user conflicting writes

### Symptom

The user is actively dragging elements, editing prompts, recording audio.
An agent making concurrent writes to Yjs (via Gap 1's API, say) could race
the user. Yjs's CRDT model handles the merge correctly at the doc level, but
there's no UX signal for "an agent just changed this thing while you were
touching it."

### Proposed fix

Tag agent-originated Yjs transactions with a transaction origin (Yjs
supports this natively):

```js
doc.transact(() => { elementsMap.set(...) }, { origin: 'agent' });
```

The client observes the origin and shows a transient toast:
"Agent added element 'voice recorder' at (400, 80)." Same for deletes,
moves, prompt changes.

This is essentially mechanical (5 lines server-side, a `notify()` UI
helper client-side) and makes agent activity legible to the user without
requiring the agent to narrate everything in chat.

### Why this matters

The "buddy, I don't see it" moment in this session would have been visible
from the toast even if my synced layout change hadn't actually propagated.
Diagnostic by default.

---

## Gap 6: Element files don't survive codegen-prompt mismatches

### Symptom

(Variant of Gap 2.) The mock codegen provider (`getMockCode`) inspects the
prompt for keywords like "lfo," "sequencer," "drum" and picks a template.
A prompt like "voice recorder, ska upbeats" matches nothing and falls back
to a default template — which on this session, returned drum sequencer code.
The user's intent ("a voice recorder") was completely lost in translation.

### Cause

The mock generator is a fallback for when no real codegen provider is
available, but it produces actively wrong code rather than erroring. A
prompt with no template match should produce a *stub that errors clearly*,
not a confidently incorrect different element.

### Proposed fix

Two-part:

1. `getMockCode` returns an explicit unsupported-prompt stub when no
   template matches, e.g. an element that renders an error card saying
   "Mock codegen has no template for: <prompt>. Edit the file manually
   or configure a real CODEGEN_PROVIDER."

2. Distinguish the "first-time generation" path from the "regeneration" path
   in `/api/compile`. Regeneration of a hand-authored file should require an
   explicit `allowOverwrite: true` flag, defaulting to false. This is a
   defense in depth on top of Gap 2's `authored` field.

### Why this matters

Silent file replacement is the kind of bug that erodes agent trust in its
own tools. The agent can't tell if its file write succeeded — it has to
re-read after every operation to verify. Making this rare AND loud makes
the entire toolchain feel safer.

---

## Suggested implementation order

If implementing all of these in one effort, I'd sequence as:

1. **Gap 2** (codegen footgun fix). Highest blast radius — silently
   destroying agent work is the worst failure mode.
2. **Gap 1** (agent control plane). Biggest single ergonomic win. Subsumes
   the one-off `/api/add-element` from this session.
3. **Gap 4** (read endpoint). Quick to add once Gap 1 exists.
4. **Gap 5** (origin tags). Mechanical, makes Gaps 1+2 user-legible.
5. **Gap 3** (element contract). Less urgent — elements work today — but
   compounds value with every new element written.
6. **Gap 6** (mock-codegen guardrails). Lowest priority if Gap 2 is in
   place, but cheap insurance.

After 1+2 alone, the session this document describes would have completed in
roughly half the turns with zero file-loss incidents.

---

## What NOT to do

A few attractive-looking fixes that would make things worse:

- **Don't add a "lock file" mechanism to prevent codegen from touching
  certain elements.** That's a bureaucratic workaround for Gap 2's design
  flaw; fix the design instead.
- **Don't expose `eval` or arbitrary-JS endpoints "for the agent to use."**
  That puts the agent on the same footing as a malicious request and
  cripples the ability to validate or audit changes. The Gap 1 API surface
  should be specific, typed, and finite.
- **Don't try to make hot-reload automatic on every file save.** Bar-aligned
  reload is a deliberate musical feature, not just a developer convenience.
  Agent-triggered reloads should still respect the bar alignment.
- **Don't merge `workspace_layout.json` and the element files into a single
  "scene" file.** The split is correct: layout is per-instance state, files
  are reusable code. The persistence/sync story is fine as-is.

---

## Open questions the next agent should resolve with the user

- Should hand-authored elements live in a separate directory
  (`public/elements/handcrafted/`) to make the lifecycle distinction visually
  obvious in the filesystem, or stay co-located with a metadata flag?
- Should the agent control plane authenticate? (Currently the assumption is
  local-host-only-no-auth, which matches the rest of the repo.)
- Is there appetite for an in-app "agent activity feed" panel that shows
  recent agent mutations with undo buttons?
