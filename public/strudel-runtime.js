import {
  getSuperdoughAudioController,
  initStrudel,
  soundAlias,
  soundMap,
  samples,
  silence,
  stack
} from '/vendor/strudel-web/index.mjs';

const DIRT_SAMPLES_URL = 'github:tidalcycles/dirt-samples';
const ROLAND_TR909_ALIASES = {
  bd: '909',
  sd: 'sd',
  hh: 'hh',
  cp: 'cp'
};

const runtimeState = {
  initPromise: null,
  repl: null,
  audioCtx: null,
  outputNode: null,
  outputConfigured: false,
  audioEnabled: false,
  patterns: new Map(),
  sources: new Map(),
  miniLocations: new Map(),
  running: new Map(),
  errors: new Map(),
  lastError: '',
  started: false,
  operationPromise: Promise.resolve(),
  commitPromise: Promise.resolve(),
  operationId: 0,
  elementOperations: new Map(),
  hardResetCount: 0,
  soundCatalogReady: false,
  highlightFrame: 0,
  lastHighlightPhase: null,
  highlightedPattern: null
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
  get miniLocations() {
    return Object.fromEntries(runtimeState.miniLocations.entries());
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
  get soundCatalogReady() {
    return runtimeState.soundCatalogReady;
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
      prebake: preloadOfficialSoundCatalogs,
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

async function preloadOfficialSoundCatalogs() {
  const [{ registerSoundfonts }] = await Promise.all([
    import('/vendor/strudel-soundfonts.js'),
    samples(DIRT_SAMPLES_URL)
  ]);
  registerSoundfonts();
  registerCompatibilityAliases();
  runtimeState.soundCatalogReady = true;
}

function registerCompatibilityAliases() {
  aliasSound('gm_piano', 'piano');
  aliasSound('gm_piano', 'acoustic_piano');

  for (const [suffix, source] of Object.entries(ROLAND_TR909_ALIASES)) {
    aliasSound(source, `rolandtr909_${suffix}`);
    aliasSound(source, `tr909_${suffix}`);
  }
}

function aliasSound(source, alias) {
  const sounds = soundMap?.get?.() || {};
  const normalizedAlias = String(alias).toLowerCase().replace(/\s+/g, '_');
  if (!sounds[normalizedAlias]) soundAlias(source, normalizedAlias);
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
  return queueRuntimeOperation(() => evaluateElementNow(elementId, code, options));
}

async function evaluateElementNow(elementId, code, options = {}) {
  const repl = await ensureRuntime();
  const source = String(code || '').trim() || 'silence';
  const running = options.running !== false;
  const gain = clamp(Number(options.gain), 0, 1, 1);
  const operationId = beginElementOperation(elementId);

  if (!running) {
    runtimeState.patterns.delete(elementId);
    runtimeState.sources.delete(elementId);
    runtimeState.miniLocations.delete(elementId);
    runtimeState.running.set(elementId, false);
    runtimeState.errors.delete(elementId);
    dispatchHighlightMetadata(elementId, []);
    await queueCommit();
    return getStatus(elementId);
  }

  runtimeState.lastError = '';
  const pattern = await repl.evaluate(source, false, true);
  const miniLocations = [...(repl.state?.miniLocations || [])];
  if (runtimeState.elementOperations.get(elementId) !== operationId) {
    await queueCommit();
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
  const elementPattern = typeof outputPattern.withContext === 'function'
    ? outputPattern.withContext(context => ({ ...context, jamElementId: elementId }))
    : outputPattern;

  runtimeState.patterns.set(elementId, elementPattern);
  runtimeState.sources.set(elementId, source);
  runtimeState.miniLocations.set(elementId, miniLocations);
  runtimeState.running.set(elementId, true);
  runtimeState.errors.delete(elementId);
  dispatchHighlightMetadata(elementId, miniLocations);
  await queueCommit();
  return getStatus(elementId);
}

async function removeElement(elementId) {
  return queueRuntimeOperation(() => removeElementNow(elementId));
}

async function removeElementNow(elementId) {
  beginElementOperation(elementId);
  runtimeState.patterns.delete(elementId);
  runtimeState.sources.delete(elementId);
  runtimeState.miniLocations.delete(elementId);
  runtimeState.running.delete(elementId);
  runtimeState.elementOperations.delete(elementId);
  runtimeState.errors.delete(elementId);
  dispatchHighlightMetadata(elementId, []);
  await queueCommit();
}

async function setAudioEnabled(enabled) {
  return queueRuntimeOperation(async () => {
    runtimeState.audioEnabled = Boolean(enabled);
    await queueCommit();
  });
}

async function panic() {
  return queueRuntimeOperation(async () => {
    runtimeState.patterns.clear();
    runtimeState.sources.clear();
    runtimeState.miniLocations.clear();
    runtimeState.running.clear();
    runtimeState.elementOperations.clear();
    runtimeState.errors.clear();
    runtimeState.lastError = '';
    if (runtimeState.repl) {
      await runtimeState.repl.setPattern(silence, true);
      runtimeState.repl.stop();
    }
    runtimeState.started = false;
  });
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

function queueRuntimeOperation(operation) {
  const nextOperation = runtimeState.operationPromise
    .catch(() => {})
    .then(operation);
  runtimeState.operationPromise = nextOperation;
  return nextOperation;
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
  runtimeState.highlightedPattern = pattern;
  if (options.resetScheduler) {
    repl.stop();
    runtimeState.started = false;
    runtimeState.hardResetCount += 1;
  }
  await repl.setPattern(pattern, true);

  if (runtimeState.audioEnabled && patterns.length) {
    repl.start();
    runtimeState.started = true;
    startHighlightLoop();
  } else {
    repl.stop();
    runtimeState.started = false;
  }
}

function startHighlightLoop() {
  if (runtimeState.highlightFrame || typeof requestAnimationFrame !== 'function') return;
  const tick = () => {
    runtimeState.highlightFrame = 0;
    dispatchCurrentHighlights();
    if (runtimeState.started) {
      runtimeState.highlightFrame = requestAnimationFrame(tick);
    }
  };
  runtimeState.highlightFrame = requestAnimationFrame(tick);
}

function dispatchCurrentHighlights() {
  const pattern = runtimeState.highlightedPattern;
  const repl = runtimeState.repl;
  if (!pattern || !repl?.scheduler || !runtimeState.patterns.size) return;

  const phase = repl.scheduler.now();
  const begin = runtimeState.lastHighlightPhase == null
    ? phase
    : Math.max(runtimeState.lastHighlightPhase, phase - 0.1);
  runtimeState.lastHighlightPhase = phase;

  let haps = [];
  try {
    haps = pattern.queryArc(begin, phase);
  } catch {
    return;
  }

  for (const elementId of runtimeState.patterns.keys()) {
    const activeHaps = haps.filter(hap => {
      if (hap?.context?.jamElementId !== elementId || !hap.whole) return false;
      const hapBegin = timeValue(hap.whole.begin);
      const hapEnd = timeValue(hap.endClipped ?? hap.whole.end);
      return phase >= hapBegin && phase <= hapEnd;
    });
    dispatchHighlightFrame(elementId, phase, activeHaps);
  }
}

function dispatchHighlightMetadata(elementId, miniLocations) {
  window.dispatchEvent(new CustomEvent('jam-strudel-mini-locations', {
    detail: { elementId, miniLocations }
  }));
}

function dispatchHighlightFrame(elementId, phase, haps) {
  window.dispatchEvent(new CustomEvent('jam-strudel-highlight-frame', {
    detail: { elementId, phase, haps }
  }));
}

function timeValue(value) {
  if (typeof value === 'number') return value;
  const numeric = Number(value?.valueOf?.());
  return Number.isFinite(numeric) ? numeric : 0;
}

function clamp(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}
