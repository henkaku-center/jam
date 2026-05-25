// jam — spatial creative client harness
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

// App State Variables
let isHost = true;
let isAudioInitialized = false;

// Web Audio API Global objects
let audioCtx = null;
let masterGain = null;

// Viewport / Navigation State (Camera coordinates)
let camera = { x: 0, y: 0, zoom: 1.0 };
const canvasBoundary = { width: 1920, height: 1080 };
const hostViewportDimensions = { width: 1024, height: 768 }; // Bounded frame

// Active Elements State
const activeElements = new Map(); // id -> Element Hashing/Harness object
const compilingElements = new Set(); // id -> track elements currently compiling/loading

// Global Sync State (Yjs)
let ydoc = null;
let provider = null;
let elementsMap = null; // Y.Map: id -> layout
let clockMap = null;    // Y.Map: { bpm, startTime }
let globalBusMap = null; // Y.Map: name -> value

// Local Signal Bus (In-memory, High Frequency)
const localBusListeners = new Map(); // key -> Set of callbacks

// Low-Latency Controller Channel Websocket connection
let controllerSocket = null;

// Visual NTP Sync parameters
let serverClockOffset = 0; // ms

// UI Elements References
const autoplayOverlay = document.getElementById('autoplay-overlay');
const appContainer = document.getElementById('app');
const viewport = document.getElementById('canvas-viewport');
const gridLayer = document.getElementById('canvas-grid');
const elementsLayer = document.getElementById('canvas-elements');
const hostCameraFrame = document.getElementById('host-camera-frame');
const modeBadge = document.getElementById('mode-badge');
const bpmInput = document.getElementById('bpm-input');
const metroLed = document.getElementById('metro-led');
const beatCounter = document.getElementById('beat-counter');
const statX = document.getElementById('stat-x');
const statY = document.getElementById('stat-y');
const statZoom = document.getElementById('stat-zoom');
const addElementBtn = document.getElementById('add-element-btn');
const resetCamBtn = document.getElementById('reset-cam-btn');
const focusOverlay = document.getElementById('focus-overlay');
const agentTerminal = document.getElementById('agent-terminal');
const agentTerminalViewport = document.getElementById('agent-terminal-viewport');
const agentTerminalFocusZone = document.getElementById('agent-terminal-focus-zone');
let agentTerminalTerm = null;

// Ensure correct room ID
const roomName = window.location.hash.slice(1) || 'default-jam';
window.location.hash = roomName;

// --- STEP 1: INITIALIZATION & AUDIO RESUME OVERLAYS ---

document.getElementById('join-host-btn').addEventListener('click', () => {
  isHost = true;
  initializeSystem();
});

document.getElementById('join-controller-btn').addEventListener('click', () => {
  isHost = false;
  initializeSystem();
});

function initializeSystem() {
  autoplayOverlay.classList.add('hidden');
  appContainer.classList.remove('hidden');
  
  // Set badges
  if (isHost) {
    modeBadge.textContent = 'HOST';
    modeBadge.className = 'badge host';
    hostCameraFrame.classList.add('hidden'); // Host doesn't need to see its own bounding box outline
  } else {
    modeBadge.textContent = 'CONTROLLER';
    modeBadge.className = 'badge controller';
    hostCameraFrame.classList.remove('hidden'); // Controller sees Host's frame
  }

  // Init AudioContext
  initAudio();
  
  // Init Yjs & WS
  initYjs();

  // Init controller websocket channel
  initControllerSocket();

  // Init agent terminal stream
  initAgentTerminalSocket();

  // Setup viewport events
  setupViewportNavigation();

  // Start Animation Loop
  requestAnimationFrame(animationLoop);

  // Setup UI elements actions
  setupUIActions();

  isAudioInitialized = true;
}

function initAudio() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  audioCtx = new AudioContextClass();
  
  // Create primary master gain node
  masterGain = audioCtx.createGain();
  masterGain.connect(audioCtx.destination);
  
  if (!isHost) {
    // Mute Thin-Controller to avoid physical speaker feedback/phasing!
    masterGain.gain.setValueAtTime(0, audioCtx.currentTime);
    console.log('[Audio] Thin-Controller loaded in SILENT mode. Master gain = 0.');
  } else {
    masterGain.gain.setValueAtTime(1, audioCtx.currentTime);
    console.log('[Audio] Host-Renderer loaded in AUDIBLE mode. Master gain = 1.');
  }
}

// --- STEP 2: YJS SYNCHRONIZATION ---

