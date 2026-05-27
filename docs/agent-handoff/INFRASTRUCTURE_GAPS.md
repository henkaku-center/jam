# Infrastructure Gaps For Agent-Friendly Iteration

This document records the recurring friction points for agents working on Jam while a user has the app open.

## Solved In This Repo

### Safe Workspace Mutation API

Agents can mutate the live Yjs workspace through `/api/workspace/*` instead of using devtools, refreshing the page, or writing one-off Yjs scripts.

### Codegen-Free Reload

`POST /api/workspace/elements/:id/reload` bumps `reloadToken`. Clients observe it and re-fetch the element file from disk with `forceCompile: false`.

### Hand-Authored Element Guardrail

`authored: "hand"` tells `/api/compile` to reuse the existing file even when a prompt change would normally force codegen. This prevents silent loss of manual edits.

### Element Contract

`public/elements/element-contract.d.ts` and `_template_element.js` provide a concrete target for agents generating or editing elements.

## Still Open

- Agent-originated mutations are not yet shown as in-app toasts.
- Runtime-only browser state such as current focus, mute state, and audio levels is only partially visible to the server.
- Clip/audio blob persistence for recorder-style elements is not defined.
- Element filename conventions are still soft. The runtime relies on `layout.type`, while filenames often include `_synth`, `_seq`, etc.

## Agent Rule Of Thumb

Before changing Jam, ask: "How will this reach the running browser without disrupting the session?"

Usually the answer should be:

1. Edit or create the element file.
2. Ensure the layout has `authored: "hand"` if the file was manually written.
3. Call `/api/workspace/elements/:id/reload`.
4. Verify with `/api/workspace/state` or Playwright.
