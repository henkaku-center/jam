import './styles.css';
import * as Y from 'yjs';
import { connect, roomFromHash } from './sync';
import { SignalBus } from './bus';
import { Stage } from './stage';
import { PaneKind, PaneState } from './panes/base';
import { mountCodePane } from './panes/code';
import { mountWidgetPane } from './panes/widget';
import { mountPromptPane } from './panes/prompt';
import { mountSamplerPane } from './panes/sampler';

const room = roomFromHash();
document.getElementById('room-name')!.textContent = room;

const sync = connect(room);
const bus = new SignalBus(sync.doc);
const stage = new Stage(
  document.getElementById('stage') as HTMLCanvasElement,
  bus,
);

// Default visual so the stage isn't blank on first load.
const defaultVisual = `osc(10, 0.1, 0.8).rotate(0.1).out()`;
stage.evalVisual(defaultVisual);

// --- panes shared state ---
const panesY = sync.doc.getMap<Y.Map<any>>('panes');
const panesParent = document.getElementById('panes')!;
const mounted = new Map<string, () => void>();

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function defaultCodeFor(kind: 'audio' | 'visual'): string {
  if (kind === 'audio') {
    return `// Strudel — ⌘+Enter to play\ns("bd*4, [~ sd]*2, hh*8").gain(0.6)`;
  }
  return `// Hydra — ⌘+Enter to run\n// b('signal') reads a bus value\nosc(10, 0.1, () => 0.5 + b('knob')*0.5)\n  .rotate(() => b('knob') * 3.14)\n  .out()`;
}

function createPane(kind: PaneKind, opts: Partial<PaneState> = {}): void {
  const id = uid();
  const data = new Y.Map<any>();
  if (kind === 'code') {
    const target = opts.x === undefined ? 'visual' : 'visual';
    data.set('target', target);
    const text = new Y.Text();
    text.insert(0, defaultCodeFor(target));
    data.set('code', text);
  }
  data.set('id', id);
  data.set('kind', kind);
  data.set('x', opts.x ?? 80 + Math.random() * 200);
  data.set('y', opts.y ?? 100 + Math.random() * 200);
  data.set('w', opts.w ?? (kind === 'widget' ? 320 : kind === 'sampler' ? 440 : 420));
  data.set('h', opts.h ?? (kind === 'widget' ? 240 : kind === 'sampler' ? 320 : 360));
  panesY.set(id, data);
}

function buildState(id: string, data: Y.Map<any>): PaneState {
  return {
    id,
    kind: data.get('kind'),
    x: data.get('x') ?? 100,
    y: data.get('y') ?? 100,
    w: data.get('w') ?? 400,
    h: data.get('h') ?? 320,
    data,
  };
}

function mountPane(id: string, data: Y.Map<any>): void {
  if (mounted.has(id)) return;
  if (data.get('_deleted')) return;
  const state = buildState(id, data);
  let cleanup: () => void = () => {};
  if (state.kind === 'code') {
    cleanup = mountCodePane(state, panesParent, stage, sync.awareness);
  } else if (state.kind === 'widget') {
    cleanup = mountWidgetPane(state, panesParent, bus);
  } else if (state.kind === 'prompt') {
    cleanup = mountPromptPane(state, panesParent, stage, bus);
  } else if (state.kind === 'sampler') {
    cleanup = mountSamplerPane(state, panesParent, bus);
  }
  mounted.set(id, cleanup);

  data.observe(() => {
    if (data.get('_deleted')) {
      const c = mounted.get(id);
      c?.();
      mounted.delete(id);
      const el = panesParent.querySelector(`[data-pane-id="${id}"]`);
      el?.remove();
    }
  });
}

panesY.observe((event) => {
  event.changes.keys.forEach((change, key) => {
    if (change.action === 'add') {
      const data = panesY.get(key)!;
      mountPane(key, data);
    } else if (change.action === 'delete') {
      const c = mounted.get(key);
      c?.();
      mounted.delete(key);
      const el = panesParent.querySelector(`[data-pane-id="${key}"]`);
      el?.remove();
    }
  });
});

// On join, mount whatever already exists in the room.
panesY.forEach((data, id) => mountPane(id, data));

// Seed an inviting starter set if room is empty after a grace period.
// y-webrtc doesn't fire 'synced' without peers, so use a timer fallback
// (longer than the time it would take to receive state from any peer).
setTimeout(() => {
  if (panesY.size === 0) {
    createPane('code', { x: 40, y: 100 });
    createPane('widget', { x: 480, y: 100 });
    createPane('prompt', { x: 40, y: 480 });
  }
}, 1500);

// --- toolbar ---
document.querySelectorAll('.add-pane').forEach((btn) => {
  btn.addEventListener('click', () => {
    const kind = (btn as HTMLElement).dataset.kind as PaneKind;
    createPane(kind);
  });
});

// --- audio gesture gate (browser requires user gesture) ---
const startBtn = document.getElementById('start-audio')!;
startBtn.addEventListener('click', async () => {
  await stage.initAudio();
  startBtn.classList.add('hidden');
  // try playing a gentle default beat once audio is ready, only if nothing's been queued
  setTimeout(() => stage.evalAudio(`s("bd ~ sd ~").gain(0.5)`), 500);
});

// --- spacebar pause/play ---
window.addEventListener('keydown', (e) => {
  if (e.code !== 'Space') return;
  const tag = (e.target as HTMLElement).tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement).closest('.cm-editor')) return;
  e.preventDefault();
  stage.toggleAudio();
});

// --- presence chips ---
const presenceEl = document.getElementById('presence')!;
function renderPresence() {
  const states = sync.awareness.getStates();
  presenceEl.innerHTML = '';
  states.forEach((state, clientId) => {
    const u = state.user;
    if (!u) return;
    const chip = document.createElement('div');
    chip.className = 'peer-chip';
    chip.style.color = u.color;
    chip.textContent = (clientId === sync.doc.clientID ? '★ ' : '') + u.name;
    presenceEl.appendChild(chip);
  });
}
sync.awareness.on('change', renderPresence);
renderPresence();

// --- bus monitor (small HUD showing live signal values) ---
const monitor = document.createElement('div');
monitor.className = 'bus-monitor';
monitor.innerHTML = '<h4>BUS</h4><div id="bus-rows"></div>';
document.body.appendChild(monitor);
const busRows = monitor.querySelector('#bus-rows') as HTMLElement;
function renderBus() {
  const snap = bus.snapshot();
  const names = Object.keys(snap).sort();
  if (names.length === 0) {
    busRows.innerHTML = '<div style="opacity:.6">(empty)</div>';
    return;
  }
  busRows.innerHTML = names
    .map(
      (n) =>
        `<div class="bus-row"><span>${n}</span><span>${snap[n].toFixed(3)}</span></div>`,
    )
    .join('');
}
bus.onAny(renderBus);
setInterval(renderBus, 250);
renderBus();
