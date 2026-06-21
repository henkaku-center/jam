import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

let isAudioOutputEnabled = shouldEnableAudioFromUrl();
let audioCtx = null;
let masterGain = null;
let camera = { x: 0, y: 0, zoom: 1.0 };
const MIN_CAMERA_ZOOM = 0.08;
const MAX_CAMERA_ZOOM = 2.5;
let hasAutoCenteredInitialWorkspace = false;
let hasUserMovedCamera = false;

const activeElements = new Map();
const compilingElements = new Set();
let selectedElementId = null;

let ydoc = null;
let provider = null;
let elementsMap = null;
let clockMap = null;
let globalBusMap = null;

const localBusListeners = new Map();
let serverClockOffset = 0;

const autoplayOverlay = document.getElementById('autoplay-overlay');
const appContainer = document.getElementById('app');
const viewport = document.getElementById('canvas-viewport');
const gridLayer = document.getElementById('canvas-grid');
const elementsLayer = document.getElementById('canvas-elements');
const addElementMenu = document.getElementById('add-element-menu');
const focusOverlay = document.getElementById('focus-overlay');
const agentTerminal = document.getElementById('agent-terminal');
const agentTerminalViewport = document.getElementById('agent-terminal-viewport');
const agentTerminalFocusZone = document.getElementById('agent-terminal-focus-zone');
let agentTerminalTerm = null;

const DEFAULT_STRUDEL_CODE = '';
const LOCAL_COLLABORATOR_COLOR = '#67e8f9';
const REMOTE_COLLABORATOR_COLOR = '#5eead4';
const ELEMENT_ADD_OPTIONS = {
  strudel: {
    filePath: '/elements/strudel_clocked_element.js',
    type: 'strudel',
    prompt: DEFAULT_STRUDEL_CODE,
    width: 360,
    height: 260
  },
  synth: {
    filePath: '/elements/_template_element.js',
    type: 'synth',
    prompt: 'blank synth element',
    width: 320,
    height: 220
  },
  visual: {
    filePath: '/elements/_template_element.js',
    type: 'visual',
    prompt: 'blank visual element',
    width: 320,
    height: 220
  },
  tool: {
    filePath: '/elements/_template_element.js',
    type: 'tool',
    prompt: 'blank tool element',
    width: 320,
    height: 220
  }
};
let pendingAddMenuWorldPosition = null;

const roomName = window.location.hash.slice(1) || 'default-jam';
window.location.hash = roomName;

function shouldEnableAudioFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const audio = (params.get('audio') || '').toLowerCase();
  const muted = (params.get('muted') || '').toLowerCase();
  return audio === 'on' || audio === '1' || audio === 'true' || muted === 'false' || params.get('host') === 'true';
}

function getCollaboratorIdentity() {
  const storageKey = 'jam-collaborator-v1';
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
    if (saved?.name && saved?.color) {
      const identity = {
        ...saved,
        color: REMOTE_COLLABORATOR_COLOR,
        colorLight: `${REMOTE_COLLABORATOR_COLOR}cc`,
        localColor: LOCAL_COLLABORATOR_COLOR
      };
      localStorage.setItem(storageKey, JSON.stringify(identity));
      return identity;
    }
  } catch {}

  const identity = {
    name: `jam-${Math.random().toString(36).slice(2, 6)}`,
    color: REMOTE_COLLABORATOR_COLOR,
    colorLight: `${REMOTE_COLLABORATOR_COLOR}cc`,
    localColor: LOCAL_COLLABORATOR_COLOR
  };
  try {
    localStorage.setItem(storageKey, JSON.stringify(identity));
  } catch {}
  return identity;
}

document.getElementById('join-host-btn').addEventListener('click', () => {
  isAudioOutputEnabled = shouldEnableAudioFromUrl();
  initializeSystem();
});

function initializeSystem() {
  autoplayOverlay.classList.add('hidden');
  appContainer.classList.remove('hidden');
  window.jamAudioOutputEnabled = isAudioOutputEnabled;

  initAudio();
  initYjs();
  initAgentTerminalSocket();
  setupViewportNavigation();
  requestAnimationFrame(animationLoop);
  setupUIActions();
}

function initAudio() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  audioCtx = new AudioContextClass();
  
  masterGain = audioCtx.createGain();
  masterGain.connect(audioCtx.destination);
  window.jamMasterGain = masterGain;
  
  if (!isAudioOutputEnabled) {
    masterGain.gain.setValueAtTime(0, audioCtx.currentTime);
    console.log('[Audio] Jam client loaded with local audio muted. Master gain = 0.');
  } else {
    masterGain.gain.setValueAtTime(1, audioCtx.currentTime);
    console.log('[Audio] Jam client loaded with local audio enabled. Master gain = 1.');
  }
}

function initYjs() {
  ydoc = new Y.Doc();
  
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const serverUrl = `${protocol}//${window.location.host}/yjs`;
  
  provider = new WebsocketProvider(serverUrl, 'jam-workspace', ydoc);
  const collaborator = getCollaboratorIdentity();
  provider.awareness?.setLocalStateField('user', collaborator);
  
  elementsMap = ydoc.getMap('elements');
  clockMap = ydoc.getMap('clock');
  globalBusMap = ydoc.getMap('global_bus');

  window.ydoc = ydoc;
  window.jamAwareness = provider.awareness;
  window.jamCollaborator = collaborator;
  window.elementsMap = elementsMap;
  window.activeElements = activeElements;

  provider.on('status', event => {
    console.log(`[Yjs Status] Connected: ${event.status}`);
  });

  elementsMap.observe(event => {
    syncElementsFromMap();
  });

  globalBusMap.observe(event => {
    event.keysChanged.forEach(key => {
      const val = globalBusMap.get(key);
      const callbacks = globalBusListeners.get(key);
      if (callbacks) {
        callbacks.forEach(cb => {
          try { cb(val); } catch (e) { console.error(`Error in subGlobal callback: ${e}`); }
        });
      }
    });
  });

  // Initialize clock if the shared Yjs document does not have one yet.
  provider.on('synced', () => {
    if (!clockMap.has('bpm')) {
      ydoc.transact(() => {
        clockMap.set('bpm', 120);
        clockMap.set('startTime', Date.now());
      });
    }
    syncElementsFromMap();
    performVisualNTPHandshake();
  });
}