function initYjs() {
  ydoc = new Y.Doc();
  
  // Setup WebSocket connection to the local server
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const serverUrl = `${protocol}//${window.location.host}/yjs`;
  
  provider = new WebsocketProvider(serverUrl, 'jam-workspace', ydoc);
  
  elementsMap = ydoc.getMap('elements');
  clockMap = ydoc.getMap('clock');
  globalBusMap = ydoc.getMap('global_bus');

  // Expose to window for remote diagnostics/debugging
  window.ydoc = ydoc;
  window.elementsMap = elementsMap;
  window.activeElements = activeElements;

  provider.on('status', event => {
    console.log(`[Yjs Status] Connected: ${event.status}`);
  });

  // Observe updates to the elements layout map
  elementsMap.observe(event => {
    syncElementsFromMap();
  });

  // Observe clock adjustments (BPM / Sync offsets)
  clockMap.observe(event => {
    const bpm = clockMap.get('bpm') || 120;
    bpmInput.value = bpm;
  });

  // Observe global synchronized bus events
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

  // Initialize clock if we are Host and Yjs doesn't have it
  provider.on('synced', () => {
    if (isHost && !clockMap.has('bpm')) {
      ydoc.transact(() => {
        clockMap.set('bpm', 120);
        clockMap.set('startTime', Date.now());
      });
    }
    syncElementsFromMap();
    performVisualNTPHandshake();
  });
}

// --- STEP 3: VISUAL NTP-STYLE HANDSHAKE & TEMPO PIVOTS ---

async function performVisualNTPHandshake() {
  // Estimated clock drift correction by handshaking with server
  const t1 = Date.now();
  try {
    const res = await fetch('/api/compile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'PING', elementId: 'PING', filePath: '/elements/PING' })
    });
    const t3 = Date.now();
    const rtt = t3 - t1;
    // Server processed timestamp is roughly middle of RTT
    serverClockOffset = (t3 - rtt / 2) - t1; 
    console.log(`[Clock Sync] Handshake complete. RTT: ${rtt}ms. Estimated Server Offset: ${serverClockOffset}ms`);
  } catch (err) {
    console.warn('[Clock Sync] Handshake failed, fallback to local clock:', err);
    serverClockOffset = 0;
  }
}

// Get synchronized server time in milliseconds
function getSyncTime() {
  return Date.now() + serverClockOffset;
}

// Continuous tempo pivot adjustment on changes to BPM
function changeBPM(newBPM) {
  if (!ydoc) return;
  
  const currentBPM = clockMap.get('bpm') || 120;
  if (currentBPM === newBPM) return;
  
  const oldStartTime = clockMap.get('startTime') || Date.now();
  const syncNow = getSyncTime();
  
  // Calculate exact elapsed beats at current moment using old BPM
  const elapsedBeats = (syncNow - oldStartTime) * (currentBPM / 60000);
  
  // Derive new startTime so elapsed beats calculation is continuous
  const newStartTime = syncNow - (elapsedBeats * 60000 / newBPM);
  
  ydoc.transact(() => {
    clockMap.set('bpm', newBPM);
    clockMap.set('startTime', newStartTime);
  });
  console.log(`[Clock] Tempo pivoted to ${newBPM} BPM. Seamless transition.`);
}

// --- STEP 4: LOOK-AHEAD TIMER SCHEDULER ("A Tale of Two Clocks") ---

const LOOK_AHEAD_TIME = 0.100; // 100ms
const SCHEDULER_INTERVAL = 25; // ms
let lastScheduledStep = -1;
let nextStepTime = 0.0;
const clockCallbacks = new Set(); // Set of { id, onTickCb }

