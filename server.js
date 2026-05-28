import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import os from 'os';
import net from 'net';
import { spawn, spawnSync } from 'child_process';
import pty from 'node-pty';
import { getYDoc, setupWSConnection } from './node_modules/y-websocket/bin/utils.cjs';

// Load environment variables
dotenv.config();

const PORT = process.env.PORT || 3000;
const CODEGEN_PROVIDER = (process.env.CODEGEN_PROVIDER || 'codex').toLowerCase();
const CODEGEN_TIMEOUT_MS = Number(process.env.CODEGEN_TIMEOUT_MS || 180000);
const CODEX_MODEL = process.env.CODEX_MODEL || '';
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const GEMINI_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS || 30000);
const REPO_ROOT = process.cwd();
const AGENT_WORKTREE_MODE = process.env.AGENT_WORKTREE_MODE !== 'off';
const AGENT_WORKTREE_ROOT = path.resolve(process.env.AGENT_WORKTREE_ROOT || path.join(REPO_ROOT, '..', 'jam-agent-worktrees'));
const AGENT_PORT_START = Number(process.env.AGENT_PORT_START || (Number(PORT) || 3000) + 1);
const LIVE_AUTO_COMMIT = process.env.LIVE_AUTO_COMMIT !== 'off';
const LIVE_COMMIT_DEBOUNCE_MS = Number(process.env.LIVE_COMMIT_DEBOUNCE_MS || 800);
const app = express();
app.use(express.json());

// Ensure directories exist
const publicDir = path.resolve('public');
const elementsDir = path.join(publicDir, 'elements');
if (!fs.existsSync(publicDir)) {
  fs.mkdirSync(publicDir, { recursive: true });
}
if (!fs.existsSync(elementsDir)) {
  fs.mkdirSync(elementsDir, { recursive: true });
}

// Serve static files from public/
app.use(express.static(publicDir));
app.use('/vendor/xterm', express.static(path.resolve('node_modules/@xterm/xterm')));
app.use('/vendor/xterm-addon-fit', express.static(path.resolve('node_modules/@xterm/addon-fit')));
app.use('/vendor/strudel-web', express.static(path.resolve('node_modules/@strudel/web/dist')));

function resolveElementFilePath(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('filePath is required');
  }
  const resolvedPath = path.resolve(publicDir, filePath.replace(/^\/+/, ''));
  const relativePath = path.relative(elementsDir, resolvedPath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error('filePath must be inside public/elements');
  }
  return resolvedPath;
}

function createElementId() {
  return `elem_${Math.random().toString(36).slice(2, 11)}`;
}

function normalizeElementLayout(input = {}, existing = {}) {
  const hasExisting = Object.keys(existing).length > 0;
  const id = String(input.id || existing.id || createElementId());
  const filePath = input.filePath ?? existing.filePath;
  const type = input.type ?? existing.type;
  if (!filePath) throw new Error('filePath is required');
  if (!type) throw new Error('type is required');
  resolveElementFilePath(filePath);

  const numberOrDefault = (value, fallback) => {
    const num = Number(value);
    return Number.isFinite(num) ? num : fallback;
  };

  return {
    ...existing,
    id,
    x: numberOrDefault(input.x ?? existing.x, 400),
    y: numberOrDefault(input.y ?? existing.y, 100),
    width: numberOrDefault(input.width ?? input.w ?? existing.width, 260),
    height: numberOrDefault(input.height ?? input.h ?? existing.height, 200),
    filePath,
    type: String(type),
    prompt: String(input.prompt ?? existing.prompt ?? ''),
    authored: input.authored === 'codegen' ? 'codegen' : (input.authored === 'hand' ? 'hand' : (existing.authored || (hasExisting ? 'codegen' : 'hand'))),
    reloadToken: input.reloadToken ?? existing.reloadToken ?? 0
  };
}

function publicElementLayout(layout) {
  return {
    ...layout,
    authored: layout.authored || 'codegen',
    reloadToken: layout.reloadToken || 0
  };
}