async function performVisualNTPHandshake() {
  const t1 = Date.now();
  try {
    const res = await fetch('/api/time', { cache: 'no-store' });
    if (!res.ok) throw new Error(`time endpoint returned ${res.status}`);
    const { serverTime } = await res.json();
    const t4 = Date.now();
    const midpoint = t1 + ((t4 - t1) / 2);
    const rtt = t4 - t1;
    serverClockOffset = Number(serverTime) - midpoint;
    console.log(`[Clock Sync] Handshake complete. RTT: ${rtt}ms. Estimated Server Offset: ${serverClockOffset}ms`);
  } catch (err) {
    console.warn('[Clock Sync] Handshake failed, fallback to local clock:', err);
    serverClockOffset = 0;
  }
}

function getSyncTime() {
  return Date.now() + serverClockOffset;
}

function changeBPM(newBPM) {
  if (!ydoc) return;
  
  const currentBPM = clockMap.get('bpm') || 120;
  if (currentBPM === newBPM) return;
  
  const oldStartTime = clockMap.get('startTime') || Date.now();
  const syncNow = getSyncTime();
  
  const elapsedBeats = (syncNow - oldStartTime) * (currentBPM / 60000);
  
  const newStartTime = syncNow - (elapsedBeats * 60000 / newBPM);
  
  ydoc.transact(() => {
    clockMap.set('bpm', newBPM);
    clockMap.set('startTime', newStartTime);
  });
  console.log(`[Clock] Tempo pivoted to ${newBPM} BPM. Seamless transition.`);
}

const LOOK_AHEAD_TIME = 0.100; // 100ms
const SCHEDULER_INTERVAL = 25; // ms
let lastScheduledStep = -1;
const clockCallbacks = new Set();

function startScheduler() {
  setInterval(() => {
    if (!audioCtx || !ydoc) return;
    
    const bpm = clockMap.get('bpm') || 120;
    const startTime = clockMap.get('startTime') || Date.now();
    
    const currentTime = audioCtx.currentTime;
    const syncNow = getSyncTime();
    const elapsedBeats = (syncNow - startTime) * (bpm / 60000);
    const stepDuration = 60.0 / bpm / 4.0; // Seconds per 16th note
    const currentStep = Math.floor(elapsedBeats * 4.0);
    const scheduleWindowEnd = currentTime + LOOK_AHEAD_TIME;
    
    for (let s = currentStep; s < currentStep + 8; s++) {
      if (s <= lastScheduledStep) continue;
      
      const stepBeatOffset = s * 0.25;
      const stepEpochTime = startTime + (stepBeatOffset * 60000 / bpm);
      
      const stepLocalEpochTime = stepEpochTime - serverClockOffset;
      const timeRemainingMs = stepLocalEpochTime - Date.now();
      const targetAudioTime = currentTime + (timeRemainingMs / 1000);
      
      if (targetAudioTime >= currentTime && targetAudioTime < scheduleWindowEnd) {
        clockCallbacks.forEach(({ onTick }) => {
          try {
            onTick({
              step: s,
              time: targetAudioTime,
              duration: stepDuration,
              bpm: bpm
            });
          } catch (e) {
            console.error('[Scheduler] Callback error in element:', e);
          }
        });
        
        lastScheduledStep = s;
        
        if (s % 4 === 0) {
          triggerVisualMetronome();
        }
      }
    }
  }, SCHEDULER_INTERVAL);
}

function triggerVisualMetronome() {
  // Tempo is shown as a compact editor only; no global metronome UI is rendered.
}

startScheduler();

const signalBus = {
  pub(key, val, senderId) {
    const namespacedKey = (senderId && !key.includes(':')) ? `${senderId}:${key}` : key;
    const listeners = localBusListeners.get(namespacedKey);
    if (listeners) {
      listeners.forEach(cb => cb(val));
    }
  },
  
  sub(key, callback, receiverId) {
    const namespacedKey = (receiverId && !key.includes(':')) ? `${receiverId}:${key}` : key;
    if (!localBusListeners.has(namespacedKey)) {
      localBusListeners.set(namespacedKey, new Set());
    }
    localBusListeners.get(namespacedKey).add(callback);
    return () => {
      const list = localBusListeners.get(namespacedKey);
      if (list) {
        list.delete(callback);
        if (list.size === 0) localBusListeners.delete(namespacedKey);
      }
    };
  },

  pubGlobal(key, val, senderId) {
    if (!ydoc) return;
    const namespacedKey = senderId && !key.startsWith('global:') ? `${senderId}:${key}` : key;
    ydoc.transact(() => {
      globalBusMap.set(namespacedKey, val);
    });
  },

  subGlobal(key, callback, receiverId) {
    const namespacedKey = receiverId && !key.startsWith('global:') ? `${receiverId}:${key}` : key;
    
    if (!globalBusListeners.has(namespacedKey)) {
      globalBusListeners.set(namespacedKey, new Set());
    }
    globalBusListeners.get(namespacedKey).add(callback);
    
    if (ydoc && globalBusMap.has(namespacedKey)) {
      try { callback(globalBusMap.get(namespacedKey)); } catch(e) {}
    }

    return () => {
      const list = globalBusListeners.get(namespacedKey);
      if (list) {
        list.delete(callback);
        if (list.size === 0) globalBusListeners.delete(namespacedKey);
      }
    };
  }
};