function startScheduler() {
  setInterval(() => {
    if (!audioCtx || !ydoc) return;
    
    const bpm = clockMap.get('bpm') || 120;
    const startTime = clockMap.get('startTime') || Date.now();
    
    // Schedule ahead relative to AudioContext timeline
    const currentTime = audioCtx.currentTime;
    
    // Translate the hardware time window to logical beats
    const syncNow = getSyncTime();
    
    // We want to calculate where the playhead is in beats
    const elapsedBeats = (syncNow - startTime) * (bpm / 60000);
    
    // A 16th note step is 0.25 beats
    const stepDuration = 60.0 / bpm / 4.0; // Seconds per 16th note
    
    // Find what the next logical step index is
    const currentStep = Math.floor(elapsedBeats * 4.0);
    
    // Check next lookahead range
    const scheduleWindowEnd = currentTime + LOOK_AHEAD_TIME;
    
    // Calculate actual timeline times for upcoming 16th note beats
    for (let s = currentStep; s < currentStep + 8; s++) {
      if (s <= lastScheduledStep) continue;
      
      // Compute when this step 's' should play in server epoch time
      const stepBeatOffset = s * 0.25;
      const stepEpochTime = startTime + (stepBeatOffset * 60000 / bpm);
      
      // Convert server epoch time to local client epoch time, and map to local AudioContext time
      const stepLocalEpochTime = stepEpochTime - serverClockOffset;
      const timeRemainingMs = stepLocalEpochTime - Date.now();
      const targetAudioTime = currentTime + (timeRemainingMs / 1000);
      
      if (targetAudioTime >= currentTime && targetAudioTime < scheduleWindowEnd) {
        // Trigger beat callbacks!
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
        
        // Trigger LED visual pulse on downbeat (quarter notes)
        if (s % 4 === 0) {
          triggerVisualMetronome();
        }
      }
    }
  }, SCHEDULER_INTERVAL);
}

function triggerVisualMetronome() {
  metroLed.classList.add('flash');
  setTimeout(() => metroLed.classList.remove('flash'), 50);
  
  const bpm = clockMap.get('bpm') || 120;
  const startTime = clockMap.get('startTime') || Date.now();
  const syncNow = getSyncTime();
  const elapsedBeats = (syncNow - startTime) * (bpm / 60000);
  const bar = Math.floor(elapsedBeats / 4) + 1;
  const beat = Math.floor(elapsedBeats % 4) + 1;
  beatCounter.textContent = `${bar}.${beat}`;
}

// Start lookahead scheduler background loop
startScheduler();

// --- STEP 5: TWO-TIER SIGNAL BUS ---

