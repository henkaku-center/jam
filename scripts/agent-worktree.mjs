#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawnSync } from 'node:child_process';

let repoRoot = process.cwd();
repoRoot = run('git', ['rev-parse', '--show-toplevel'], { capture: true }).trim();

function usage() {
  console.error(`Usage:
  npm run agent -- create <name> [port]
  npm run agent -- validate [worktree-path] [--full]
  npm run agent -- promote <worktree-path> [--commit]
  npm run agent -- install-hooks

Examples:
  npm run agent -- create alice 3001
  npm run agent -- validate ../jam-agent-worktrees/agent-abc --full
  npm run agent -- promote ../jam-agent-worktrees/agent-abc --commit
`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    env: { ...process.env, ...(options.env || {}) }
  });

  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    throw new Error(detail || `${command} ${args.join(' ')} failed`);
  }

  return result.stdout || '';
}

function sanitize(value) {
  return String(value || 'agent')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'agent';
}

function canListen(port) {
  return new Promise(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}

async function pickPort(start) {
  for (let port = start; port < start + 100; port += 1) {
    if (await canListen(port)) return port;
  }
  throw new Error(`No free port found from ${start} to ${start + 99}`);
}

function listCheckableFiles(root) {
  const candidates = [
    'server.js',
    'playwright.config.js',
    'public/client.js',
    'scripts/jamctl.mjs',
    'scripts/live-smoke.mjs',
    'scripts/agent-worktree.mjs'
  ];

  const testDir = path.join(root, 'tests', 'e2e');
  if (fs.existsSync(testDir)) {
    for (const name of fs.readdirSync(testDir)) {
      if (/\.(mjs|js)$/.test(name)) candidates.push(path.join('tests', 'e2e', name));
    }
  }

  return candidates.filter(file => fs.existsSync(path.join(root, file)));
}

function validate(worktreePath, full = false) {
  const root = path.resolve(worktreePath || repoRoot);
  console.log(`[validate] ${root}`);
  run('git', ['diff', '--check'], { cwd: root });

  for (const file of listCheckableFiles(root)) {
    run('node', ['--check', file], { cwd: root });
  }

  if (full) {
    run('npm', ['test'], {
      cwd: root,
      env: {
        CODEGEN_PROVIDER: 'mock',
        AGENT_TERMINAL_PROVIDER: 'mock',
        GEMINI_API_KEY: ''
      }
    });
  }
}

async function create(name, explicitPort) {
  const slug = sanitize(name);
  if (!slug) throw new Error('create requires <name>');

  const targetRoot = path.resolve(repoRoot, '..', 'jam-agent-worktrees');
  const target = path.join(targetRoot, slug);
  const branch = `agent/${slug}`;
  const port = explicitPort ? Number(explicitPort) : await pickPort(3001);
  if (!Number.isInteger(port) || port <= 0) throw new Error(`Invalid port: ${explicitPort}`);

  fs.mkdirSync(targetRoot, { recursive: true });
  run('git', ['worktree', 'add', '-b', branch, target, 'HEAD']);
  fs.writeFileSync(path.join(target, '.jam-agent.env'), [
    `JAM_AGENT_ID=${slug}`,
    `JAM_AGENT_BRANCH=${branch}`,
    `PORT=${port}`,
    `JAM_BASE_URL=http://localhost:${port}`,
    `JAM_LIVE_BASE_URL=http://localhost:3000`,
    ''
  ].join('\n'));

  console.log(JSON.stringify({
    worktree: target,
    branch,
    port,
    start: `cd ${target} && PORT=${port} npm start`,
    smoke: `cd ${target} && JAM_BASE_URL=http://localhost:${port} npm run smoke:live`
  }, null, 2));
}

function changedFiles(root) {
  const tracked = run('git', ['diff', '--name-only', 'HEAD'], { cwd: root, capture: true })
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
  const untracked = run('git', ['ls-files', '--others', '--exclude-standard'], { cwd: root, capture: true })
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
  const files = [...new Set([...tracked, ...untracked])].filter(isPromotableFile);
  const promotableUntracked = untracked.filter(file => files.includes(file));

  if (promotableUntracked.length) {
    run('git', ['add', '-N', '--', ...promotableUntracked], { cwd: root });
  }

  return files;
}

function isPromotableFile(file) {
  if (!file || path.isAbsolute(file)) return false;
  if (file === '.jam-agent.env' || file.endsWith('/.jam-agent.env')) return false;
  if (file === '.env' || file.startsWith('.env.')) return false;
  if (file === 'node_modules' || file.startsWith('node_modules/')) return false;
  return true;
}

async function hotReloadChangedElements(files) {
  const layoutPath = path.join(repoRoot, 'workspace_layout.json');
  if (!fs.existsSync(layoutPath)) return;

  const layout = JSON.parse(fs.readFileSync(layoutPath, 'utf8'));
  const fileToElement = new Map();
  for (const [id, element] of Object.entries(layout)) {
    if (element?.filePath) fileToElement.set(element.filePath.replace(/^\/+/, ''), id);
  }

  const ids = new Set();
  for (const file of files) {
    if (!file.startsWith('public/elements/')) continue;
    const publicPath = file.replace(/^public\//, '');
    const id = fileToElement.get(publicPath);
    if (id) ids.add(id);
  }

  for (const id of ids) {
    try {
      const response = await fetch(`${process.env.JAM_LIVE_BASE_URL || 'http://localhost:3000'}/api/workspace/elements/${encodeURIComponent(id)}/reload`, {
        method: 'POST'
      });
      console.log(`[promote] hot reload ${id}: ${response.status}`);
    } catch (err) {
      console.warn(`[promote] live reload skipped for ${id}: ${err.message}`);
    }
  }
}

async function promote(worktreePath, shouldCommit) {
  if (!worktreePath) throw new Error('promote requires <worktree-path>');
  const candidate = path.resolve(worktreePath);
  validate(candidate, false);

  const files = changedFiles(candidate);
  if (!files.length) {
    console.log('[promote] no changes to promote');
    return;
  }

  const patchPath = path.join(os.tmpdir(), `jam-promote-${Date.now()}.patch`);
  const patch = run('git', ['diff', '--binary', 'HEAD', '--', ...files], { cwd: candidate, capture: true });
  fs.writeFileSync(patchPath, patch);

  run('git', ['apply', '--3way', '--check', patchPath], { cwd: repoRoot });
  run('git', ['apply', '--3way', patchPath], { cwd: repoRoot });
  validate(repoRoot, false);
  await hotReloadChangedElements(files);

  if (shouldCommit) {
    run('git', ['add', '--', ...files], { cwd: repoRoot });
    const agentName = path.basename(candidate);
    run('git', ['commit', '-m', `Promote ${agentName} jam changes`], {
      cwd: repoRoot,
      env: {
        JAM_AGENT_ID: agentName,
        JAM_ELEMENT_IDS: files.filter(file => file.startsWith('public/elements/')).join(',')
      }
    });
  }

  console.log(`[promote] promoted ${files.length} file(s) from ${candidate}`);
}

const [command, ...args] = process.argv.slice(2);

try {
  if (command === 'create') {
    await create(args[0], args[1]);
  } else if (command === 'validate') {
    validate(args.find(arg => !arg.startsWith('--')) || repoRoot, args.includes('--full'));
  } else if (command === 'promote') {
    await promote(args.find(arg => !arg.startsWith('--')), args.includes('--commit'));
  } else if (command === 'install-hooks') {
    run('git', ['config', 'core.hooksPath', '.githooks']);
    console.log('[hooks] core.hooksPath=.githooks');
  } else {
    usage();
    process.exit(command ? 1 : 0);
  }
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
