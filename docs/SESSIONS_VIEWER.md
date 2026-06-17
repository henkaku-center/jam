# Sessions Viewer

`sessions/index.html` is a static page that displays archived jam session logs — agent conversations, tool calls, and token stats — browsable in a sidebar UI.

It is deployed automatically to GitHub Pages at:

```
https://henkaku-center.github.io/jam/sessions/
```

No server required. The page fetches data directly from committed files in the repo.

## How it works

- `sessions/manifest.json` — generated index of all sessions, inlining each session's README. The page loads this first.
- `sessions/YYYY-MM-DD/codex/*.jsonl` — raw Codex rollout files, fetched on demand and parsed client-side.
- `.github/workflows/pages.yml` — deploys the repo to GitHub Pages on every push to `main`.

## After archiving a new jam session

When you commit a new session under `sessions/YYYY-MM-DD/`, the viewer won't pick it up until you regenerate the manifest:

```bash
npm run sessions:manifest
git add sessions/manifest.json
git commit -m "Update sessions manifest"
git push
```

GitHub Pages redeploys automatically within a minute or two of the push.

The archive commit itself (the `.jsonl` files and `manifest.tsv`) and the manifest update can be squashed into one commit if you prefer.

## Expected session directory layout

```
sessions/
  YYYY-MM-DD/
    README.md          # short description shown in the sidebar
    manifest.tsv       # tab-separated index: source, mtime, size, path
    codex/
      rollout-*.jsonl  # one file per Codex session
    claude/            # optional, same structure
      rollout-*.jsonl
```

The `manifest.tsv` header row is:

```
source	mtime_jst	size_bytes	archived_path	original_path
```

`archived_path` must be relative to the repo root (e.g. `sessions/2026-05-28/codex/rollout-….jsonl`).

## Regenerating the manifest script

`scripts/generate-sessions-manifest.js` reads every `sessions/*/manifest.tsv` and `README.md` and writes `sessions/manifest.json`. Run it whenever sessions are added or updated:

```bash
node scripts/generate-sessions-manifest.js
# or
npm run sessions:manifest
```