const globalBusListeners = new Map();

function initAgentTerminalSocket() {
  if (!agentTerminal || !agentTerminalViewport || !window.Terminal || !window.FitAddon) return;

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${window.location.host}/agent-terminal`;
  const socket = new WebSocket(url);
  const fitAddon = new window.FitAddon.FitAddon();
  const term = new window.Terminal({
    cursorBlink: true,
    convertEol: true,
    fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
    fontSize: 11,
    lineHeight: 1.2,
    scrollback: 2000,
    theme: {
      background: '#000508',
      foreground: '#d1fae5',
      cursor: '#67e8f9',
      selectionBackground: '#164e63'
    }
  });

  agentTerminalTerm = term;
  term.loadAddon(fitAddon);
  term.open(agentTerminalViewport);
  const updateFocusZone = () => {
    if (!agentTerminalFocusZone) return;
    const cursorProxy = agentTerminalViewport.querySelector('.xterm-helper-textarea');
    const terminalRect = agentTerminal.getBoundingClientRect();
    const cursorRect = cursorProxy?.getBoundingClientRect();

    if (!cursorRect || cursorRect.width === 0 || cursorRect.height === 0) {
      agentTerminalFocusZone.style.display = 'none';
      agentTerminal.classList.remove('focus-zone-obscured');
      return;
    }

    const targetWidth = 360;
    const targetHeight = 48;
    const cursorCenterX = cursorRect.left - terminalRect.left + cursorRect.width / 2;
    const cursorCenterY = cursorRect.top - terminalRect.top + cursorRect.height / 2;
    const left = Math.max(0, Math.min(terminalRect.width - targetWidth, cursorCenterX - targetWidth / 2));
    const top = Math.max(0, Math.min(terminalRect.height - targetHeight, cursorCenterY - targetHeight / 2));
    const nextRect = {
      left: terminalRect.left + left,
      top: terminalRect.top + top,
      right: terminalRect.left + left + targetWidth,
      bottom: terminalRect.top + top + targetHeight
    };
    const overlapsCanvasElement = [...document.querySelectorAll('.canvas-element-wrapper:not(.virtualized)')]
      .some(wrapper => {
        if (wrapper.style.visibility === 'hidden') return false;
        const rect = wrapper.getBoundingClientRect();
        return rect.width > 0 &&
          rect.height > 0 &&
          rect.left < nextRect.right &&
          rect.right > nextRect.left &&
          rect.top < nextRect.bottom &&
          rect.bottom > nextRect.top;
      });

    agentTerminalFocusZone.style.display = 'block';
    agentTerminalFocusZone.style.left = `${left}px`;
    agentTerminalFocusZone.style.top = `${top}px`;
    agentTerminalFocusZone.style.width = `${targetWidth}px`;
    agentTerminalFocusZone.style.height = `${targetHeight}px`;
    agentTerminal.classList.toggle('focus-zone-obscured', overlapsCanvasElement);
  };

  const scheduleFocusZoneUpdate = () => {
    requestAnimationFrame(updateFocusZone);
  };

  term.onRender(scheduleFocusZoneUpdate);
  agentTerminalFocusZone?.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    term.focus();
  });
  agentTerminalFocusZone?.addEventListener('click', (event) => {
    event.preventDefault();
    term.focus();
  });
  agentTerminalFocusZone?.addEventListener('mouseenter', () => {
    agentTerminal.classList.add('cursor-hover');
  });
  agentTerminalFocusZone?.addEventListener('mouseleave', () => {
    agentTerminal.classList.remove('cursor-hover');
  });

  const fitAndSync = () => {
    try {
      fitAddon.fit();
      scheduleFocusZoneUpdate();
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      }
    } catch (err) {
      console.warn('[Agent Terminal] Fit failed:', err);
    }
  };

  requestAnimationFrame(fitAndSync);
  window.addEventListener('resize', fitAndSync);
  new ResizeObserver(fitAndSync).observe(agentTerminal);

  term.onData(data => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'input', data }));
    }
  });

  socket.onopen = () => {
    agentTerminal.classList.add('online');
    fitAndSync();
  };

  socket.onclose = () => {
    agentTerminal.classList.remove('online');
  };

  socket.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === 'clear') {
        term.clear();
        scheduleFocusZoneUpdate();
      }
      if (msg.type === 'data') {
        term.write(msg.data || '', scheduleFocusZoneUpdate);
      }
    } catch (err) {
      term.write(String(event.data), scheduleFocusZoneUpdate);
    }
  };
}

function isTextEntryOrTerminalFocused() {
  const active = document.activeElement;
  return Boolean(active?.matches?.('input, textarea, select, [contenteditable="true"], .xterm-helper-textarea'));
}

function createElementHarnessContext(elementId, audioOutNode) {
  const trackedListeners = [];
  const trackedIntervals = [];
  const trackedTimeouts = [];
  const trackedAudioNodes = [];
  const elementClockCallbacks = [];

  const domWrapper = document.createElement('div');
  domWrapper.className = 'element-shadow-container';
  const shadowRoot = domWrapper.attachShadow({ mode: 'open' });

  const _srReset = new CSSStyleSheet();
  _srReset.replaceSync('* { border-radius: 0 !important; }');
  shadowRoot.adoptedStyleSheets = [_srReset];

  const trackedAddEventListener = (target, type, listener, options) => {
    target.addEventListener(type, listener, options);
    trackedListeners.push({ target, type, listener, options });
  };

  const domRootProxy = new Proxy(shadowRoot, {
    get(target, prop) {
      if (prop === 'addEventListener') {
        return (type, listener, options) => trackedAddEventListener(shadowRoot, type, listener, options);
      }
      const val = target[prop];
      if (typeof val === 'function') return val.bind(target);
      return val;
    },
    set(target, prop, value) {
      // Direct assignment bypasses V8 context binding issues on native setters (like innerHTML)
      target[prop] = value;
      return true;
    }
  });

  const audioCtxProxy = new Proxy(audioCtx, {
    get(target, prop) {
      const val = target[prop];
      if (typeof val === 'function') {
        const boundVal = val.bind(target);
        return (...args) => {
          const node = boundVal(...args);
          if (node && typeof node.disconnect === 'function') {
            trackedAudioNodes.push(node);
          }
          return node;
        };
      }
      return val;
    }
  });

  const clockProxy = {
    get bpm() {
      return clockMap.get('bpm') || 120;
    },
    get startTime() {
      return clockMap.get('startTime') || Date.now();
    },
    now: getSyncTime,
    onTick(callback) {
      const cbObj = { id: elementId, onTick: callback };
      clockCallbacks.add(cbObj);
      elementClockCallbacks.push(cbObj);
      return () => {
        clockCallbacks.delete(cbObj);
        const idx = elementClockCallbacks.indexOf(cbObj);
        if (idx !== -1) elementClockCallbacks.splice(idx, 1);
      };
    }
  };

  const busProxy = {
    pub: (key, val) => signalBus.pub(key, val, elementId),
    sub: (key, cb) => signalBus.sub(key, cb, elementId),
    pubGlobal: (key, val) => signalBus.pubGlobal(key, val, elementId),
    subGlobal: (key, cb) => signalBus.subGlobal(key, cb, elementId)
  };

  const ctx = {
    elementId,
    audioCtx: audioCtxProxy,
    rawAudioCtx: audioCtx,
    audioOut: audioOutNode,
    domRoot: domRootProxy,
    ydoc,
    awareness: provider?.awareness || null,
    clock: clockProxy,
    bus: busProxy,
    beginElementDrag: (point) => {
      if (!point || !Number.isFinite(point.clientX) || !Number.isFinite(point.clientY)) return;
      domWrapper.dispatchEvent(new CustomEvent('jam-begin-element-drag', {
        bubbles: true,
        composed: true,
        detail: {
          clientX: point.clientX,
          clientY: point.clientY
        }
      }));
    },
    requestLayout: (patch) => requestElementLayout(elementId, patch),
    deleteSelf: () => deleteElementById(elementId),
    isCurrentInstance: () => activeElements.get(elementId)?.harnessDom === domWrapper
  };

  const forceTearDown = () => {
    elementClockCallbacks.forEach(cb => clockCallbacks.delete(cb));
    
    trackedIntervals.forEach(clearInterval);
    trackedTimeouts.forEach(clearTimeout);

    trackedListeners.forEach(({ target, type, listener, options }) => {
      try { target.removeEventListener(type, listener, options); } catch(e) {}
    });

    trackedAudioNodes.forEach(node => {
      try { node.disconnect(); } catch(e) {}
      try { if (typeof node.stop === 'function') node.stop(); } catch(e) {}
    });
  };

  return { ctx, domWrapper, shadowRoot, forceTearDown };
}

async function instantiateElement(id, layout, options = {}) {
  compilingElements.add(id);
  try {
    let prevState = null;
    const existingWrapper = activeElements.get(id);

    if (existingWrapper?.runtime && typeof existingWrapper.runtime.getState === 'function') {
      try { prevState = existingWrapper.runtime.getState(); } catch (e) { console.error(e); }
    }

    // Muted clients still build the graph so visualizers and stateful elements behave identically.
    const elementVolume = audioCtx.createGain();
    const elementFilter = audioCtx.createBiquadFilter();
    const elementPanner = audioCtx.createStereoPanner();
    elementFilter.type = 'lowpass';

    elementVolume.connect(elementFilter);
    elementFilter.connect(elementPanner);
    elementPanner.connect(masterGain);

    const harness = createElementHarnessContext(id, elementVolume);

    let transpiledCode = '';
    try {
      const res = await fetch(`/api/compile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: layout.prompt || `Initialize or reload module`,
          elementId: id,
          filePath: layout.filePath,
          prevState,
          forceCompile: Boolean(options.forceCompile),
          authored: layout.authored || 'codegen',
          allowOverwrite: layout.authored !== 'hand'
        })
      });
      const data = await res.json();
      transpiledCode = data.transpiledCode;
    } catch (err) {
      console.error(`[Lifecycle] Failed fetching transpiled code for ${id}:`, err);
      return;
    }

    let setupFn = null;
    try {
      setupFn = new Function(transpiledCode)();
    } catch (err) {
      renderErrorUI(harness.shadowRoot, err);
      console.error(`[Sandbox Compile Error] ${id}:`, err);
    }

    let runtime = null;
    if (setupFn) {
      try {
        runtime = await setupFn(harness.ctx, prevState);
      } catch (err) {
        renderErrorUI(harness.shadowRoot, err);
        console.error(`[Sandbox Runtime Error] ${id} in setup():`, err);
      }
    }

    const domWrapper = document.createElement('div');
    domWrapper.id = `wrapper-${id}`;
    domWrapper.className = 'canvas-element-wrapper';
    if (layout.type) domWrapper.classList.add(`element-type-${layout.type}`);
    applyElementLayoutToWrapper(domWrapper, layout);
    domWrapper.appendChild(harness.domWrapper);
    const disposeElementDragging = setupElementDragging(domWrapper, id);

    if (existingWrapper) {
      const bpm = clockMap.get('bpm') || 120;
      const startTime = clockMap.get('startTime') || Date.now();
      const syncNow = getSyncTime();
      const elapsedBeats = (syncNow - startTime) * (bpm / 60000);
      const currentBar = Math.floor(elapsedBeats / 4);
      const nextBarBeats = (currentBar + 1) * 4;
      const nextBarEpoch = startTime + (nextBarBeats * 60000 / bpm);
      const targetAudioTime = audioCtx.currentTime + ((nextBarEpoch - syncNow) / 1000);

      // Bar+2 protects against late reloads that leave less than 200ms before the next downbeat.
      const safetyBuffer = 0.200;
      let crossfadeTime = targetAudioTime;
      if (crossfadeTime - audioCtx.currentTime < safetyBuffer) {
        const extendedBarBeats = (currentBar + 2) * 4;
        const extendedEpoch = startTime + (extendedBarBeats * 60000 / bpm);
        crossfadeTime = audioCtx.currentTime + ((extendedEpoch - syncNow) / 1000);
      }

      console.log(`[Hot-Reload] Queuing downbeat crossfade at AudioContext time ${crossfadeTime.toFixed(3)}s`);
      elementVolume.gain.setValueAtTime(0, audioCtx.currentTime);
      elementVolume.gain.setValueAtTime(0, crossfadeTime - 0.05);
      elementVolume.gain.linearRampToValueAtTime(1, crossfadeTime + 0.05);

      if (existingWrapper.audioVolumeNode) {
        existingWrapper.audioVolumeNode.gain.setValueAtTime(1, crossfadeTime - 0.05);
        existingWrapper.audioVolumeNode.gain.linearRampToValueAtTime(0, crossfadeTime + 0.05);
      }

      setTimeout(() => {
        if (existingWrapper.runtime && typeof existingWrapper.runtime.destroy === 'function') {
          try { existingWrapper.runtime.destroy(); } catch (e) { console.error(e); }
        }
        existingWrapper.disposeElementDragging?.();
        existingWrapper.forceTearDown();
        existingWrapper.domWrapper.remove();
        console.log(`[Hot-Reload] Disposed old element ${id}`);
      }, (crossfadeTime - audioCtx.currentTime + 0.2) * 1000);
    } else {
      elementVolume.gain.setValueAtTime(1, audioCtx.currentTime);
    }

    const oldElementNode = document.getElementById(`wrapper-${id}`);
    if (oldElementNode) oldElementNode.remove();
    elementsLayer.appendChild(domWrapper);

    activeElements.set(id, {
      id,
      domWrapper,
      harnessDom: harness.domWrapper,
      runtime,
      forceTearDown: harness.forceTearDown,
      audioVolumeNode: elementVolume,
      audioFilterNode: elementFilter,
      audioPannerNode: elementPanner,
      disposeElementDragging,
      layout
    });
  } finally {
    compilingElements.delete(id);
    if (activeElements.has(id) && elementsMap?.has(id)) queueMicrotask(syncElementsFromMap);
  }
}

