#!/usr/bin/env node
import { watch, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DEBOUNCE_MS = 2000;
const WATCHED_DIRS = ['src'];
const WATCHED_FILES = ['index.html', 'vite.config.ts', 'package.json', 'tsconfig.json', 'CLAUDE.md'];
const STAGE_PATHS = ['src/', 'index.html', 'vite.config.ts', 'package.json', 'tsconfig.json', 'CLAUDE.md'];

let timer = null;
let pushing = false;

function git(cmd) {
  return execSync(cmd, { cwd: ROOT, encoding: 'utf8', stdio: 'pipe' }).trim();
}

function gitSafe(cmd) {
  try { return { ok: true, out: git(cmd) }; }
  catch (e) { return { ok: false, out: e.stderr || e.message }; }
}

function sync() {
  if (pushing) return;
  pushing = true;
  try {
    git(`git add ${STAGE_PATHS.join(' ')}`);
    const staged = gitSafe('git diff --cached --quiet');
    if (staged.ok) { pushing = false; return; }

    const ts = new Date().toISOString().replace(/\.\d+Z/, '');
    git(`git commit -m "sync: ${ts} [auto]"`);
    console.log(`[sync] committed at ${ts}`);

    const push = gitSafe('git push origin main --quiet');
    if (push.ok) {
      console.log('[sync] pushed');
      pushing = false;
      return;
    }

    console.log('[sync] push failed, pulling and retrying...');
    const rebase = gitSafe('git pull --rebase origin main --quiet');
    if (!rebase.ok) {
      console.log('[sync] rebase conflict, aborting rebase and trying merge...');
      gitSafe('git rebase --abort');
      gitSafe('git pull --no-rebase origin main --quiet');
    }

    const retry = gitSafe('git push origin main --quiet');
    if (retry.ok) console.log('[sync] pushed after rebase');
    else console.warn('[sync] push still failed, will retry on next change');
  } catch (e) {
    console.warn('[sync] error:', e.message);
  }
  pushing = false;
}

function scheduleSync() {
  clearTimeout(timer);
  timer = setTimeout(sync, DEBOUNCE_MS);
}

for (const dir of WATCHED_DIRS) {
  const p = resolve(ROOT, dir);
  if (existsSync(p)) {
    watch(p, { recursive: true }, (_, f) => {
      if (f && !f.includes('.claude')) scheduleSync();
    });
  }
}

for (const file of WATCHED_FILES) {
  const p = resolve(ROOT, file);
  if (existsSync(p)) watch(p, () => scheduleSync());
}

console.log('[sync] watching for changes...');
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