function workspaceSnapshot() {
  return [...elementsMap.entries()]
    .map(([id, layout]) => publicElementLayout({ id, ...layout }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

// Keep track of workspace layout
const manifestPath = path.resolve('workspace_layout.json');
let liveCommitTimer = null;
let liveCommitInFlight = false;
const pendingLiveCommitPaths = new Set();
const pendingLiveCommitReasons = new Set();

function relativeRepoPath(filePath) {
  const relative = path.relative(REPO_ROOT, path.resolve(filePath));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }
  return relative.split(path.sep).join('/');
}

function isLiveCommitPathAllowed(relativePath) {
  if (!relativePath) return false;
  if (relativePath === '.jam-agent.env' || relativePath.endsWith('/.jam-agent.env')) return false;
  if (relativePath === '.env' || relativePath.startsWith('.env.')) return false;
  if (relativePath === 'node_modules' || relativePath.startsWith('node_modules/')) return false;
  return relativePath === 'workspace_layout.json' || relativePath.startsWith('public/elements/');
}

function queueLiveCommit(paths, reason) {
  if (!LIVE_AUTO_COMMIT) return;

  for (const filePath of paths) {
    const relative = relativeRepoPath(filePath);
    if (isLiveCommitPathAllowed(relative)) pendingLiveCommitPaths.add(relative);
  }

  if (reason) pendingLiveCommitReasons.add(reason);
  if (!pendingLiveCommitPaths.size) return;

  clearTimeout(liveCommitTimer);
  liveCommitTimer = setTimeout(processLiveCommitQueue, LIVE_COMMIT_DEBOUNCE_MS);
}

function hasGitChangesFor(paths) {
  const result = spawnSync('git', ['status', '--porcelain', '--', ...paths], {
    cwd: REPO_ROOT,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    console.warn('[Live Commit] git status failed:', result.stderr || result.stdout);
    return false;
  }
  return Boolean(result.stdout.trim());
}

function processLiveCommitQueue() {
  if (liveCommitInFlight) {
    clearTimeout(liveCommitTimer);
    liveCommitTimer = setTimeout(processLiveCommitQueue, LIVE_COMMIT_DEBOUNCE_MS);
    return;
  }

  const paths = [...pendingLiveCommitPaths].filter(isLiveCommitPathAllowed);
  const reasons = [...pendingLiveCommitReasons];
  pendingLiveCommitPaths.clear();
  pendingLiveCommitReasons.clear();

  if (!paths.length || !hasGitChangesFor(paths)) return;

  liveCommitInFlight = true;
  try {
    const add = spawnSync('git', ['add', '--', ...paths], {
      cwd: REPO_ROOT,
      encoding: 'utf8'
    });
    if (add.status !== 0) {
      console.warn('[Live Commit] git add failed:', add.stderr || add.stdout);
      return;
    }

    const diff = spawnSync('git', ['diff', '--cached', '--quiet', '--', ...paths], {
      cwd: REPO_ROOT,
      encoding: 'utf8'
    });
    if (diff.status === 0) return;

    const title = reasons.length ? `Live jam update: ${reasons.slice(-1)[0]}` : 'Live jam update';
    const commit = spawnSync('git', ['commit', '-m', title, '--only', '--', ...paths], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        JAM_AGENT_ID: 'live-server',
        JAM_ELEMENT_IDS: paths.filter(file => file.startsWith('public/elements/')).join(',')
      }
    });
    if (commit.status !== 0) {
      console.warn('[Live Commit] git commit failed:', commit.stderr || commit.stdout);
      return;
    }

    console.log(`[Live Commit] ${title}\n${commit.stdout.trim()}`);
  } finally {
    liveCommitInFlight = false;
    if (pendingLiveCommitPaths.size) {
      clearTimeout(liveCommitTimer);
      liveCommitTimer = setTimeout(processLiveCommitQueue, LIVE_COMMIT_DEBOUNCE_MS);
    }
  }
}

// Initialize Yjs workspace document on server
const doc = getYDoc('jam-workspace');
const elementsMap = doc.getMap('elements');
const clockMap = doc.getMap('clock');
const globalBusMap = doc.getMap('global_bus');
const AGENT_ORIGIN = { origin: 'agent-api' };

// Watch elements map and save manifest to disk
elementsMap.observe(() => {
  try {
    const layout = elementsMap.toJSON();
    fs.writeFileSync(manifestPath, JSON.stringify(layout, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving workspace manifest:', err);
  }
});

// Load existing manifest on startup
if (fs.existsSync(manifestPath)) {
  try {
    const data = fs.readFileSync(manifestPath, 'utf8');
    const layout = JSON.parse(data);
    doc.transact(() => {
      for (const [id, value] of Object.entries(layout)) {
        elementsMap.set(id, value);
      }
    });
    console.log(`[Manifest] Successfully restored ${Object.keys(layout).length} elements from workspace_layout.json`);
  } catch (err) {
    console.error('Error loading workspace manifest on startup:', err);
  }
}

// Low-latency controller WebSocket server state
const controllerClients = new Set();
let hostClient = null;

// Browser-visible agent PTYs. Each connected browser gets an independent
// terminal session so collaborators can prompt Codex/Claude in parallel.
const terminalSessions = new Set();
const TERMINAL_HISTORY_LIMIT = 200000;
let codexSessionId = null;
let nextAgentPort = AGENT_PORT_START;

function sendTerminalMessage(client, message) {
  if (client.readyState === 1) {
    client.send(JSON.stringify(message));
  }
}

function appendTerminalData(session, data) {
  session.history.push(data);
  let total = session.history.reduce((sum, chunk) => sum + chunk.length, 0);
  while (total > TERMINAL_HISTORY_LIMIT && session.history.length > 1) {
    total -= session.history.shift().length;
  }

  sendTerminalMessage(session.ws, { type: 'data', data });
}

function sanitizeAgentId(value) {
  return String(value || 'agent')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'agent';
}

function canListenOnPort(port) {
  return new Promise(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

async function allocateAgentPort() {
  for (let i = 0; i < 100; i += 1) {
    const port = nextAgentPort++;
    if (await canListenOnPort(port)) return port;
  }
  throw new Error(`No available agent dev-server port found starting at ${AGENT_PORT_START}`);
}

async function createAgentWorkspace() {
  const provider = (process.env.AGENT_TERMINAL_PROVIDER || CODEGEN_PROVIDER || 'codex').toLowerCase();
  const port = await allocateAgentPort();

  if (!AGENT_WORKTREE_MODE || provider === 'mock' || provider === 'none') {
    return {
      id: 'live-checkout',
      cwd: REPO_ROOT,
      branch: null,
      port,
      baseUrl: `http://localhost:${port}`,
      isolated: false
    };
  }

  const id = sanitizeAgentId(`agent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
  const branch = `agent/${id}`;
  const cwd = path.join(AGENT_WORKTREE_ROOT, id);

  fs.mkdirSync(AGENT_WORKTREE_ROOT, { recursive: true });
  const result = spawnSync('git', ['worktree', 'add', '-b', branch, cwd, 'HEAD'], {
    cwd: REPO_ROOT,
    encoding: 'utf8'
  });
  if (result.status !== 0) {
    throw new Error(`Failed to create agent worktree: ${result.stderr || result.stdout}`);
  }

  const baseUrl = `http://localhost:${port}`;
  fs.writeFileSync(path.join(cwd, '.jam-agent.env'), [
    `JAM_AGENT_ID=${id}`,
    `JAM_AGENT_BRANCH=${branch}`,
    `PORT=${port}`,
    `JAM_BASE_URL=${baseUrl}`,
    `JAM_LIVE_BASE_URL=http://localhost:${PORT}`,
    ''
  ].join('\n'));

  return { id, cwd, branch, port, baseUrl, isolated: true };
}

function getInteractiveAgentConfig(workspace) {
  workspace = workspace || { cwd: REPO_ROOT };
  const provider = (process.env.AGENT_TERMINAL_PROVIDER || CODEGEN_PROVIDER || 'codex').toLowerCase();
  if (provider === 'mock' || provider === 'none') {
    return { command: process.env.SHELL || 'bash', args: ['-lc', 'printf "jam test terminal $$\\n"; sleep 86400'] };
  }
  if (provider === 'claude') {
    const args = ['--permission-mode', 'dontAsk'];
    if (CLAUDE_MODEL) args.push('--model', CLAUDE_MODEL);
    return { command: 'claude', args };
  }

  const args = ['--yolo', '--cd', workspace.cwd];
  if (CODEX_MODEL) args.push('--model', CODEX_MODEL);
  return { command: 'codex', args };
}

function removeAgentWorkspace(workspace) {
  if (!workspace?.isolated) return;

  const removeResult = spawnSync('git', ['worktree', 'remove', '--force', workspace.cwd], {
    cwd: REPO_ROOT,
    encoding: 'utf8'
  });
  if (removeResult.status !== 0) {
    console.warn(`[Agent Terminal] Failed to remove worktree ${workspace.cwd}: ${removeResult.stderr || removeResult.stdout}`);
  }

  if (workspace.branch) {
    const branchResult = spawnSync('git', ['branch', '-D', workspace.branch], {
      cwd: REPO_ROOT,
      encoding: 'utf8'
    });
    if (branchResult.status !== 0) {
      console.warn(`[Agent Terminal] Failed to delete branch ${workspace.branch}: ${branchResult.stderr || branchResult.stdout}`);
    }
  }
}

async function createAgentTerminalSession(ws) {
  const preflight = getInteractiveAgentConfig();
  if (!commandExists(preflight.command)) {
    throw new Error(`${preflight.command} CLI is not installed or not on PATH`);
  }

  const workspace = await createAgentWorkspace();
  const { command, args } = getInteractiveAgentConfig(workspace);

  let agentPty = null;
  try {
    agentPty = pty.spawn(command, args, {
      name: 'xterm-256color',
      cols: 120,
      rows: 36,
      cwd: workspace.cwd,
      env: {
        ...process.env,
        JAM_AGENT_ID: workspace.id,
        JAM_AGENT_BRANCH: workspace.branch || '',
        JAM_BASE_URL: workspace.baseUrl,
        JAM_LIVE_BASE_URL: `http://localhost:${PORT}`,
        PORT: String(workspace.port),
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        FORCE_COLOR: '1'
      }
    });
  } catch (err) {
    removeAgentWorkspace(workspace);
    throw err;
  }

  const session = {
    ws,
    workspace,
    history: [],
    pty: agentPty
  };

  terminalSessions.add(session);
  appendTerminalData(session, [
    `\r\n[jam agent] workspace: ${workspace.cwd}`,
    workspace.isolated ? `[jam agent] branch: ${workspace.branch}` : '[jam agent] using live checkout',
    `[jam agent] private dev URL: ${workspace.baseUrl}`,
    `[jam agent] live jam URL: http://localhost:${PORT}\r\n`
  ].join('\r\n'));
  session.pty.onData(data => appendTerminalData(session, data));
  session.pty.onExit(() => {
    terminalSessions.delete(session);
    sendTerminalMessage(ws, { type: 'data', data: '\r\n[agent terminal exited]\r\n' });
  });

  return session;
}

function resizeAgentPty(session, cols, rows) {
  if (!session?.pty) return;
  const safeCols = Math.max(20, Math.min(240, Number(cols) || 120));
  const safeRows = Math.max(6, Math.min(80, Number(rows) || 36));
  try {
    session.pty.resize(safeCols, safeRows);
  } catch (err) {
    console.warn('[Agent Terminal] Resize failed:', err.message);
  }
}

function closeAgentTerminalSession(session) {
  terminalSessions.delete(session);
  if (!session?.pty) return;
  try {
    session.pty.kill();
  } catch {
    // Process is already gone.
  }
}

process.on('exit', () => {
  terminalSessions.forEach(closeAgentTerminalSession);
});

// Server-side compilation cache to throttle client loop conditions
const compileCache = new Map(); // filePath -> { rawCode, transpiledCode, timestamp }

// LLM Code Compilation endpoint
app.post('/api/compile', async (req, res) => {
  const { prompt, elementId, filePath, prevState, forceCompile = false, authored, allowOverwrite = false } = req.body;
  
  if (!prompt || !elementId || !filePath) {
    return res.status(400).json({ error: 'Missing required parameters: prompt, elementId, or filePath' });
  }

  // Fast path for Visual NTP handshake requests
  if (prompt === 'PING') {
    return res.json({ success: true, message: 'PONG' });
  }

  // Ensure filePath is within public/elements for safety
  let resolvedPath = '';
  try {
    resolvedPath = resolveElementFilePath(filePath);
  } catch (err) {
    return res.status(400).json({ error: 'Invalid file path. Path must be inside public/elements' });
  }

  // Throttling / Caching check
  const now = Date.now();
  const cached = compileCache.get(filePath);
  if (cached && (now - cached.timestamp < 3000) && prompt.includes('Initialize')) {
    console.log(`[Compiler] Serving CACHED compiled code for element ${elementId} (throttled loop)`);
    return res.json({
      success: true,
      filePath,
      rawCode: cached.rawCode,
      transpiledCode: cached.transpiledCode
    });
  }

  console.log(`[Compiler] Compiling for element: ${elementId}, Path: ${filePath}`);
  console.log(`[Compiler] Prompt: "${prompt}"`);

  let existingCode = '';
  if (fs.existsSync(resolvedPath)) {
    existingCode = fs.readFileSync(resolvedPath, 'utf8');
  }

  const layout = elementsMap.get(elementId);
  const isHandAuthored = authored === 'hand' || layout?.authored === 'hand';
  const shouldReuseExistingSource = existingCode.trim() && (!forceCompile || (isHandAuthored && !allowOverwrite));

  if (shouldReuseExistingSource) {
    console.log(`[Compiler] Reusing existing source for element ${elementId}; forceCompile=${Boolean(forceCompile)}, authored=${isHandAuthored ? 'hand' : 'codegen'}.`);
    const transpiledCode = transpileModuleSource(existingCode);
    compileCache.set(filePath, {
      rawCode: existingCode,
      transpiledCode,
      timestamp: Date.now()
    });
    return res.json({
      success: true,
      filePath,
      rawCode: existingCode,
      transpiledCode
    });
  }

  let generatedCode = '';
  const environmentSummary = buildEnvironmentSummary({ elementId, filePath, resolvedPath });
  const compilerPrompt = buildCompilerPrompt({
    prompt,
    elementId,
    filePath,
    resolvedPath,
    existingCode,
    prevState,
    environmentSummary
  });
  const providerOrder = getCodegenProviderOrder();

  for (const provider of providerOrder) {
    try {
      if (provider === 'codex') {
        generatedCode = await generateWithCodex(compilerPrompt, resolvedPath);
      } else if (provider === 'claude') {
        generatedCode = await generateWithClaude(compilerPrompt, resolvedPath);
      } else if (provider === 'gemini') {
        generatedCode = await generateWithGemini(compilerPrompt);
      } else if (provider === 'mock') {
        console.log('[Compiler] Using local smart compiler fallback.');
        generatedCode = getMockCode(prompt, elementId, prevState, elementsMap);
      } else {
        console.warn(`[Compiler] Unknown CODEGEN_PROVIDER "${provider}". Skipping.`);
      }

      if (generatedCode?.trim()) {
        break;
      }
    } catch (err) {
      console.error(`[Compiler] ${provider} provider failed; trying next provider:`, err);
    }
  }

  if (!generatedCode?.trim()) {
    console.warn('[Compiler] All configured providers failed. Falling back to local smart compiler.');
    generatedCode = getMockCode(prompt, elementId, prevState, elementsMap);
  }

  generatedCode = stripCodeFences(generatedCode);

  // Write the code to disk
  fs.writeFileSync(resolvedPath, generatedCode, 'utf8');
  console.log(`[Compiler] Code written to: ${resolvedPath}`);
  queueLiveCommit([resolvedPath], `compile ${elementId}`);

  // Transpile to IIFE string for new Function()
  // Replace 'export default function setup' with 'return function setup'
  // and 'export default async function setup' with 'return async function setup'
  let transpiled = transpileModuleSource(generatedCode);

  // Cache compile results
  compileCache.set(filePath, {
    rawCode: generatedCode,
    transpiledCode: transpiled,
    timestamp: Date.now()
  });

  res.json({
    success: true,
    filePath,
    rawCode: generatedCode,
    transpiledCode: transpiled
  });
});

app.get('/api/workspace/elements', (req, res) => {
  res.json({ elements: workspaceSnapshot() });
});

app.post('/api/workspace/elements', (req, res) => {
  try {
    const layout = normalizeElementLayout(req.body || {});
    if (elementsMap.has(layout.id)) {
      return res.status(409).json({ error: `element ${layout.id} already exists` });
    }
    doc.transact(() => {
      elementsMap.set(layout.id, layout);
    }, AGENT_ORIGIN);
    queueLiveCommit([manifestPath], `add ${layout.id}`);
    res.json({ success: true, id: layout.id, layout: publicElementLayout(layout) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.patch('/api/workspace/elements/:id', (req, res) => {
  const id = req.params.id;
  const existing = elementsMap.get(id);
  if (!existing) {
    return res.status(404).json({ error: `element ${id} not found` });
  }

  try {
    const layout = normalizeElementLayout({ ...req.body, id }, { id, ...existing });
    doc.transact(() => {
      elementsMap.set(id, layout);
    }, AGENT_ORIGIN);
    queueLiveCommit([manifestPath], `update ${id}`);
    res.json({ success: true, id, layout: publicElementLayout(layout) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/workspace/elements/:id', (req, res) => {
  const id = req.params.id;
  if (!elementsMap.has(id)) {
    return res.status(404).json({ error: `element ${id} not found` });
  }
  doc.transact(() => {
    elementsMap.delete(id);
  }, AGENT_ORIGIN);
  queueLiveCommit([manifestPath], `delete ${id}`);
  res.json({ success: true, id });
});

app.post('/api/workspace/elements/:id/reload', (req, res) => {
  const id = req.params.id;
  const existing = elementsMap.get(id);
  if (!existing) {
    return res.status(404).json({ error: `element ${id} not found` });
  }

  const layout = publicElementLayout({ id, ...existing });
  layout.reloadToken = Date.now();
  doc.transact(() => {
    elementsMap.set(id, layout);
  }, AGENT_ORIGIN);
  const commitPaths = [manifestPath];
  try {
    commitPaths.push(resolveElementFilePath(layout.filePath));
  } catch {
    // Invalid paths are rejected by compile/load paths; keep reload commit scoped to manifest.
  }
  queueLiveCommit(commitPaths, `reload ${id}`);
  res.json({ success: true, id, layout });
});

app.get('/api/workspace/state', (req, res) => {
  res.json({
    elements: workspaceSnapshot(),
    clock: {
      bpm: clockMap.get('bpm') || 120,
      startTime: clockMap.get('startTime') || null
    },
    globalBus: globalBusMap.toJSON()
  });
});

app.post('/api/workspace/clock', (req, res) => {
  const allowed = {};
  if (req.body && req.body.bpm !== undefined) {
    const bpm = Number(req.body.bpm);
    if (!Number.isFinite(bpm) || bpm < 40 || bpm > 240) {
      return res.status(400).json({ error: 'bpm must be a number between 40 and 240' });
    }
    allowed.bpm = bpm;
  }
  if (req.body && req.body.startTime !== undefined) {
    const startTime = Number(req.body.startTime);
    if (!Number.isFinite(startTime)) {
      return res.status(400).json({ error: 'startTime must be a timestamp number' });
    }
    allowed.startTime = startTime;
  }

  doc.transact(() => {
    for (const [key, value] of Object.entries(allowed)) {
      clockMap.set(key, value);
    }
  }, AGENT_ORIGIN);
  res.json({ success: true, clock: { bpm: clockMap.get('bpm') || 120, startTime: clockMap.get('startTime') || null } });
});

app.post('/api/workspace/global-bus/:key', (req, res) => {
  const key = req.params.key;
  if (!key) {
    return res.status(400).json({ error: 'key is required' });
  }
  doc.transact(() => {
    globalBusMap.set(key, req.body?.value);
  }, AGENT_ORIGIN);
  res.json({ success: true, key, value: globalBusMap.get(key) });
});

app.post('/api/agent-command', async (req, res) => {
  res.status(410).json({
    error: 'Agent commands are terminal-session scoped. Send input over the /agent-terminal WebSocket.'
  });
});

function buildCompilerPrompt({ prompt, elementId, filePath, resolvedPath, existingCode, prevState, environmentSummary }) {
  const systemInstruction = `
You are the live code-generation agent inside "jam", a local collaborative spatial music/canvas server.

You are running from the repository root. The server hot-reloads element source files from public/elements.
Your job is to edit exactly this target element file:
${resolvedPath}

Do not edit other files unless explicitly asked. Do not run the dev server. Do not install packages.
After editing the target file, your final answer should be brief; the server will read the edited file back from disk.

This is not a standalone app-generation task. Requests for shaders, visualizers, Strudel windows, synths,
samplers, sequencers, or controls must be implemented inside the target jam element file. Do not create
a Vite/React/Next app, do not edit public/index.html for element-specific work, and do not start a new
server on another port. WebGL shader work should create a canvas inside ctx.domRoot, draw from update(),
and release WebGL resources in destroy().

You are working inside this live jam environment:
${environmentSummary}

The target file must be a pure ES Module that conforms to the "Micro-App Contract".
Contract:
\`\`\`javascript
export default function setup(ctx, prevState) {
  // ctx: { audioCtx, audioOut, bus, domRoot, clock }
  // domRoot is a Shadow DOM container. Render your UI inside it.
  // audioOut is your parent spatial gain/filter node. Connect all your audio nodes here!
  // clock: { bpm, startTime, onTick(callback) }
  // bus: { pub(key, val), sub(key, callback), pubGlobal(key, val), subGlobal(key, callback) }
  
  // Return lifecycle hooks:
  return {
    update(tick) {
      // Optional: per-frame animation (visuals only)
    },
    getState() {
      // Optional: return serializable state
      return state;
    },
    destroy() {
      // Clean up everything you created! Stop oscillators, remove event listeners, unsubscribe from ticks
    }
  };
}
\`\`\`

Safety & Architecture Rules:
1. DO NOT use static top-level imports. If you need external libraries, use dynamic import inside setup, e.g. \`const d3 = await import('https://esm.sh/d3')\`.
2. Do NOT touch the master sound system directly, ONLY connect to \`ctx.audioOut\`.
3. If \`prevState\` is passed, restore properties into your state. Write clean schema translation helpers to convert old keys to new keys if you updated the state layout.
4. Keep the UI beautiful, responsive, and styled using inline styles or a \`<style>\` block inside \`domRoot\`. Feel free to make it highly visual with colorful canvas or svg animations.
5. Pub/Sub rules:
   - For high-frequency continuous signals (like LFO modulating filter cutoff), use local \`ctx.bus.pub("name", val)\` / \`sub\`.
   - For user-initiated interactions (like dragging a slider, toggling a sequencer step, clicking a button), you MUST broadcast this globally via \`ctx.bus.pubGlobal("name", val)\` (which syncs via Yjs/websockets) so every connected jam client receives the same source of truth. Some browsers are locally muted by their master gain; the audible room feed is just the client opened with \`?audio=on\`.
   - Ensure you namespace your keys or rely on the parent wrapper's automatic instance-specific namespacing. Use 'global:prefix' for actual global cross-element communication (like global:tempo_bpm).
6. Timing: Use \`ctx.clock.onTick(({ step, time, duration, bpm }) => { ... })\` for precise beat-aligned scheduling. Schedule audio events at the exact timeline \`time\`.
7. Teardown: Your \`destroy()\` hook must be absolute. Disconnect nodes, stop oscillators, and unsubscribe from everything to avoid severe memory leaks!

If your tool environment allows file edits, write the final module directly to the target file.
If you cannot edit files, return ONLY the raw JavaScript code of the module. Do NOT wrap it in markdown codeblocks.
`;

  const promptPayload = `
Modify or generate the ES Module JS code for the element "${elementId}".
Target public path: "${filePath}"
Target filesystem path: "${resolvedPath}"
User Prompt: "${prompt}"

Current existing file code:
\`\`\`javascript
${existingCode}
\`\`\`

Previous serializable state (if any) or schema to preserve:
\`\`\`json
${JSON.stringify(prevState || {}, null, 2)}
\`\`\`

Follow the system instructions to write high-quality, high-performance, beautiful creative audio/visual code.
If you can edit files, update the target file directly and then briefly say that it was written.
If you cannot edit files, return ONLY valid JS code without any markdown wrappers.
`;

  return `${systemInstruction}\n\n${promptPayload}`;
}

function getCodegenProviderOrder() {
  if (CODEGEN_PROVIDER === 'auto') {
    return ['codex', 'claude', 'mock'];
  }
  return CODEGEN_PROVIDER.split(',').map(provider => provider.trim()).filter(Boolean);
}

function buildEnvironmentSummary({ elementId, filePath, resolvedPath }) {
  return [
    buildRepoStructureSummary(),
    buildWorkspaceSummary({ elementId, filePath, resolvedPath }),
    buildElementsDirectorySummary()
  ].join('\n\n');
}

function buildRepoStructureSummary() {
  const entries = [];
  const include = [
    'DESIGN.md',
    'AGENTS.md',
    'CLAUDE.md',
    'server.js',
    'workspace_layout.json',
    'package.json',
    'public/index.html',
    'public/client.js',
    'public/style.css',
    'public/elements',
    'tests/e2e'
  ];

  for (const relPath of include) {
    const absPath = path.resolve(relPath);
    if (!fs.existsSync(absPath)) continue;
    const stat = fs.statSync(absPath);
    entries.push(`${relPath}${stat.isDirectory() ? '/' : ''}`);
  }

  return `Repo structure summary:\n${entries.map(entry => `- ${entry}`).join('\n')}`;
}

function buildWorkspaceSummary({ elementId, filePath, resolvedPath }) {
  const layouts = [];
  try {
    for (const [id, layout] of elementsMap.entries()) {
      layouts.push({ id, ...layout });
    }
  } catch (err) {
    console.warn('[Compiler] Failed to summarize live Yjs workspace:', err);
  }

  if (layouts.length === 0 && fs.existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      for (const [id, layout] of Object.entries(manifest)) {
        layouts.push({ id, ...layout });
      }
    } catch (err) {
      console.warn('[Compiler] Failed to summarize workspace manifest:', err);
    }
  }

  const lines = layouts
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .map(layout => {
      const isTarget = layout.id === elementId || layout.filePath === filePath;
      return [
        `- ${isTarget ? 'TARGET ' : ''}${layout.id}`,
        `type=${layout.type || 'unknown'}`,
        `file=${layout.filePath || 'unknown'}`,
        `pos=(${layout.x ?? '?'},${layout.y ?? '?'})`,
        `size=${layout.width ?? '?'}x${layout.height ?? '?'}`,
        `prompt=${JSON.stringify(layout.prompt || '')}`
      ].join(' ');
    });

  if (!lines.some(line => line.includes('TARGET '))) {
    lines.unshift(`- TARGET ${elementId} type=unknown file=${filePath} fs=${resolvedPath}`);
  }

  return `Current jam workspace elements:\n${lines.join('\n')}`;
}

function buildElementsDirectorySummary() {
  let files = [];
  try {
    files = fs.readdirSync(elementsDir)
      .filter(name => name.endsWith('.js') || name === 'PING')
      .sort()
      .slice(0, 80)
      .map(name => {
        const absPath = path.join(elementsDir, name);
        const stat = fs.statSync(absPath);
        return `- public/elements/${name} (${stat.size} bytes)`;
      });
  } catch (err) {
    console.warn('[Compiler] Failed to summarize elements directory:', err);
  }

  return `Element source files currently on disk:\n${files.length ? files.join('\n') : '- none'}`;
}

function commandExists(command) {
  const result = spawnSync('which', [command], { stdio: 'ignore' });
  return result.status === 0;
}

function stripCodeFences(code) {
  return code
    .replace(/^```javascript\s*/i, '')
    .replace(/^```js\s*/i, '')
    .replace(/^```\s*/, '')
    .replace(/\s*```$/, '')
    .trim();
}

function transpileModuleSource(source) {
  return source
    .replace(/export\s+default\s+async\s+function\s+setup\b/, 'return async function setup')
    .replace(/export\s+default\s+function\s+setup\b/, 'return function setup')
    .replace(/export\s+default\s+/, 'return ');
}

function assertLooksLikeModule(code, provider) {
  if (!/export\s+default/.test(code)) {
    throw new Error(`${provider} returned output without an export default setup module. First 500 chars: ${code.slice(0, 500)}`);
  }
}

function readEditedModuleOrCliOutput(resolvedPath, output, provider) {
  let code = '';
  if (fs.existsSync(resolvedPath)) {
    code = fs.readFileSync(resolvedPath, 'utf8');
  }

  if (!/export\s+default/.test(code) && output?.trim()) {
    code = stripCodeFences(output);
  }

  code = stripCodeFences(code);
  assertLooksLikeModule(code, provider);
  return code;
}

function runCli(command, args, input, timeoutMs) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 2000);
    }, timeoutMs);

    child.stdout.on('data', chunk => {
      const text = chunk.toString();
      stdout += text;
    });

    child.stderr.on('data', chunk => {
      const text = chunk.toString();
      stderr += text;
    });

    child.on('error', error => {
      clearTimeout(timeout);
      reject(error);
    });

    child.on('close', code => {
      clearTimeout(timeout);
      const elapsedMs = Date.now() - startedAt;
      if (timedOut) {
        reject(new Error(`${command} timed out after ${timeoutMs}ms. stderr: ${stderr.slice(0, 1000)}`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`${command} exited ${code} after ${elapsedMs}ms. stderr: ${stderr.slice(0, 1000)} stdout: ${stdout.slice(0, 1000)}`));
        return;
      }
      resolve({ stdout, stderr, elapsedMs });
    });

    child.stdin.end(input);
  });
}

function extractCodexSessionId(text) {
  const match = text.match(/session id:\s*([0-9a-f-]{36})/i);
  return match?.[1] || null;
}

async function runCodexPrompt(prompt) {
  if (!commandExists('codex')) {
    throw new Error('codex CLI is not installed or not on PATH');
  }

  const outputFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jam-codex-')), 'last-message.txt');
  const args = codexSessionId
    ? ['exec', 'resume', codexSessionId, '--yolo', '--output-last-message', outputFile]
    : ['exec', '--yolo', '--cd', process.cwd(), '--color', 'never', '--output-last-message', outputFile];

  if (CODEX_MODEL) {
    args.push('--model', CODEX_MODEL);
  }

  args.push('-');

  console.log(`[Compiler] Requesting Codex CLI${CODEX_MODEL ? ` model ${CODEX_MODEL}` : ''}${codexSessionId ? ` session ${codexSessionId}` : ' new session'}...`);
  const result = await runCli('codex', args, prompt, CODEGEN_TIMEOUT_MS);
  codexSessionId = extractCodexSessionId(result.stdout) || codexSessionId;
  return {
    finalMessage: fs.existsSync(outputFile) ? fs.readFileSync(outputFile, 'utf8') : result.stdout,
    elapsedMs: result.elapsedMs
  };
}

async function generateWithCodex(compilerPrompt, resolvedPath) {
  const result = await runCodexPrompt(compilerPrompt);
  const code = readEditedModuleOrCliOutput(resolvedPath, result.finalMessage, 'codex');
  console.log(`[Compiler] Codex completed in ${result.elapsedMs}ms; received ${code.length} chars.`);
  return code;
}

async function runClaudePrompt(prompt) {
  if (!commandExists('claude')) {
    throw new Error('claude CLI is not installed or not on PATH');
  }

  const args = [
    '--print',
    '--permission-mode', 'dontAsk',
    '--output-format', 'text',
    '--no-session-persistence'
  ];

  if (CLAUDE_MODEL) {
    args.push('--model', CLAUDE_MODEL);
  }

  console.log(`[Compiler] Requesting Claude CLI${CLAUDE_MODEL ? ` model ${CLAUDE_MODEL}` : ''} for code generation...`);
  return runCli('claude', args, prompt, CODEGEN_TIMEOUT_MS);
}

async function generateWithClaude(compilerPrompt, resolvedPath) {
  const result = await runClaudePrompt(compilerPrompt);
  const code = readEditedModuleOrCliOutput(resolvedPath, result.stdout, 'claude');
  console.log(`[Compiler] Claude completed in ${result.elapsedMs}ms; received ${code.length} chars.`);
  return code;
}

async function generateWithGemini(compilerPrompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not set');
  }

  console.log(`[Compiler] Requesting Gemini model ${GEMINI_MODEL} for code generation...`);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, GEMINI_TIMEOUT_MS);

  const geminiStartedAt = Date.now();
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: compilerPrompt }]
        }
      ],
      generationConfig: {
        temperature: 0.5,
        maxOutputTokens: 8192
      }
    }),
    signal: controller.signal
  });

  clearTimeout(timeoutId);

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Gemini API returned status ${response.status}: ${errorBody.slice(0, 500)}`);
  }

  const resData = await response.json();
  const code = stripCodeFences(resData.candidates?.[0]?.content?.parts?.[0]?.text || '');
  console.log(`[Compiler] Gemini completed in ${Date.now() - geminiStartedAt}ms; received ${code.length} chars.`);

  if (!code.trim()) {
    throw new Error(`Gemini returned an empty response: ${JSON.stringify(resData).slice(0, 500)}`);
  }

  assertLooksLikeModule(code, 'gemini');
  return code;
}

// Helper: Smart Local Mock Compiler
function getMockCode(prompt, elementId, prevState, elementsMap) {
  const p = prompt.toLowerCase();
  const freq = prevState?.frequency || 220;
  const name = prevState?.name || 'Instrument';

  // Workspace awareness: find if there is an active LFO element on the canvas to route compile-time connections!
  let lfoElementId = '';
  if (elementsMap) {
    try {
      // In Yjs, elementsMap is a Y.Map. We can iterate over its keys
      for (const id of elementsMap.keys()) {
        const layout = elementsMap.get(id);
        if (layout && (layout.type === 'lfo' || id.includes('lfo'))) {
          lfoElementId = id;
          break;
        }
      }
    } catch (e) {
      console.error('[Mock Compiler] Failed searching elementsMap:', e);
    }
  }

  if (p.includes('lfo') || p.includes('modulator') || p.includes('wave')) {
    // Generate LFO Modulator
    return `// LFO Modulator Element