function renderErrorUI(shadowRoot, err) {
  shadowRoot.innerHTML = `
    <style>
      .error-card {
        background: #1e1014;
        border: 2px solid var(--accent-danger, #f43f5e);
        padding: 12px;
        color: #ff859b;
        font-family: monospace;
        font-size: 11px;
        width: 220px;
        white-space: pre-wrap;
      }
      .error-title { font-weight: bold; margin-bottom: 6px; color: #f43f5e; }
    </style>
    <div class="error-card">
      <div class="error-title">⚠️ Runtime Error</div>
      <div>${err.message}</div>
    </div>
  `;
}

function updateSpatialAudioAndLOD() {
  if (!audioCtx) return;

  activeElements.forEach((element, id) => {
    const layout = element.layout;
    if (!layout) return;
    if (!element.audioVolumeNode || !element.audioFilterNode || !element.audioPannerNode) return;

    const now = audioCtx.currentTime;

    if (!isFocusModeActive) {
      element.audioVolumeNode.gain.setTargetAtTime(1, now, 0.08);
      element.audioFilterNode.frequency.setTargetAtTime(20000, now, 0.08);
      element.audioPannerNode.pan.setTargetAtTime(0, now, 0.08);
      return;
    }

    const hostBox = getHostViewportBoundingBox();
    const hostCenterX = (hostBox.left + hostBox.right) / 2;
    const hostCenterY = (hostBox.top + hostBox.bottom) / 2;

    const elemCenterX = layout.x + (layout.width || 260) / 2;
    const elemCenterY = layout.y + (layout.height || 200) / 2;

    const dx = elemCenterX - hostCenterX;
    const dy = elemCenterY - hostCenterY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    const maxAudibleDistance = 1000;
    let volume = 1.0;
    if (distance > 200) {
      volume = Math.max(0, 1.0 - (distance - 200) / (maxAudibleDistance - 200));
    }

    const maxPanningOffset = 500;
    const pan = Math.max(-1.0, Math.min(1.0, dx / maxPanningOffset));

    const baseCutoff = 20000;
    const minCutoff = 200;
    let cutoff = baseCutoff;
    if (distance > 150) {
      const filterFactor = Math.max(0, 1.0 - (distance - 150) / (maxAudibleDistance - 150));
      cutoff = minCutoff + (baseCutoff - minCutoff) * Math.pow(filterFactor, 2);
    }

    element.audioVolumeNode.gain.setTargetAtTime(volume, now, 0.05);
    element.audioFilterNode.frequency.setTargetAtTime(cutoff, now, 0.05);
    element.audioPannerNode.pan.setTargetAtTime(pan, now, 0.05);
  });
}