const signalBus = {
  // Local (High Frequency / In-Memory)
  pub(key, val, senderId) {
    // Skip automatic prepending if key already contains an explicit colon namespace
    const namespacedKey = (senderId && !key.includes(':')) ? `${senderId}:${key}` : key;
    const listeners = localBusListeners.get(namespacedKey);
    if (listeners) {
      listeners.forEach(cb => cb(val));
    }
  },
  
  sub(key, callback, receiverId) {
    // Skip automatic prepending if key already contains an explicit colon namespace
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

  // Global (Low Frequency / State Synced Yjs)
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
    
    // Execute immediately if we have cached value in Yjs
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

const globalBusListeners = new Map(); // key -> Set

// --- STEP 6: LOW-LATENCY WEBSOCKET CONTROLLER CHANNEL ---

function initControllerSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${window.location.host}/controller?host=${isHost}`;
  
  controllerSocket = new WebSocket(url);
  
  controllerSocket.onopen = () => {
    console.log(`[Controller Socket] Connected to low-latency channel as ${isHost ? 'Host' : 'Controller'}`);
  };

  controllerSocket.onmessage = (event) => {
    if (isHost) {
      // Host receives controller events (e.g. MIDI or Slider moves) and handles them
      try {
        const msg = JSON.parse(event.data);
        handleControllerMessageOnHost(msg);
      } catch (err) {
        console.error('[Controller Socket] Failed parsing message:', err);
      }
    }
  };
}

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
      return;
    }

    const targetWidth = 360;
    const targetHeight = 48;
    const cursorCenterX = cursorRect.left - terminalRect.left + cursorRect.width / 2;
    const cursorCenterY = cursorRect.top - terminalRect.top + cursorRect.height / 2;
    const left = Math.max(0, Math.min(terminalRect.width - targetWidth, cursorCenterX - targetWidth / 2));
    const top = Math.max(0, Math.min(terminalRect.height - targetHeight, cursorCenterY - targetHeight / 2));

    agentTerminalFocusZone.style.display = 'block';
    agentTerminalFocusZone.style.left = `${left}px`;
    agentTerminalFocusZone.style.top = `${top}px`;
    agentTerminalFocusZone.style.width = `${targetWidth}px`;
    agentTerminalFocusZone.style.height = `${targetHeight}px`;
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

// Send light-weight raw control messages from Thin-Controller to Host
function sendControllerMessage(msg) {
  if (controllerSocket && controllerSocket.readyState === WebSocket.OPEN && !isHost) {
    controllerSocket.send(JSON.stringify(msg));
  }
}

function handleControllerMessageOnHost(msg) {
  // Routes to specific target elements on the Host
  const targetId = msg.elementId;
  const element = activeElements.get(targetId);
  if (element && element.runtime && typeof element.runtime.handleControllerInput === 'function') {
    // Custom trigger hook inside generated element code
    element.runtime.handleControllerInput(msg.data);
  }
}

// --- STEP 7: ELEMENT LIFECYCLE & SANDBOX HARNESS ---

// Secure Wrapper factory for DOM, EventListeners, and Audio tracking
function createElementHarnessContext(elementId, audioOutNode) {
  const trackedListeners = [];
  const trackedIntervals = [];
  const trackedTimeouts = [];
  const trackedAudioNodes = [];
  const elementClockCallbacks = [];

  // 1. Shadow DOM Root containment
  const domWrapper = document.createElement('div');
  domWrapper.className = 'element-shadow-container';
  const shadowRoot = domWrapper.attachShadow({ mode: 'open' });

  // 2. Event Listener Tracker Proxy
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

  // 3. Audio Context Tracker Proxy
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

  // 4. Clock proxy
  const clockProxy = {
    bpm: clockMap.get('bpm') || 120,
    startTime: clockMap.get('startTime') || Date.now(),
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

  // 5. Signal Bus Namespaced Proxy
  const busProxy = {
    pub: (key, val) => signalBus.pub(key, val, elementId),
    sub: (key, cb) => signalBus.sub(key, cb, elementId),
    pubGlobal: (key, val) => signalBus.pubGlobal(key, val, elementId),
    subGlobal: (key, cb) => signalBus.subGlobal(key, cb, elementId)
  };

  // Build the complete context object
  const ctx = {
    audioCtx: audioCtxProxy,
    audioOut: audioOutNode,
    domRoot: domRootProxy,
    clock: clockProxy,
    bus: busProxy,
    // Add custom helper for controllers to emit raw controller sockets
    sendControllerData: (data) => sendControllerMessage({ elementId, data })
  };

  // Cleanup executor
  const forceTearDown = () => {
    // Unsubscribe clock ticks
    elementClockCallbacks.forEach(cb => clockCallbacks.delete(cb));
    
    // Clear intervals and timeouts
    trackedIntervals.forEach(clearInterval);
    trackedTimeouts.forEach(clearTimeout);

    // Remove EventListeners
    trackedListeners.forEach(({ target, type, listener, options }) => {
      try { target.removeEventListener(type, listener, options); } catch(e) {}
    });

    // Disconnect Web Audio nodes
    trackedAudioNodes.forEach(node => {
      try { node.disconnect(); } catch(e) {}
      try { if (typeof node.stop === 'function') node.stop(); } catch(e) {}
    });
  };

  return { ctx, domWrapper, shadowRoot, forceTearDown };
}

// Instantiate or reload an element onto the canvas
async function instantiateElement(id, layout, options = {}) {
  compilingElements.add(id);
  try {
    // If element exists, let's load it and preserve its state
    let prevState = null;
    const existingWrapper = activeElements.get(id);

  if (existingWrapper) {
    if (existingWrapper.runtime && typeof existingWrapper.runtime.getState === 'function') {
      try { prevState = existingWrapper.runtime.getState(); } catch (e) { console.error(e); }
    }
  }

  // Create spatial audio nodes for Host client, or dummy nodes for Controller client
  let elementAudioOut = null;
  let elementPanner = null;
  let elementFilter = null;
  let elementVolume = null;

  if (isHost) {
    // 3D Spatial Audio Sub-graph: Element Output -> Volume Gain -> Biquad Filter -> Stereo Panner -> Master Gain
    elementVolume = audioCtx.createGain();
    elementFilter = audioCtx.createBiquadFilter();
    elementFilter.type = 'lowpass';
    elementPanner = audioCtx.createStereoPanner();

    elementVolume.connect(elementFilter);
    elementFilter.connect(elementPanner);
    elementPanner.connect(masterGain);

    elementAudioOut = elementVolume;
  } else {
    // Controller still creates real nodes for visualizers but connects to dummy mute gain
    const dummyGain = audioCtx.createGain();
    dummyGain.gain.setValueAtTime(0, audioCtx.currentTime);
    dummyGain.connect(masterGain);
    elementAudioOut = dummyGain;
  }

  // Create harness context
  const harness = createElementHarnessContext(id, elementAudioOut);

  // Fetch compiled/transpiled IIFE code from server
  let transpiledCode = '';
  try {
    const res = await fetch(`/api/compile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: layout.prompt || `Initialize or reload module`,
        elementId: id,
        filePath: layout.filePath,
        prevState: prevState,
        forceCompile: Boolean(options.forceCompile)
      })
    });
    const data = await res.json();
    transpiledCode = data.transpiledCode;
  } catch (err) {
    console.error(`[Lifecycle] Failed fetching transpiled code for ${id}:`, err);
    return;
  }

  // Evaluate transpiled IIFE safely with new Function()
  let setupFn = null;
  try {
    setupFn = new Function(transpiledCode)();
  } catch (err) {
    // Display error overlay on the canvas element wrapper
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

  // Create HTML Wrapper and append to DOM
  const domWrapper = document.createElement('div');
  domWrapper.id = `wrapper-${id}`;
  domWrapper.className = 'canvas-element-wrapper';
  domWrapper.style.left = `${layout.x}px`;
  domWrapper.style.top = `${layout.y}px`;
  domWrapper.appendChild(harness.domWrapper);

  // Drag and right-click functionality
  setupElementDragging(domWrapper, id);

  // If there was an old element, perform logical bar-aligned hot-reload crossfade!
  if (existingWrapper) {
    const bpm = clockMap.get('bpm') || 120;
    const startTime = clockMap.get('startTime') || Date.now();
    const syncNow = getSyncTime();
    const elapsedBeats = (syncNow - startTime) * (bpm / 60000);
    const currentBar = Math.floor(elapsedBeats / 4);

    // Calculate next bar downbeat epoch time
    const nextBarBeats = (currentBar + 1) * 4;
    const nextBarEpoch = startTime + (nextBarBeats * 60000 / bpm);
    const targetAudioTime = audioCtx.currentTime + ((nextBarEpoch - syncNow) / 1000);

    // Bumping to bar+2 if latency left us with <200ms setup window
    const safetyBuffer = 0.200; // 200ms
    let crossfadeTime = targetAudioTime;
    if (crossfadeTime - audioCtx.currentTime < safetyBuffer) {
      const extendedBarBeats = (currentBar + 2) * 4;
      const extendedEpoch = startTime + (extendedBarBeats * 60000 / bpm);
      crossfadeTime = audioCtx.currentTime + ((extendedEpoch - syncNow) / 1000);
    }

    console.log(`[Hot-Reload] Queuing downbeat crossfade at AudioContext time ${crossfadeTime.toFixed(3)}s`);

    if (isHost && elementVolume) {
      // Crossfade Web Audio gains on the exact beat downbeat
      elementVolume.gain.setValueAtTime(0, audioCtx.currentTime);
      elementVolume.gain.setValueAtTime(0, crossfadeTime - 0.05);
      elementVolume.gain.linearRampToValueAtTime(1, crossfadeTime + 0.05);

      if (existingWrapper.audioVolumeNode) {
        existingWrapper.audioVolumeNode.gain.setValueAtTime(1, crossfadeTime - 0.05);
        existingWrapper.audioVolumeNode.gain.linearRampToValueAtTime(0, crossfadeTime + 0.05);
      }
    }

    // Schedule old element destruction slightly after downbeat crossfade is done
    setTimeout(() => {
      // Run teardown
      if (existingWrapper.runtime && typeof existingWrapper.runtime.destroy === 'function') {
        try { existingWrapper.runtime.destroy(); } catch (e) { console.error(e); }
      }
      existingWrapper.forceTearDown();
      existingWrapper.domWrapper.remove();
      console.log(`[Hot-Reload] Disposed old element ${id}`);
    }, (crossfadeTime - audioCtx.currentTime + 0.2) * 1000);

  } else {
    // Fresh instantiation
    if (isHost && elementVolume) {
      elementVolume.gain.setValueAtTime(1, audioCtx.currentTime);
    }
  }

  // Remove old DOM node from canvas and place new one
  const oldElementNode = document.getElementById(`wrapper-${id}`);
  if (oldElementNode) oldElementNode.remove();
  elementsLayer.appendChild(domWrapper);

  // Register in active Map
  activeElements.set(id, {
    id,
    domWrapper,
    harnessDom: harness.domWrapper,
    runtime,
    forceTearDown: harness.forceTearDown,
    // Spatial nodes references
    audioVolumeNode: elementVolume,
    audioFilterNode: elementFilter,
    audioPannerNode: elementPanner,
    layout: layout
  });

  } finally {
    compilingElements.delete(id);
  }
}