export default function setup(ctx, prevState) {
  const dom = ctx.domRoot;
  let state = {
    rate: prevState?.rate || 2, // Hz
    depth: prevState?.depth || 0.5,
    type: prevState?.type || 'sine',
    ...prevState
  };

  // UI Setup
  dom.innerHTML = \`
    <style>
      .card {
        background: rgba(30, 30, 40, 0.95);
        border: 2px solid #a855f7;
        border-radius: 12px;
        padding: 15px;
        color: #fff;
        font-family: monospace;
        box-shadow: 0 4px 20px rgba(168, 85, 247, 0.2);
        width: 220px;
        box-sizing: border-box;
      }
      h3 { margin: 0 0 10px 0; color: #a855f7; text-align: center; font-size: 14px; }
      .row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 11px; align-items: center; }
      input[type=range] { flex-grow: 1; margin-left: 10px; accent-color: #a855f7; }
      .val { color: #f472b6; font-weight: bold; min-width: 30px; text-align: right; }
      .visualizer { height: 40px; background: #0c0a0f; border-radius: 6px; margin-top: 10px; position: relative; overflow: hidden; }
      .ball { width: 12px; height: 12px; background: #f472b6; border-radius: 50%; position: absolute; top: 14px; left: 0; box-shadow: 0 0 10px #f472b6; }
    </style>
    <div class="card">
      <h3>🌀 LFO MODULATOR</h3>
      <div class="row">
        <span>Rate:</span>
        <input type="range" id="rate-slider" min="0.1" max="20" step="0.1" value="\${state.rate}">
        <span class="val" id="rate-val">\${state.rate}Hz</span>
      </div>
      <div class="row">
        <span>Depth:</span>
        <input type="range" id="depth-slider" min="0" max="1" step="0.05" value="\${state.depth}">
        <span class="val" id="depth-val">\${state.depth}</span>
      </div>
      <div class="row">
        <span>Type:</span>
        <select id="type-select" style="background:#1e1e24; color:white; border:1px solid #a855f7; border-radius:4px; padding:2px;">
          <option value="sine" \${state.type==='sine'?'selected':''}>Sine</option>
          <option value="triangle" \${state.type==='triangle'?'selected':''}>Triangle</option>
          <option value="sawtooth" \${state.type==='sawtooth'?'selected':''}>Sawtooth</option>
        </select>
      </div>
      <div class="visualizer">
        <div class="ball" id="lfo-ball"></div>
      </div>
    </div>
  \`;

  const rateSlider = dom.querySelector('#rate-slider');
  const rateVal = dom.querySelector('#rate-val');
  const depthSlider = dom.querySelector('#depth-slider');
  const depthVal = dom.querySelector('#depth-val');
  const typeSelect = dom.querySelector('#type-select');
  const ball = dom.querySelector('#lfo-ball');

  // Input listeners - Route through pubGlobal so all clients see and host generates audio accordingly
  rateSlider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    state.rate = val;
    rateVal.textContent = val + 'Hz';
    ctx.bus.pubGlobal('lfo_rate', val);
  });

  depthSlider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    state.depth = val;
    depthVal.textContent = val;
    ctx.bus.pubGlobal('lfo_depth', val);
  });

  typeSelect.addEventListener('change', (e) => {
    const val = e.target.value;
    state.type = val;
    ctx.bus.pubGlobal('lfo_type', val);
  });

  // Global subscriptions to update local UI when states are synced
  const unsub1 = ctx.bus.subGlobal('lfo_rate', (val) => {
    state.rate = val;
    rateSlider.value = val;
    rateVal.textContent = val + 'Hz';
  });
  const unsub2 = ctx.bus.subGlobal('lfo_depth', (val) => {
    state.depth = val;
    depthSlider.value = val;
    depthVal.textContent = val;
  });
  const unsub3 = ctx.bus.subGlobal('lfo_type', (val) => {
    state.type = val;
    typeSelect.value = val;
  });

  let phase = 0;

  return {
    update(tick) {
      // Calculate LFO value
      phase += (state.rate / 60);
      let val = 0;
      if (state.type === 'sine') {
        val = Math.sin(phase * Math.PI * 2);
      } else if (state.type === 'triangle') {
        val = 1 - Math.abs((phase % 2) - 1) * 2;
      } else if (state.type === 'sawtooth') {
        val = (phase % 1) * 2 - 1;
      }

      const lfoVal = val * state.depth;
      
      // Update local DOM visual animation
      const leftPercent = 50 + (lfoVal * 40);
      ball.style.left = \`\${leftPercent}%\`;

      // Publish high-frequency real-time modulation to Local Bus (in-memory, local only)
      ctx.bus.pub('lfo_value', lfoVal);
    },
    getState() {
      return state;
    },
    destroy() {
      unsub1();
      unsub2();
      unsub3();
    }
  };
}`;
  } else if (p.includes('sequencer') || p.includes('drum') || p.includes('beat')) {
    // Generate Step Sequencer
    return `// Drum Step Sequencer Element
export default function setup(ctx, prevState) {
  const dom = ctx.domRoot;
  let state = {
    steps: prevState?.steps || [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0],
    instrument: prevState?.instrument || 'kick',
    pitch: prevState?.pitch || 60,
    ...prevState
  };

  // Web Audio trigger node
  const playTrigger = (time) => {
    if (state.instrument === 'kick') {
      const osc = ctx.audioCtx.createOscillator();
      const gain = ctx.audioCtx.createGain();
      osc.connect(gain);
      gain.connect(ctx.audioOut);

      osc.frequency.setValueAtTime(150, time);
      osc.frequency.exponentialRampToValueAtTime(0.01, time + 0.3);
      gain.gain.setValueAtTime(1, time);
      gain.gain.exponentialRampToValueAtTime(0.01, time + 0.3);

      osc.start(time);
      osc.stop(time + 0.3);
    } else if (state.instrument === 'snare') {
      // White noise snare
      const bufferSize = ctx.audioCtx.sampleRate * 0.2;
      const buffer = ctx.audioCtx.createBuffer(1, bufferSize, ctx.audioCtx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
      }

      const noise = ctx.audioCtx.createBufferSource();
      noise.buffer = buffer;

      const filter = ctx.audioCtx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 1000;

      const gain = ctx.audioCtx.createGain();
      gain.gain.setValueAtTime(0.7, time);
      gain.gain.exponentialRampToValueAtTime(0.01, time + 0.15);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.audioOut);

      noise.start(time);
      noise.stop(time + 0.2);
    } else {
      // Hi-Hat/Click
      const osc = ctx.audioCtx.createOscillator();
      const gain = ctx.audioCtx.createGain();
      osc.type = 'triangle';
      osc.connect(gain);
      gain.connect(ctx.audioOut);

      osc.frequency.setValueAtTime(8000, time);
      gain.gain.setValueAtTime(0.3, time);
      gain.gain.exponentialRampToValueAtTime(0.01, time + 0.05);

      osc.start(time);
      osc.stop(time + 0.06);
    }
  };

  const renderUI = () => {
    dom.innerHTML = \`
      <style>
        .card {
          background: rgba(20, 25, 35, 0.95);
          border: 2px solid #06b6d4;
          border-radius: 12px;
          padding: 15px;
          color: #fff;
          font-family: monospace;
          box-shadow: 0 4px 20px rgba(6, 182, 212, 0.2);
          width: 340px;
          box-sizing: border-box;
        }
        h3 { margin: 0 0 10px 0; color: #06b6d4; text-align: center; font-size: 14px; }
        .row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 11px; align-items: center; }
        .grid { display: grid; grid-template-columns: repeat(8, 1fr); gap: 6px; margin: 10px 0; }
        .step {
          height: 24px;
          background: #1e293b;
          border: 1px solid #475569;
          border-radius: 4px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 10px;
          font-weight: bold;
        }
        .step.active {
          background: #06b6d4;
          border-color: #22d3ee;
          box-shadow: 0 0 8px #06b6d4;
          color: #0f172a;
        }
        .step.current {
          outline: 2px solid #f43f5e;
        }
      </style>
      <div class="card">
        <h3>🥁 STEP SEQUENCER</h3>
        <div class="row">
          <span>Instrument:</span>
          <select id="inst-select" style="background:#1e1e24; color:white; border:1px solid #06b6d4; border-radius:4px; padding:2px;">
            <option value="kick" \${state.instrument==='kick'?'selected':''}>Kick Drum</option>
            <option value="snare" \${state.instrument==='snare'?'selected':''}>Snare Drum</option>
            <option value="hat" \${state.instrument==='hat'?'selected':''}>Hi-Hat</option>
          </select>
        </div>
        <div class="grid" id="steps-grid"></div>
      </div>
    \`;

    const grid = dom.querySelector('#steps-grid');
    grid.innerHTML = '';
    state.steps.forEach((active, index) => {
      const stepDiv = document.createElement('div');
      stepDiv.className = \`step \${active ? 'active' : ''}\`;
      stepDiv.textContent = index + 1;
      stepDiv.dataset.index = index;
      grid.appendChild(stepDiv);

      stepDiv.addEventListener('click', () => {
        const nextSteps = [...state.steps];
        nextSteps[index] = nextSteps[index] ? 0 : 1;
        ctx.bus.pubGlobal('seq_steps', nextSteps);
      });
    });

    const instSelect = dom.querySelector('#inst-select');
    instSelect.addEventListener('change', (e) => {
      ctx.bus.pubGlobal('seq_inst', e.target.value);
    });
  };

  renderUI();

  // Watch global state changes
  const unsub1 = ctx.bus.subGlobal('seq_steps', (steps) => {
    state.steps = steps;
    renderUI();
  });
  const unsub2 = ctx.bus.subGlobal('seq_inst', (inst) => {
    state.instrument = inst;
    renderUI();
  });

  let currentStepIndex = -1;

  // Clock ticks subscription
  const unsubscribeClock = ctx.clock.onTick(({ step, time }) => {
    const idx = step % state.steps.length;
    currentStepIndex = idx;
    
    // Schedule actual Web Audio events
    if (state.steps[idx] === 1) {
      playTrigger(time);
    }
  });

  return {
    update(tick) {
      // Highlight current playhead step visually
      const steps = dom.querySelectorAll('.step');
      steps.forEach((s, idx) => {
        if (idx === currentStepIndex) {
          s.classList.add('current');
        } else {
          s.classList.remove('current');
        }
      });
    },
    getState() {
      return state;
    },
    destroy() {
      unsubscribeClock();
      unsub1();
      unsub2();
    }
  };
}`;
  } else if (p.includes('visualizer') || p.includes('analyzer')) {
    // Generate visualizer
    return `// Canvas Audio Visualizer
export default function setup(ctx, prevState) {
  const dom = ctx.domRoot;
  let state = {
    color: prevState?.color || '#3b82f6',
    ...prevState
  };

  // UI Setup
  dom.innerHTML = \`
    <style>
      .card {
        background: rgba(15, 23, 42, 0.95);
        border: 2px solid #3b82f6;
        border-radius: 12px;
        padding: 15px;
        color: #fff;
        font-family: monospace;
        box-shadow: 0 4px 20px rgba(59, 130, 246, 0.2);
        width: 250px;
        box-sizing: border-box;
      }
      h3 { margin: 0 0 10px 0; color: #3b82f6; text-align: center; font-size: 14px; }
      canvas { width: 100%; height: 100px; background: #020617; border-radius: 6px; }
      .row { display: flex; justify-content: space-between; margin-top: 8px; font-size: 11px; align-items: center; }
    </style>
    <div class="card">
      <h3>📊 CANVAS VISUALIZER</h3>
      <canvas id="viz-canvas"></canvas>
      <div class="row">
        <span>Color:</span>
        <input type="color" id="color-picker" value="\${state.color}">
      </div>
    </div>
  \`;

  const canvas = dom.querySelector('#viz-canvas');
  const canvasCtx = canvas.getContext('2d');
  const colorPicker = dom.querySelector('#color-picker');

  // Set high resolution for canvas
  canvas.width = 250;
  canvas.height = 100;

  colorPicker.addEventListener('input', (e) => {
    ctx.bus.pubGlobal('viz_color', e.target.value);
  });

  const unsubColor = ctx.bus.subGlobal('viz_color', (val) => {
    state.color = val;
    colorPicker.value = val;
  });

  // Local analyser node setup. Muted jam clients still run real local Web Audio graphs,
  // so visualizers can inspect analyser data without producing speaker output.
  const analyser = ctx.audioCtx.createAnalyser();
  analyser.fftSize = 64;
  
  // Connect parent's output node to our analyser so we can visualize its stream!
  ctx.audioOut.connect(analyser);

  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);

  return {
    update(tick) {
      analyser.getByteFrequencyData(dataArray);
      
      canvasCtx.fillStyle = '#020617';
      canvasCtx.fillRect(0, 0, canvas.width, canvas.height);

      const barWidth = (canvas.width / bufferLength) * 1.5;
      let barHeight;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        barHeight = dataArray[i] / 2.55; // Normalize to 100

        canvasCtx.fillStyle = state.color;
        canvasCtx.fillRect(x, canvas.height - barHeight, barWidth - 2, barHeight);

        x += barWidth;
      }
    },
    getState() {
      return state;
    },
    destroy() {
      unsubColor();
      analyser.disconnect();
    }
  };
}`;
  } else {
    // Default interactive Synth Sound-Maker
    return `// Interactive Synthesizer Element
export default function setup(ctx, prevState) {
  const dom = ctx.domRoot;
  let state = {
    frequency: prevState?.frequency || 220,
    volume: prevState?.volume || 0.3,
    waveform: prevState?.waveform || 'sawtooth',
    cutoff: prevState?.cutoff || 1000,
    ...prevState
  };

  // Audio setup
  const osc = ctx.audioCtx.createOscillator();
  const filter = ctx.audioCtx.createBiquadFilter();
  const gain = ctx.audioCtx.createGain();

  osc.type = state.waveform;
  osc.frequency.setValueAtTime(state.frequency, ctx.audioCtx.currentTime);
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(state.cutoff, ctx.audioCtx.currentTime);
  gain.gain.setValueAtTime(state.volume, ctx.audioCtx.currentTime);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.audioOut);
  
  osc.start();

  // Create UI HTML
  dom.innerHTML = \`
    <style>
      .card {
        background: rgba(20, 20, 30, 0.95);
        border: 2px solid #ef4444;
        border-radius: 12px;
        padding: 15px;
        color: #fff;
        font-family: monospace;
        box-shadow: 0 4px 20px rgba(239, 68, 68, 0.2);
        width: 260px;
        box-sizing: border-box;
      }
      h3 { margin: 0 0 10px 0; color: #ef4444; text-align: center; font-size: 14px; }
      .row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 11px; align-items: center; }
      input[type=range] { flex-grow: 1; margin-left: 10px; accent-color: #ef4444; }
      .val { color: #fbbf24; font-weight: bold; min-width: 45px; text-align: right; }
      .wave-btn {
        flex: 1; margin: 0 2px; padding: 4px; background: #2d2d3d; border: 1px solid #ef4444;
        color: #fff; border-radius: 4px; cursor: pointer; font-size: 9px;
      }
      .wave-btn.active {
        background: #ef4444; color: #000; font-weight: bold;
      }
    </style>
    <div class="card">
      <h3>🎹 ANALOG SYNTH</h3>
      <div class="row">
        <span>Freq:</span>
        <input type="range" id="freq-slider" min="50" max="800" step="1" value="\${state.frequency}">
        <span class="val" id="freq-val">\${state.frequency}Hz</span>
      </div>
      <div class="row">
        <span>Cutoff:</span>
        <input type="range" id="cutoff-slider" min="100" max="4000" step="10" value="\${state.cutoff}">
        <span class="val" id="cutoff-val">\${state.cutoff}Hz</span>
      </div>
      <div class="row">
        <span>Volume:</span>
        <input type="range" id="vol-slider" min="0" max="1" step="0.01" value="\${state.volume}">
        <span class="val" id="vol-val">\${Math.round(state.volume * 100)}%</span>
      </div>
      <div class="row" style="margin-top: 10px;">
        <button class="wave-btn \${state.waveform==='sine'?'active':''}" data-wave="sine">Sine</button>
        <button class="wave-btn \${state.waveform==='triangle'?'active':''}" data-wave="triangle">Tri</button>
        <button class="wave-btn \${state.waveform==='sawtooth'?'active':''}" data-wave="sawtooth">Saw</button>
        <button class="wave-btn \${state.waveform==='square'?'active':''}" data-wave="square">Squ</button>
      </div>
    </div>
  \`;

  const freqSlider = dom.querySelector('#freq-slider');
  const freqVal = dom.querySelector('#freq-val');
  const cutoffSlider = dom.querySelector('#cutoff-slider');
  const cutoffVal = dom.querySelector('#cutoff-val');
  const volSlider = dom.querySelector('#vol-slider');
  const volVal = dom.querySelector('#vol-val');
  const waveBtns = dom.querySelectorAll('.wave-btn');

  // Input events - Route through Yjs global sync (pubGlobal) so all users stay identical!
  freqSlider.addEventListener('input', (e) => {
    ctx.bus.pubGlobal('synth_freq', parseFloat(e.target.value));
  });
  cutoffSlider.addEventListener('input', (e) => {
    ctx.bus.pubGlobal('synth_cutoff', parseFloat(e.target.value));
  });
  volSlider.addEventListener('input', (e) => {
    ctx.bus.pubGlobal('synth_vol', parseFloat(e.target.value));
  });
  waveBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      ctx.bus.pubGlobal('synth_wave', btn.dataset.wave);
    });
  });

  // Subscriptions to update state and audio
  const unsub1 = ctx.bus.subGlobal('synth_freq', (val) => {
    state.frequency = val;
    freqSlider.value = val;
    freqVal.textContent = val + 'Hz';
    osc.frequency.setTargetAtTime(val, ctx.audioCtx.currentTime, 0.05);
  });
  const unsub2 = ctx.bus.subGlobal('synth_cutoff', (val) => {
    state.cutoff = val;
    cutoffSlider.value = val;
    cutoffVal.textContent = val + 'Hz';
    filter.frequency.setTargetAtTime(val, ctx.audioCtx.currentTime, 0.05);
  });
  const unsub3 = ctx.bus.subGlobal('synth_vol', (val) => {
    state.volume = val;
    volSlider.value = val;
    volVal.textContent = Math.round(val * 100) + '%';
    gain.gain.setTargetAtTime(val, ctx.audioCtx.currentTime, 0.05);
  });
  const unsub4 = ctx.bus.subGlobal('synth_wave', (val) => {
    state.waveform = val;
    osc.type = val;
    waveBtns.forEach(btn => {
      if (btn.dataset.wave === val) btn.classList.add('active');
      else btn.classList.remove('active');
    });
  });

  // Subscribe to local bus (high-frequency) to listen to our LFO modifier if connected!
  const unsubLFO = ctx.bus.sub('${lfoElementId ? lfoElementId + ':lfo_value' : 'lfo_value'}', (lfoVal) => {
    // Modulate cutoff frequency using high-frequency LFO signal
    const baseCutoff = state.cutoff;
    const modulatedCutoff = Math.max(100, Math.min(4000, baseCutoff + lfoVal * 1500));
    filter.frequency.setValueAtTime(modulatedCutoff, ctx.audioCtx.currentTime);
  });

  return {
    update(tick) {
      // Optional animation
    },
    getState() {
      return state;
    },
    destroy() {
      unsub1();
      unsub2();
      unsub3();
      unsub4();
      unsubLFO();
      osc.stop();
      osc.disconnect();
      filter.disconnect();
      gain.disconnect();
    }
  };
}`;
  }
}