let isFocusModeActive = false;

window.addEventListener('keydown', (e) => {
  if (e.defaultPrevented) return;

  if (isFocusModeKey(e)) {
    e.preventDefault();
    if (!isFocusModeActive) {
      activateFocusMode();
    }
  } else if (e.key === '.' && (e.ctrlKey || e.metaKey || e.altKey)) {
    e.preventDefault();
    window.__jamStrudelRuntimeDebug?.panic?.();
  } else if ((e.key === 'Backspace' || e.key === 'Delete') && e.ctrlKey && !isTextEntryOrTerminalFocused()) {
    e.preventDefault();
    deleteSelectedElement();
  }
});

window.addEventListener('keyup', (e) => {
  if (isFocusModeKey(e)) {
    if (isFocusModeActive) {
      deactivateFocusMode();
    }
  }
});

function isFocusModeKey(event) {
  return event.key === 'CapsLock' || event.code === 'CapsLock';
}

function activateFocusMode() {
  isFocusModeActive = true;
  focusOverlay.classList.remove('hidden');
  updateSpatialAudioAndLOD();
}

function deactivateFocusMode() {
  isFocusModeActive = false;
  focusOverlay.classList.add('hidden');
  
  updateSpatialAudioAndLOD();
}

function selectElement(id, domWrapper) {
  selectedElementId = id;
  document.querySelectorAll('.canvas-element-wrapper').forEach(w => w.classList.remove('active-focus'));
  domWrapper?.classList.add('active-focus');
}