function renderErrorUI(shadowRoot, err) {
  shadowRoot.innerHTML = `
    <style>
      .error-card {
        background: #1e1014;
        border: 2px solid var(--accent-danger, #f43f5e);
        border-radius: 8px;
        padding: 12px;
        color: #ff859b;
        font-family: monospace;
        font-size: 11px;
        width: 220px;
        white-space: pre-wrap;
        box-shadow: 0 4px 15px rgba(244, 63, 94, 0.3);
      }
      .error-title { font-weight: bold; margin-bottom: 6px; color: #f43f5e; }
    </style>
    <div class="error-card">
      <div class="error-title">⚠️ Runtime Error</div>
      <div>${err.message}</div>
    </div>
  `;
}

// --- STEP 8: SPATIAL AUDIO CALCULATION MIXER ---

// Run every animation frame to update spatial positioning and level of detail virtualization
function updateSpatialAudioAndLOD() {
  if (!audioCtx || !isHost) return;

  const currentBPM = clockMap ? clockMap.get('bpm') || 120 : 120;

  activeElements.forEach((element, id) => {
    const layout = element.layout;
    if (!layout) return;

    // Spatial calculations are done relative to the Host camera.
    // The visual bounds of the camera frame acts as the master listening box.
    // Let's assume the center of the Host view represents our listener position.
    const hostCenterX = -camera.x / camera.zoom + (window.innerWidth / 2) / camera.zoom;
    const hostCenterY = -camera.y / camera.zoom + (window.innerHeight / 2) / camera.zoom;

    // Compute element absolute visual center
    const elemCenterX = layout.x + 120; // estimate 240px width
    const elemCenterY = layout.y + 100; // estimate 200px height

    // Offset coordinates
    const dx = elemCenterX - hostCenterX;
    const dy = elemCenterY - hostCenterY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // --- Spatial Mixing Calculations ---
    
    // 1. Attenuation: Smooth volume roll-off
    const maxAudibleDistance = 1000; // Pixels
    let volume = 1.0;
    if (distance > 200) {
      volume = Math.max(0, 1.0 - (distance - 200) / (maxAudibleDistance - 200));
    }

    // 2. Stereo Panning: Map relative X offset to panning [-1.0, 1.0]
    const maxPanningOffset = 500; // Pixels from center for full hard pan
    const pan = Math.max(-1.0, Math.min(1.0, dx / maxPanningOffset));

    // 3. Lowpass Filter: Frequency decays with distance
    const baseCutoff = 20000; // Open filter when close
    const minCutoff = 200;    // Deeply lowpassed when far
    let cutoff = baseCutoff;
    if (distance > 150) {
      const filterFactor = Math.max(0, 1.0 - (distance - 150) / (maxAudibleDistance - 150));
      cutoff = minCutoff + (baseCutoff - minCutoff) * Math.pow(filterFactor, 2);
    }

    // --- Apply to spatial audio nodes ---
    if (element.audioVolumeNode && element.audioFilterNode && element.audioPannerNode) {
      const now = audioCtx.currentTime;
      element.audioVolumeNode.gain.setTargetAtTime(volume, now, 0.05);
      element.audioFilterNode.frequency.setTargetAtTime(cutoff, now, 0.05);
      element.audioPannerNode.pan.setTargetAtTime(pan, now, 0.05);
    }
  });
}

