# Agent Worktrees

The live jam checkout should stay the source of truth for the room. Agents should build and test in isolated git worktrees, then promote finished changes into the live checkout for hot reload and commit.

## Ports

The live server defaults to `PORT=3000`. Agent worktrees use their own ports, usually starting at `3001`, so an agent can run `npm start` without colliding with the live room.

If an agent says port `3000` is occupied and tries `3001`, that means it attempted to start another dev server while the live jam was already running. That is expected, but it should be explicit: the agent should have `PORT=3001` and `JAM_BASE_URL=http://localhost:3001` in its environment.

## Manual Workflow

Create an isolated worktree:

```bash
npm run agent -- create alice 3001
```

Start that agent's private server:

```bash
cd ../jam-agent-worktrees/alice
PORT=3001 npm start
```

Validate before promotion:

```bash
npm run agent -- validate ../jam-agent-worktrees/alice --full
```

Promote into the live checkout:

```bash
npm run agent -- promote ../jam-agent-worktrees/alice
```

Promote and commit:

```bash
npm run agent -- promote ../jam-agent-worktrees/alice --commit
```

Promotion applies the agent diff to the live checkout, runs quick validation, asks the live server to reload changed element files when possible, and optionally commits only the promoted paths.

## Embedded Terminal Workflow

By default, each browser-connected agent terminal is launched in a fresh git worktree under `../jam-agent-worktrees`. The terminal receives:

- `PORT`: private dev server port for that agent
- `JAM_BASE_URL`: private dev URL, for smoke tests
- `JAM_LIVE_BASE_URL`: live room URL, defaulting to the server on port `3000`
- `JAM_AGENT_ID` and `JAM_AGENT_BRANCH`: metadata for commits and handoff

Set `AGENT_WORKTREE_MODE=off` to make embedded terminals run in the live checkout, which is useful only for debugging.

## Commit Hooks

Install repo hooks once:

```bash
npm run agent -- install-hooks
```

The hooks run quick validation before commits and append jam metadata trailers (`Jam-Agent`, `Jam-Elements`, `Jam-Session`) to commit messages when the corresponding environment variables are set.