function deleteSelectedElement() {
  if (!selectedElementId) return;
  deleteElementById(selectedElementId);
}

function deleteElementById(id) {
  if (!id || !ydoc || !elementsMap?.has(id)) return;
  if (selectedElementId === id) selectedElementId = null;
  document.querySelectorAll('.canvas-element-wrapper').forEach(w => w.classList.remove('active-focus'));
  ydoc.transact(() => {
    elementsMap.delete(id);
  });
}

function getHostViewportBoundingBox() {
  const viewportWidth = viewport.clientWidth || window.innerWidth;
  const viewportHeight = viewport.clientHeight || window.innerHeight;
  const left = -camera.x / camera.zoom;
  const top = -camera.y / camera.zoom;

  return {
    left,
    top,
    right: left + viewportWidth / camera.zoom,
    bottom: top + viewportHeight / camera.zoom
  };
}

function isElementInsideBox(layout, box) {
  const elemWidth = layout.width || 260;
  const elemHeight = layout.height || 200;
  return !(
    layout.x + elemWidth < box.left ||
    layout.x > box.right ||
    layout.y + elemHeight < box.top ||
    layout.y > box.bottom
  );
}

function applyElementLayoutToWrapper(domWrapper, layout) {
  const x = Number.isFinite(Number(layout?.x)) ? Number(layout.x) : 0;
  const y = Number.isFinite(Number(layout?.y)) ? Number(layout.y) : 0;
  const width = Number.isFinite(Number(layout?.width)) ? Math.max(1, Number(layout.width)) : 260;
  const height = Number.isFinite(Number(layout?.height)) ? Math.max(1, Number(layout.height)) : 200;

  domWrapper.style.left = `${x}px`;
  domWrapper.style.top = `${y}px`;
  domWrapper.style.width = `${width}px`;
  domWrapper.style.height = `${height}px`;
}

function requestElementLayout(id, patch) {
  if (!elementsMap?.has(id) || !patch || typeof patch !== 'object') return;

  const current = elementsMap.get(id);
  const next = { ...current };
  let changed = false;

  for (const key of ['width', 'height']) {
    if (!(key in patch)) continue;
    const value = Math.round(Number(patch[key]));
    if (!Number.isFinite(value) || value < 1 || value === current[key]) continue;
    next[key] = value;
    changed = true;
  }

  if (!changed) return;
  ydoc.transact(() => {
    elementsMap.set(id, next);
  });
  if (hasAutoCenteredInitialWorkspace && !hasUserMovedCamera) {
    requestAnimationFrame(() => {
      if (!hasUserMovedCamera) centerCameraOnWorkspace();
    });
  }
}

function runLevelOfDetailCheck() {
  const box = getHostViewportBoundingBox();
  
  // Keep a minimum world-space margin so zooming in does not aggressively hide nearby controls.
  const lodPaddingX = Math.max(600, (box.right - box.left) * 0.75);
  const lodPaddingY = Math.max(450, (box.bottom - box.top) * 0.75);
  const paddedBox = {
    left: box.left - lodPaddingX,
    right: box.right + lodPaddingX,
    top: box.top - lodPaddingY,
    bottom: box.bottom + lodPaddingY
  };

  activeElements.forEach((element) => {
    const layout = element.layout;
    if (!layout) return;

    const isVisible = isElementInsideBox(layout, paddedBox);
    if (isVisible) {
      element.domWrapper.style.visibility = 'visible';
      element.domWrapper.classList.remove('virtualized');
      element.isVirtualized = false;
    } else {
      element.domWrapper.style.visibility = 'hidden';
      element.domWrapper.classList.add('virtualized');
      element.isVirtualized = true;
    }
  });
}

let lastFrameTick = 0;

function animationLoop(timestamp) {
  activeElements.forEach((element) => {
    if (element.runtime && typeof element.runtime.update === 'function' && !element.isVirtualized) {
      try {
        element.runtime.update(lastFrameTick);
      } catch (err) {
        console.error(`Runtime update error:`, err);
      }
    }
  });

  updateSpatialAudioAndLOD();
  runLevelOfDetailCheck();

  lastFrameTick++;
  requestAnimationFrame(animationLoop);
}