// --- STEP 9: FOCUS MODE & VISUAL LOD VIRTUALIZATION ---

let isFocusModeActive = false;

window.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    if (!isFocusModeActive) {
      activateFocusMode();
    }
  }
});

window.addEventListener('keyup', (e) => {
  if (e.key === 'Tab') {
    if (isFocusModeActive) {
      deactivateFocusMode();
    }
  }
});

function activateFocusMode() {
  isFocusModeActive = true;
  focusOverlay.classList.remove('hidden');

  // Visually dim non-host elements and mute off-viewport audio
  if (isHost && audioCtx) {
    const hostBox = getHostViewportBoundingBox();
    activeElements.forEach((element) => {
      const layout = element.layout;
      const isInside = isElementInsideBox(layout, hostBox);
      
      if (!isInside && element.audioVolumeNode) {
        // Instantly and smoothly mute off-viewport elements
        element.audioVolumeNode.gain.setTargetAtTime(0, audioCtx.currentTime, 0.1);
      }
    });
  }
}

function deactivateFocusMode() {
  isFocusModeActive = false;
  focusOverlay.classList.add('hidden');
  
  // Restore original volume mixing
  updateSpatialAudioAndLOD();
}

function getHostViewportBoundingBox() {
  // Let's compute the visible visual coordinate boundaries
  return {
    left: camera.x,
    top: camera.y,
    right: camera.x + window.innerWidth / camera.zoom,
    bottom: camera.y + window.innerHeight / camera.zoom
  };
}

