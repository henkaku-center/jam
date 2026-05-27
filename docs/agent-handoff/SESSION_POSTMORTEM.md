# Agent Handoff Postmortem

This branch was created after a Claude Code session where the user had Jam open and expected live changes without refreshing the browser, pasting devtools snippets, or restarting the server.

The work mostly succeeded, but the session exposed two repo-level problems:

1. There was no documented agent-facing way to mutate the running Yjs workspace.
2. The easiest hot-reload trick was bumping an element prompt, which can re-run codegen and overwrite hand-written element files.

The main lesson is that agents need a safe control plane for the live app. Editing files is not enough in Jam, because the user is usually watching and listening to a running collaborative session.

## What Failed

- Editing `workspace_layout.json` is unreliable because the server persists the live Yjs doc back to disk.
- Telling the user to use devtools breaks the collaboration flow.
- Restarting or refreshing interrupts audio, browser state, the shared PTY terminal, and controller connections.
- Bumping `prompt` as a reload signal can call `/api/compile` with `forceCompile: true`, which may replace a hand-authored file with generated fallback code.

## What Changed

The repo now exposes finite HTTP endpoints under `/api/workspace/*` for live mutations and a codegen-free reload endpoint:

- `POST /api/workspace/elements`
- `PATCH /api/workspace/elements/:id`
- `DELETE /api/workspace/elements/:id`
- `POST /api/workspace/elements/:id/reload`
- `GET /api/workspace/state`

Elements now have an `authored` lifecycle marker:

- `codegen`: prompt changes may regenerate source.
- `hand`: disk file is source of truth and forced compiles reuse it unless explicitly overridden.

Agents should use these endpoints instead of ad hoc Yjs scripts or prompt-bump reloads.