function setupViewportNavigation() {
  let isDragging = false;
  let startX = 0;
  let startY = 0;

  viewport.addEventListener('mousedown', (e) => {
    if (e.target === viewport || e.target === gridLayer) {
      hideAddElementMenu();
      hasUserMovedCamera = true;
      isDragging = true;
      startX = e.clientX - camera.x;
      startY = e.clientY - camera.y;
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    camera.x = e.clientX - startX;
    camera.y = e.clientY - startY;
    applyViewportTransform();
  });

  window.addEventListener('mouseup', () => {
    isDragging = false;
  });

  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    hasUserMovedCamera = true;
    const zoomFactor = 1.05;
    const oldZoom = camera.zoom;
    
    if (e.deltaY < 0) {
      camera.zoom = Math.min(MAX_CAMERA_ZOOM, camera.zoom * zoomFactor);
    } else {
      camera.zoom = Math.max(MIN_CAMERA_ZOOM, camera.zoom / zoomFactor);
    }

    const rect = viewport.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    camera.x = mouseX - (mouseX - camera.x) * (camera.zoom / oldZoom);
    camera.y = mouseY - (mouseY - camera.y) * (camera.zoom / oldZoom);

    applyViewportTransform();
  });

  viewport.addEventListener('contextmenu', (e) => {
    if (e.target !== viewport && e.target !== gridLayer && e.target !== elementsLayer) return;
    e.preventDefault();
    e.stopPropagation();
    openAddElementMenu(e.clientX, e.clientY);
  });

  applyViewportTransform();
}

function applyViewportTransform() {
  gridLayer.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`;
  elementsLayer.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`;
  window.__jamCamera = {
    x: camera.x,
    y: camera.y,
    zoom: camera.zoom
  };
}

function getWorkspaceElementBounds() {
  if (!elementsMap?.size) return null;

  const bounds = {
    left: Infinity,
    top: Infinity,
    right: -Infinity,
    bottom: -Infinity
  };

  elementsMap.forEach((layout) => {
    const x = Number(layout?.x);
    const y = Number(layout?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    const width = Number.isFinite(Number(layout?.width)) ? Number(layout.width) : 260;
    const height = Number.isFinite(Number(layout?.height)) ? Number(layout.height) : 200;
    bounds.left = Math.min(bounds.left, x);
    bounds.top = Math.min(bounds.top, y);
    bounds.right = Math.max(bounds.right, x + Math.max(1, width));
    bounds.bottom = Math.max(bounds.bottom, y + Math.max(1, height));
  });

  if (!Number.isFinite(bounds.left) || !Number.isFinite(bounds.top) ||
      !Number.isFinite(bounds.right) || !Number.isFinite(bounds.bottom)) {
    return null;
  }

  return bounds;
}

function centerCameraOnWorkspace() {
  const bounds = getWorkspaceElementBounds();
  if (!bounds) {
    camera = { x: 0, y: 0, zoom: 1.0 };
    applyViewportTransform();
    return;
  }

  const viewportWidth = viewport.clientWidth || window.innerWidth;
  const viewportHeight = viewport.clientHeight || window.innerHeight;
  const boundsWidth = Math.max(1, bounds.right - bounds.left);
  const boundsHeight = Math.max(1, bounds.bottom - bounds.top);
  const padding = 96;
  const fitWidth = Math.max(1, viewportWidth - padding * 2);
  const fitHeight = Math.max(1, viewportHeight - padding * 2);
  const nextZoom = Math.max(MIN_CAMERA_ZOOM, Math.min(MAX_CAMERA_ZOOM, fitWidth / boundsWidth, fitHeight / boundsHeight));
  const centerX = (bounds.left + bounds.right) / 2;
  const centerY = (bounds.top + bounds.bottom) / 2;

  camera.zoom = nextZoom;
  camera.x = viewportWidth / 2 - centerX * nextZoom;
  camera.y = viewportHeight / 2 - centerY * nextZoom;
  applyViewportTransform();
}

window.__jamCenterCamera = () => {
  hasUserMovedCamera = true;
  centerCameraOnWorkspace();
};

function autoCenterInitialWorkspace() {
  if (hasAutoCenteredInitialWorkspace || hasUserMovedCamera || !elementsMap?.size) return;
  hasAutoCenteredInitialWorkspace = true;
  requestAnimationFrame(() => {
    if (!hasUserMovedCamera) centerCameraOnWorkspace();
  });
}

function setupElementDragging(domWrapper, id) {
  let isMoving = false;
  let startX = 0;
  let startY = 0;

  const beginMove = (e) => {
    isMoving = true;
    selectElement(id, domWrapper);

    const layout = elementsMap.get(id);
    startX = e.clientX / camera.zoom - layout.x;
    startY = e.clientY / camera.zoom - layout.y;
  };

  const moveToClientPoint = (e) => {
    if (!isMoving) return;
    const nx = Math.round(e.clientX / camera.zoom - startX);
    const ny = Math.round(e.clientY / camera.zoom - startY);

    if (elementsMap && elementsMap.has(id)) {
      const layout = elementsMap.get(id);
      ydoc.transact(() => {
        elementsMap.set(id, { ...layout, x: nx, y: ny });
      });
    }
  };

  const endMove = () => {
    isMoving = false;
  };

  const handleMouseDown = (e) => {
    const target = e.composedPath()[0];
    if (isInteractiveElementDragTarget(target)) {
      return;
    }
    e.stopPropagation();
    beginMove(e);
  };

  const handleBeginElementDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    beginMove(e.detail);
  };

  const handleContextMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (agentTerminalTerm) {
      agentTerminalTerm.focus();
      agentTerminalTerm.paste(`modify element ${id}: `);
    }
  };

  domWrapper.addEventListener('mousedown', handleMouseDown);
  domWrapper.addEventListener('jam-begin-element-drag', handleBeginElementDrag);
  window.addEventListener('mousemove', moveToClientPoint);
  window.addEventListener('pointermove', moveToClientPoint);
  window.addEventListener('mouseup', endMove);
  window.addEventListener('pointerup', endMove);
  window.addEventListener('pointercancel', endMove);
  window.addEventListener('blur', endMove);
  domWrapper.addEventListener('contextmenu', handleContextMenu);

  return () => {
    endMove();
    domWrapper.removeEventListener('mousedown', handleMouseDown);
    domWrapper.removeEventListener('jam-begin-element-drag', handleBeginElementDrag);
    window.removeEventListener('mousemove', moveToClientPoint);
    window.removeEventListener('pointermove', moveToClientPoint);
    window.removeEventListener('mouseup', endMove);
    window.removeEventListener('pointerup', endMove);
    window.removeEventListener('pointercancel', endMove);
    window.removeEventListener('blur', endMove);
    domWrapper.removeEventListener('contextmenu', handleContextMenu);
  };
}