function isElementInsideBox(layout, box) {
  const elemWidth = 300; // estimated maximum bounding box
  const elemHeight = 300;
  return !(
    layout.x + elemWidth < box.left ||
    layout.x > box.right ||
    layout.y + elemHeight < box.top ||
    layout.y > box.bottom
  );
}

// Run LOD check to hide off-screen wrappers and bypass rendering updates
function runLevelOfDetailCheck() {
  const box = getHostViewportBoundingBox();
  
  // Add a 1.5x padding margin to LOD boundary to prevent visual popping on borders
  const lodPaddingX = (box.right - box.left) * 0.25;
  const lodPaddingY = (box.bottom - box.top) * 0.25;
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

// --- STEP 10: ANIMATION LOOP (update() triggers) ---

let lastFrameTick = 0;

function animationLoop(timestamp) {
  // Trigger update functions on all un-virtualized elements
  activeElements.forEach((element) => {
    if (element.runtime && typeof element.runtime.update === 'function' && !element.isVirtualized) {
      try {
        element.runtime.update(lastFrameTick);
      } catch (err) {
        console.error(`Runtime update error:`, err);
      }
    }
  });

  // Calculate and apply spatial audio matrices
  updateSpatialAudioAndLOD();

  // Run LOD visibility optimizations
  runLevelOfDetailCheck();

  lastFrameTick++;
  requestAnimationFrame(animationLoop);
}

// --- STEP 11: VIEWPORT NAVIGATION (drag, zoom, keys) ---

function setupViewportNavigation() {
  let isDragging = false;
  let startX = 0;
  let startY = 0;

  viewport.addEventListener('mousedown', (e) => {
    // Only drag on canvas background click, not on element clicks
    if (e.target === viewport || e.target === gridLayer) {
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
    const zoomFactor = 1.05;
    const oldZoom = camera.zoom;
    
    if (e.deltaY < 0) {
      camera.zoom = Math.min(2.5, camera.zoom * zoomFactor);
    } else {
      camera.zoom = Math.max(0.4, camera.zoom / zoomFactor);
    }

    // Center zoom on mouse coordinate
    const rect = viewport.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    camera.x = mouseX - (mouseX - camera.x) * (camera.zoom / oldZoom);
    camera.y = mouseY - (mouseY - camera.y) * (camera.zoom / oldZoom);

    applyViewportTransform();
  });

  // Keyboard navigation arrow/WASD
  window.addEventListener('keydown', (e) => {
    // If typing into any text control, bypass keyboard pan.
    if (document.activeElement?.matches?.('input, textarea, select, [contenteditable="true"], .xterm-helper-textarea')) return;

    const panSpeed = 20 / camera.zoom;
    if (e.key === 'w' || e.key === 'ArrowUp') {
      camera.y += panSpeed;
    } else if (e.key === 's' || e.key === 'ArrowDown') {
      camera.y -= panSpeed;
    } else if (e.key === 'a' || e.key === 'ArrowLeft') {
      camera.x += panSpeed;
    } else if (e.key === 'd' || e.key === 'ArrowRight') {
      camera.x -= panSpeed;
    } else {
      return;
    }
    applyViewportTransform();
  });

  // Init position
  applyViewportTransform();
}

function applyViewportTransform() {
  gridLayer.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`;
  elementsLayer.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`;
  
  // Position host visual viewport bounding box frame for Controller clients
  if (!isHost) {
    // For simplicity, let's render Host frame centered at origin for reference
    hostCameraFrame.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`;
    hostCameraFrame.style.width = `${hostViewportDimensions.width}px`;
    hostCameraFrame.style.height = `${hostViewportDimensions.height}px`;
  }

  // Update status UI
  statX.textContent = Math.round(camera.x);
  statY.textContent = Math.round(camera.y);
  statZoom.textContent = camera.zoom.toFixed(2);
}

// --- STEP 12: CANVAS ELEMENT DRAGGING & COORDINATES MAPPING ---

function setupElementDragging(domWrapper, id) {
  let isMoving = false;
  let startX = 0;
  let startY = 0;

  domWrapper.addEventListener('mousedown', (e) => {
    // Bypass if clicking inside inputs/sliders on Shadow Root
    if (e.composedPath()[0].tagName === 'INPUT' || e.composedPath()[0].tagName === 'SELECT' || e.composedPath()[0].tagName === 'BUTTON') {
      return;
    }
    e.stopPropagation();
    isMoving = true;
    
    // Select wrapper
    document.querySelectorAll('.canvas-element-wrapper').forEach(w => w.classList.remove('active-focus'));
    domWrapper.classList.add('active-focus');

    const layout = elementsMap.get(id);
    startX = e.clientX / camera.zoom - layout.x;
    startY = e.clientY / camera.zoom - layout.y;
  });

  window.addEventListener('mousemove', (e) => {
    if (!isMoving) return;
    const nx = Math.round(e.clientX / camera.zoom - startX);
    const ny = Math.round(e.clientY / camera.zoom - startY);

    // Save back to synchronized Yjs elements map
    if (elementsMap && elementsMap.has(id)) {
      const layout = elementsMap.get(id);
      ydoc.transact(() => {
        elementsMap.set(id, { ...layout, x: nx, y: ny });
      });
    }
  });

  window.addEventListener('mouseup', () => {
    isMoving = false;
  });

  // Right-click prepares a terminal command targeting this element.
  domWrapper.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (agentTerminalTerm) {
      agentTerminalTerm.focus();
      agentTerminalTerm.paste(`modify element ${id}: `);
    }
  });
}

// Update local active elements lists when synced Yjs map updates
function syncElementsFromMap() {
  if (!elementsMap) return;

  const currentIds = new Set(elementsMap.keys());
  
  // Instantiate new elements or update position of existing ones
  elementsMap.forEach((layout, id) => {
    const element = activeElements.get(id);
    if (!element) {
      // New element found! Prevent parallel compilation race conditions
      if (compilingElements.has(id)) return;
      instantiateElement(id, layout);
    } else {
      // Trigger hot-reload across all synchronized clients if prompt or filePath changes!
      if (element.layout.prompt !== layout.prompt || element.layout.filePath !== layout.filePath) {
        if (compilingElements.has(id)) return;
        console.log(`[Hot-Reload] Synchronized config change for ${id}. Compiling...`);
        instantiateElement(id, layout, { forceCompile: true });
      } else {
        // Update local position coords
        element.layout = layout;
        element.domWrapper.style.left = `${layout.x}px`;
        element.domWrapper.style.top = `${layout.y}px`;
      }
    }
  });

  // Tear down deleted elements
  activeElements.forEach((element, id) => {
    if (!currentIds.has(id)) {
      if (element.runtime && typeof element.runtime.destroy === 'function') {
        try { element.runtime.destroy(); } catch (e) { console.error(e); }
      }
      element.forceTearDown();
      element.domWrapper.remove();
      activeElements.delete(id);
      console.log(`[Lifecycle] Removed deleted element ${id}`);
    }
  });

}

// --- STEP 13: UI ACTIONS PANEL SETUP ---

function setupUIActions() {
  bpmInput.addEventListener('change', (e) => {
    const val = parseInt(e.target.value);
    if (val >= 40 && val <= 240) {
      changeBPM(val);
    }
  });

  resetCamBtn.addEventListener('click', () => {
    camera.x = 0;
    camera.y = 0;
    camera.zoom = 1.0;
    applyViewportTransform();
  });

  addElementBtn.addEventListener('click', () => {
    createNewElementOnCanvas();
  });

}

function createNewElementOnCanvas(initialPrompt = '') {
  if (!ydoc || !elementsMap) return;

  const id = 'elem_' + Math.random().toString(36).substr(2, 9);
  
  // Position the element relative to the viewport coordinate frame center
  const centerX = Math.round(-camera.x / camera.zoom + (window.innerWidth / 2) / camera.zoom - 120);
  const centerY = Math.round(-camera.y / camera.zoom + (window.innerHeight / 2) / camera.zoom - 100);

  const fileExt = initialPrompt.toLowerCase().includes('lfo') ? 'lfo' : 
                  (initialPrompt.toLowerCase().includes('sequencer') || initialPrompt.toLowerCase().includes('drum') ? 'seq' : 'synth');

  const layout = {
    id,
    x: centerX,
    y: centerY,
    width: 260,
    height: 200,
    filePath: `/elements/${id}_${fileExt}.js`,
    type: fileExt,
    prompt: initialPrompt
  };

  ydoc.transact(() => {
    elementsMap.set(id, layout);
  });
}
