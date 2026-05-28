import {
  getSuperdoughAudioController,
  initStrudel,
  samples,
  silence,
  stack
} from '/vendor/strudel-web/index.mjs';

const runtimeState = {
  initPromise: null,
  repl: null,
  audioCtx: null,
  outputNode: null,
  outputConfigured: false,
  audioEnabled: false,
  patterns: new Map(),
  sources: new Map(),
  running: new Map(),
  errors: new Map(),
  lastError: '',
  started: false,
  commitPromise: Promise.resolve(),
  operationId: 0,
  elementOperations: new Map(),
  hardResetCount: 0
};

window.__jamStrudelRuntimeDebug = {
  state: runtimeState,
  get patternCount() {
    return runtimeState.patterns.size;
  },
  get activeElementIds() {
    return [...runtimeState.patterns.keys()];
  },
  get sources() {
    return Object.fromEntries(runtimeState.sources.entries());
  },
  async getRegisteredSoundTypes(names = []) {
    await ensureRuntime();
    const info = await import('/vendor/strudel-web/index.mjs');
    const sounds = info.soundMap?.get?.() || {};
    return Object.fromEntries(names.map(name => [name, sounds[name]?.data?.type || '']));
  },
  get running() {
    return Object.fromEntries(runtimeState.running.entries());
  },
  get hardResetCount() {
    return runtimeState.hardResetCount;
  },
  get lastError() {
    return runtimeState.lastError;
  },
  panic
};

export async function getJamStrudelRuntime(options = {}) {
  if (options.audioCtx && !runtimeState.audioCtx) runtimeState.audioCtx = options.audioCtx;
  if (options.outputNode && !runtimeState.outputNode) runtimeState.outputNode = options.outputNode;
  if (typeof options.audioEnabled === 'boolean') runtimeState.audioEnabled = options.audioEnabled;
  await ensureRuntime();
  return {
    evaluateElement,
    removeElement,
    setAudioEnabled,
    panic,
    getStatus
  };
}

async function ensureRuntime() {
  if (runtimeState.repl) return runtimeState.repl;
  if (!runtimeState.audioCtx) throw new Error('Strudel runtime needs the jam AudioContext');

  if (!runtimeState.initPromise) {
    runtimeState.initPromise = initStrudel({
      audioContext: runtimeState.audioCtx,
      prebake: () => samples('github:tidalcycles/dirt-samples'),
      onEvalError(error) {
        runtimeState.lastError = error?.message || String(error);
      }
    }).then((repl) => {
      runtimeState.repl = repl;
      configureOutputNode();
      return repl;
    });
  }

  return runtimeState.initPromise;
}

function configureOutputNode() {
  if (runtimeState.outputConfigured || !runtimeState.outputNode) return;
  const controller = getSuperdoughAudioController();
  const destinationGain = controller?.output?.destinationGain;
  if (!destinationGain) return;
  try { destinationGain.disconnect(); } catch {}
  destinationGain.connect(runtimeState.outputNode);
  runtimeState.outputConfigured = true;
}

async function evaluateElement(elementId, code, options = {}) {
  const repl = await ensureRuntime();
  const source = String(code || '').trim() || 'silence';
  const running = options.running !== false;
  const gain = clamp(Number(options.gain), 0, 1, 1);
  const operationId = beginElementOperation(elementId);

  if (!running) {
    runtimeState.patterns.delete(elementId);
    runtimeState.sources.delete(elementId);
    runtimeState.running.set(elementId, false);
    runtimeState.errors.delete(elementId);
    await queueCommit({ resetScheduler: true });
    return getStatus(elementId);
  }

  runtimeState.lastError = '';
  const pattern = await repl.evaluate(source, false, false);
  if (runtimeState.elementOperations.get(elementId) !== operationId) {
    await queueCommit({ resetScheduler: true });
    return getStatus(elementId);
  }
  if (!pattern) {
    const message = runtimeState.lastError || 'Strudel evaluation failed';
    runtimeState.errors.set(elementId, message);
    throw new Error(message);
  }

  const outputPattern = gain < 1 && typeof pattern.gain === 'function'
    ? pattern.gain(gain)
    : pattern;
  const elementPattern = typeof outputPattern.docId === 'function'
    ? outputPattern.docId(elementId)
    : outputPattern;

  runtimeState.patterns.set(elementId, elementPattern);
  runtimeState.sources.set(elementId, source);
  runtimeState.running.set(elementId, true);
  runtimeState.errors.delete(elementId);
  await queueCommit();
  return getStatus(elementId);
}

async function removeElement(elementId) {
  beginElementOperation(elementId);
  runtimeState.patterns.delete(elementId);
  runtimeState.sources.delete(elementId);
  runtimeState.running.delete(elementId);
  runtimeState.elementOperations.delete(elementId);
  runtimeState.errors.delete(elementId);
  await queueCommit({ resetScheduler: true });
}

async function setAudioEnabled(enabled) {
  runtimeState.audioEnabled = Boolean(enabled);
  await queueCommit();
}

async function panic() {
  runtimeState.patterns.clear();
  runtimeState.sources.clear();
  runtimeState.running.clear();
  runtimeState.elementOperations.clear();
  runtimeState.errors.clear();
  runtimeState.lastError = '';
  if (runtimeState.repl) {
    await runtimeState.repl.setPattern(silence, true);
    runtimeState.repl.stop();
  }
  runtimeState.started = false;
}

function getStatus(elementId) {
  return {
    patternCount: runtimeState.patterns.size,
    error: runtimeState.errors.get(elementId) || '',
    audioEnabled: runtimeState.audioEnabled,
    started: runtimeState.started
  };
}

function beginElementOperation(elementId) {
  runtimeState.operationId += 1;
  runtimeState.elementOperations.set(elementId, runtimeState.operationId);
  return runtimeState.operationId;
}

function queueCommit(options = {}) {
  runtimeState.commitPromise = runtimeState.commitPromise
    .catch(() => {})
    .then(() => commitPattern(options));
  return runtimeState.commitPromise;
}

async function commitPattern(options = {}) {
  const repl = await ensureRuntime();
  const patterns = [...runtimeState.patterns.values()];
  const pattern = patterns.length ? stack(...patterns) : silence;
  if (options.resetScheduler) {
    repl.stop();
    runtimeState.started = false;
    runtimeState.hardResetCount += 1;
  }
  await repl.setPattern(pattern, true);

  if (runtimeState.audioEnabled && patterns.length) {
    repl.start();
    runtimeState.started = true;
  } else {
    repl.stop();
    runtimeState.started = false;
  }
}

function clamp(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}