// Start HTTP server and bind WebSocket upgrade listeners
const server = http.createServer(app);

const wssYjs = new WebSocketServer({ noServer: true });
const wssController = new WebSocketServer({ noServer: true });
const wssTerminal = new WebSocketServer({ noServer: true });

// Handle standard Yjs connections
wssYjs.on('connection', (ws, req) => {
  setupWSConnection(ws, req, { docName: 'jam-workspace', gc: true });
});

// Handle custom raw low-latency controller connections
wssController.on('connection', (ws, req) => {
  const isHost = req.url.includes('host=true');
  
  if (isHost) {
    hostClient = ws;
    console.log('[Controller] Host connected');
  } else {
    controllerClients.add(ws);
    console.log('[Controller] Controller client connected. Count:', controllerClients.size);
  }

  ws.on('message', (message) => {
    // If we receive a message from a controller, forward it instantly to the host
    if (!isHost) {
      if (hostClient && hostClient.readyState === 1) {
        hostClient.send(message);
      }
    }
  });

  ws.on('close', () => {
    if (isHost) {
      hostClient = null;
      console.log('[Controller] Host disconnected');
    } else {
      controllerClients.delete(ws);
      console.log('[Controller] Controller client disconnected. Count:', controllerClients.size);
    }
  });
});