function isInteractiveElementDragTarget(target) {
  if (!target || target.nodeType !== Node.ELEMENT_NODE) return false;
  const tag = target.tagName;
  return tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    tag === 'BUTTON' ||
    target.isContentEditable ||
    Boolean(target.closest?.('[contenteditable="true"], [data-no-drag], textarea, input, select, button'));
}

function syncElementsFromMap() {
  if (!elementsMap) return;

  const currentIds = new Set(elementsMap.keys());
  
  elementsMap.forEach((layout, id) => {
    const element = activeElements.get(id);
    if (!element) {
      if (compilingElements.has(id)) return;
      instantiateElement(id, layout);
    } else {
      const promptChanged = element.layout.prompt !== layout.prompt;
      const filePathChanged = element.layout.filePath !== layout.filePath;
      const reloadTokenChanged = element.layout.reloadToken !== layout.reloadToken;
      const authoredChanged = element.layout.authored !== layout.authored;

      if (promptChanged || filePathChanged || reloadTokenChanged || authoredChanged) {
        if (compilingElements.has(id)) return;
        const forceCompile = Boolean(promptChanged && layout.authored !== 'hand' && !reloadTokenChanged && !filePathChanged);
        console.log(`[Hot-Reload] Synchronized config change for ${id}. forceCompile=${forceCompile}`);
        instantiateElement(id, layout, { forceCompile });
      } else {
        element.layout = layout;
        element.domWrapper.className = 'canvas-element-wrapper';
        if (layout.type) element.domWrapper.classList.add(`element-type-${layout.type}`);
        if (selectedElementId === id) element.domWrapper.classList.add('active-focus');
        applyElementLayoutToWrapper(element.domWrapper, layout);
      }
    }
  });

  activeElements.forEach((element, id) => {
    if (!currentIds.has(id)) {
      if (element.runtime && typeof element.runtime.destroy === 'function') {
        try { element.runtime.destroy(); } catch (e) { console.error(e); }
      }
      element.disposeElementDragging?.();
      element.forceTearDown();
      element.domWrapper.remove();
      activeElements.delete(id);
      if (selectedElementId === id) selectedElementId = null;
      console.log(`[Lifecycle] Removed deleted element ${id}`);
    }
  });

  autoCenterInitialWorkspace();
}

function setupUIActions() {
  addElementMenu?.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-add-element]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    createElementOnCanvas(button.dataset.addElement, pendingAddMenuWorldPosition);
    hideAddElementMenu();
  });

  window.addEventListener('pointerdown', (event) => {
    if (addElementMenu?.classList.contains('hidden')) return;
    if (addElementMenu.contains(event.target)) return;
    hideAddElementMenu();
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hideAddElementMenu();
  });
}

function openAddElementMenu(clientX, clientY) {
  if (!addElementMenu) return;
  pendingAddMenuWorldPosition = screenToWorld(clientX, clientY);
  addElementMenu.classList.remove('hidden');

  const rect = viewport.getBoundingClientRect();
  const menuWidth = addElementMenu.offsetWidth || 112;
  const menuHeight = addElementMenu.offsetHeight || 132;
  const localX = clientX - rect.left;
  const localY = clientY - rect.top;
  const left = Math.min(Math.max(6, localX), Math.max(6, rect.width - menuWidth - 6));
  const top = Math.min(Math.max(6, localY), Math.max(6, rect.height - menuHeight - 6));

  addElementMenu.style.left = `${left}px`;
  addElementMenu.style.top = `${top}px`;
}

function hideAddElementMenu() {
  if (!addElementMenu) return;
  addElementMenu.classList.add('hidden');
  pendingAddMenuWorldPosition = null;
}

function screenToWorld(clientX, clientY) {
  const rect = viewport.getBoundingClientRect();
  return {
    x: Math.round((clientX - rect.left - camera.x) / camera.zoom),
    y: Math.round((clientY - rect.top - camera.y) / camera.zoom)
  };
}

function createElementOnCanvas(kind, position) {
  if (!ydoc || !elementsMap) return;
  const option = ELEMENT_ADD_OPTIONS[kind];
  if (!option || !position) return;

  const id = 'elem_' + Math.random().toString(36).substr(2, 9);

  const layout = {
    id,
    x: position.x,
    y: position.y,
    width: option.width,
    height: option.height,
    filePath: option.filePath,
    type: option.type,
    prompt: option.prompt,
    authored: 'hand',
    reloadToken: 0
  };

  ydoc.transact(() => {
    elementsMap.set(id, layout);
  });
}
