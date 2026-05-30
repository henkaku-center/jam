#!/usr/bin/env node
// Regenerate sessions/manifest.json from sessions/*/manifest.tsv and README.md files.
// Run: node scripts/generate-sessions-manifest.js
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sessionsDir = join(root, 'sessions');

const dates = existsSync(sessionsDir)
  ? readdirSync(sessionsDir).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse()
  : [];

const sessions = dates.map(date => {
  const dir = join(sessionsDir, date);
  const readmePath = join(dir, 'README.md');
  const manifestPath = join(dir, 'manifest.tsv');

  const readme = existsSync(readmePath) ? readFileSync(readmePath, 'utf8') : '';
  const description = readme.split('\n').filter(l => l.trim() && !l.startsWith('#')).slice(0, 2).join(' ');

  const rollouts = [];
  if (existsSync(manifestPath)) {
    const rows = readFileSync(manifestPath, 'utf8').split('\n').filter(Boolean).slice(1); // skip header
    for (const row of rows) {
      const [source, mtime, sizeBytes, archivedPath] = row.split('\t');
      if (!archivedPath) continue;
      // path relative to sessions/ dir so it works as a relative fetch from sessions/index.html
      const relativePath = archivedPath.replace(/^sessions\//, '');
      rollouts.push({
        source: source || 'codex',
        mtime: mtime || '',
        sizeBytes: Number(sizeBytes) || 0,
        filename: archivedPath.split('/').pop(),
        path: relativePath,
      });
    }
  }

  return { date, description, readme, rollouts };
});

const manifest = { generated: new Date().toISOString(), sessions };
const outPath = join(sessionsDir, 'manifest.json');
writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Wrote ${outPath} — ${sessions.length} session(s), ${sessions.reduce((n, s) => n + s.rollouts.length, 0)} rollout(s)`);