// Bridge one independent interactive agent PTY into each connected browser client.
wssTerminal.on('connection', async (ws) => {
  let session = null;

  try {
    session = await createAgentTerminalSession(ws);
  } catch (err) {
    sendTerminalMessage(ws, { type: 'data', data: `\r\n${err.message}\r\n` });
  }

  ws.on('message', raw => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'input') {
        session?.pty.write(String(msg.data || ''));
      } else if (msg.type === 'resize') {
        resizeAgentPty(session, msg.cols, msg.rows);
      } else if (msg.type === 'clear') {
        session.history.length = 0;
        sendTerminalMessage(ws, { type: 'clear' });
      }
    } catch (err) {
      session?.pty.write(raw.toString());
    }
  });

  ws.on('close', () => {
    closeAgentTerminalSession(session);
  });
});

// Intercept server upgrades and route accordingly
server.on('upgrade', (req, socket, head) => {
  const url = req.url || '';
  if (url.startsWith('/yjs')) {
    wssYjs.handleUpgrade(req, socket, head, (ws) => {
      wssYjs.emit('connection', ws, req);
    });
  } else if (url.startsWith('/controller')) {
    wssController.handleUpgrade(req, socket, head, (ws) => {
      wssController.emit('connection', ws, req);
    });
  } else if (url.startsWith('/agent-terminal')) {
    wssTerminal.handleUpgrade(req, socket, head, (ws) => {
      wssTerminal.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
});

server.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(`🎵 jam Server started on http://localhost:${PORT}`);
  console.log(`===============================================`);
});
