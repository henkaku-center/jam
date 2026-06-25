const MIN_BPM = 40;
const MAX_BPM = 220;
const DEFAULT_BPM = 120;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function finiteNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeState(prevState) {
  const source = prevState && typeof prevState === 'object' ? prevState : {};
  const restoredBpm = finiteNumber(source.bpm ?? source.tempo ?? source.value, DEFAULT_BPM);
  return {
    bpm: clamp(restoredBpm, MIN_BPM, MAX_BPM),
    lastTapMs: finiteNumber(source.lastTapMs, 0),
    tapIntervals: Array.isArray(source.tapIntervals)
      ? source.tapIntervals.map(Number).filter(Number.isFinite).slice(-4)
      : []
  };
}

function formatBpm(value) {
  return Number(value).toFixed(1);
}

export default function setup(ctx, prevState) {
  const state = normalizeState(prevState);
  const elementId = ctx.elementId || `tempo-${Math.random().toString(36).slice(2)}`;
  const clockMap = ctx.ydoc && typeof ctx.ydoc.getMap === 'function' ? ctx.ydoc.getMap('clock') : null;
  let suppressClockObserve = false;
  let lastStep = -1;
  let lastRenderedStep = -1;
  let tapFlashTimer = 0;

  const readClockBpm = () => clamp(finiteNumber(ctx.clock?.bpm, state.bpm), MIN_BPM, MAX_BPM);
  const readClockStartTime = () => finiteNumber(ctx.clock?.startTime, Date.now());
  const syncNow = () => {
    if (typeof ctx.clock?.now === 'function') return finiteNumber(ctx.clock.now(), Date.now());
    return Date.now();
  };

  state.bpm = readClockBpm();

  ctx.domRoot.innerHTML = `
    <style>
      :host {
        display: block;
        width: 100%;
        height: 100%;
      }
      * {
        box-sizing: border-box;
      }
      .tempo-panel {
        width: 100%;
        height: 100%;
        min-width: 150px;
        min-height: 118px;
        display: grid;
        grid-template-rows: auto 1fr auto;
        gap: 8px;
        padding: 10px;
        overflow: hidden;
        background: rgba(26, 28, 33, 0.88);
        border: 1px solid #2a2d35;
        color: #d4d8e0;
        font: 11px/1.25 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .topline,
      .row {
        display: flex;
        align-items: center;
        min-width: 0;
      }
      .topline {
        justify-content: space-between;
        gap: 8px;
        color: #555d6e;
        letter-spacing: 0;
        text-transform: uppercase;
        white-space: nowrap;
      }
      .status {
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .main {
        display: grid;
        gap: 8px;
        min-height: 0;
      }
      .bpm-line {
        display: flex;
        align-items: baseline;
        gap: 7px;
        min-width: 0;
      }
      .bpm-value {
        color: #f5f7fb;
        font: 28px/0.95 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        letter-spacing: 0;
        white-space: nowrap;
      }
      .unit {
        color: #555d6e;
        font: 11px/1 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        white-space: nowrap;
      }
      input[type="range"] {
        width: 100%;
        min-width: 0;
        accent-color: #3b82f6;
      }
      .buttons {
        display: grid;
        grid-template-columns: repeat(6, minmax(0, 1fr));
        gap: 4px;
      }
      button {
        min-width: 0;
        height: 24px;
        padding: 0 5px;
        border: 1px solid #2a2d35;
        border-radius: 0;
        background: #1a1c21;
        color: #d4d8e0;
        font: 10px/1 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        cursor: pointer;
      }
      button:active,
      button.is-active {
        border-color: #3b82f6;
        color: #3b82f6;
      }
      button:focus-visible,
      input:focus-visible {
        outline: 1px solid #3b82f6;
        outline-offset: 1px;
      }
      .phase {
        display: grid;
        grid-template-columns: repeat(16, minmax(0, 1fr));
        gap: 2px;
        height: 14px;
        align-items: stretch;
      }
      .phase-cell {
        min-width: 0;
        background: #2a2d35;
        border: 1px solid #2a2d35;
      }
      .phase-cell.beat {
        background: #3a3f4a;
      }
      .phase-cell.active {
        background: #f5a623;
        border-color: #f5a623;
      }
      .footer {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        color: #555d6e;
        font: 10px/1.1 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        min-width: 0;
      }
      .footer span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    </style>
    <div class="tempo-panel">
      <div class="topline">
        <span>MASTER TEMPO</span>
        <span id="status" class="status">synced</span>
      </div>
      <div class="main">
        <div class="bpm-line">
          <span id="bpmValue" class="bpm-value">${formatBpm(state.bpm)}</span>
          <span class="unit">BPM</span>
        </div>
        <input id="bpmSlider" type="range" min="${MIN_BPM}" max="${MAX_BPM}" step="0.1" value="${state.bpm}">
        <div class="buttons">
          <button type="button" data-delta="-5">-5</button>
          <button type="button" data-delta="-1">-1</button>
          <button type="button" id="tapButton">TAP</button>
          <button type="button" id="resetButton">120</button>
          <button type="button" data-delta="1">+1</button>
          <button type="button" data-delta="5">+5</button>
        </div>
      </div>
      <div>
        <div id="phase" class="phase" aria-hidden="true">
          ${Array.from({ length: 16 }, (_, index) => `<span class="phase-cell${index % 4 === 0 ? ' beat' : ''}"></span>`).join('')}
        </div>
        <div class="footer">
          <span id="stepReadout">step 00</span>
          <span id="clockReadout">shared clock</span>
        </div>
      </div>
    </div>
  `;

  const bpmValue = ctx.domRoot.querySelector('#bpmValue');
  const slider = ctx.domRoot.querySelector('#bpmSlider');
  const status = ctx.domRoot.querySelector('#status');
  const tapButton = ctx.domRoot.querySelector('#tapButton');
  const resetButton = ctx.domRoot.querySelector('#resetButton');
  const stepReadout = ctx.domRoot.querySelector('#stepReadout');
  const clockReadout = ctx.domRoot.querySelector('#clockReadout');
  const phaseCells = Array.from(ctx.domRoot.querySelectorAll('.phase-cell'));
  const deltaButtons = Array.from(ctx.domRoot.querySelectorAll('[data-delta]'));

  function renderTempo(label) {
    bpmValue.textContent = formatBpm(state.bpm);
    slider.value = String(state.bpm);
    if (label) status.textContent = label;
    clockReadout.textContent = `${formatBpm(readClockBpm())} bpm`;
  }

  function publishTempo(reason) {
    ctx.bus.pubGlobal('global:tempo_bpm', {
      bpm: state.bpm,
      reason,
      source: elementId,
      at: syncNow()
    });
  }

  function pivotClock(nextBpm, reason) {
    const bpm = clamp(finiteNumber(nextBpm, state.bpm), MIN_BPM, MAX_BPM);
    const currentBpm = readClockBpm();
    const oldStartTime = readClockStartTime();
    const now = syncNow();
    const elapsedBeats = (now - oldStartTime) * (currentBpm / 60000);
    const nextStartTime = now - (elapsedBeats * 60000 / bpm);

    state.bpm = bpm;
    suppressClockObserve = true;
    if (clockMap) {
      const commitClock = () => {
        clockMap.set('bpm', bpm);
        clockMap.set('startTime', nextStartTime);
      };
      if (clockMap.doc && typeof clockMap.doc.transact === 'function') {
        clockMap.doc.transact(commitClock);
      } else {
        commitClock();
      }
    }
    suppressClockObserve = false;

    publishTempo(reason);
    renderTempo(reason);
  }

  function setTempo(nextBpm, reason) {
    pivotClock(nextBpm, reason);
  }

  function onSliderInput() {
    setTempo(Number(slider.value), 'slider');
  }

  function onDeltaClick(event) {
    const delta = finiteNumber(event.currentTarget.dataset.delta, 0);
    setTempo(Math.round((state.bpm + delta) * 10) / 10, 'step');
  }

  function onResetClick() {
    state.tapIntervals = [];
    state.lastTapMs = 0;
    setTempo(DEFAULT_BPM, 'reset');
  }

  function onTapClick() {
    const now = Date.now();
    if (state.lastTapMs > 0) {
      const interval = now - state.lastTapMs;
      if (interval > 250 && interval < 2000) {
        state.tapIntervals.push(interval);
        state.tapIntervals = state.tapIntervals.slice(-4);
        const average = state.tapIntervals.reduce((sum, value) => sum + value, 0) / state.tapIntervals.length;
        setTempo(60000 / average, 'tap');
      } else {
        state.tapIntervals = [];
      }
    }
    state.lastTapMs = now;
    tapButton.classList.add('is-active');
    clearTimeout(tapFlashTimer);
    tapFlashTimer = setTimeout(() => tapButton.classList.remove('is-active'), 90);
  }

  slider.addEventListener('input', onSliderInput);
  resetButton.addEventListener('click', onResetClick);
  tapButton.addEventListener('click', onTapClick);
  deltaButtons.forEach(button => button.addEventListener('click', onDeltaClick));

  const unsubscribeTempo = ctx.bus.subGlobal('global:tempo_bpm', value => {
    if (!value || typeof value !== 'object' || value.source === elementId) return;
    const nextBpm = clamp(finiteNumber(value.bpm, state.bpm), MIN_BPM, MAX_BPM);
    state.bpm = nextBpm;
    renderTempo('remote');
  });

  let unobserveClock = () => {};
  if (clockMap && typeof clockMap.observe === 'function') {
    const observeClock = event => {
      if (suppressClockObserve || !event.keysChanged.has('bpm')) return;
      state.bpm = readClockBpm();
      renderTempo('clock');
    };
    clockMap.observe(observeClock);
    unobserveClock = () => clockMap.unobserve(observeClock);
  }

  const unsubscribeTick = ctx.clock.onTick(({ step, bpm }) => {
    lastStep = step;
    ctx.bus.pub('master_tempo:step', { step, bpm });
  });

  renderTempo('synced');

  return {
    update() {
      if (lastRenderedStep === lastStep) return;
      lastRenderedStep = lastStep;
      const activeIndex = ((lastStep % 16) + 16) % 16;
      phaseCells.forEach((cell, index) => {
        cell.classList.toggle('active', index === activeIndex);
      });
      stepReadout.textContent = `step ${String(activeIndex).padStart(2, '0')}`;
      clockReadout.textContent = `${formatBpm(readClockBpm())} bpm`;
    },
    getState() {
      return {
        bpm: state.bpm,
        lastTapMs: state.lastTapMs,
        tapIntervals: state.tapIntervals.slice()
      };
    },
    destroy() {
      slider.removeEventListener('input', onSliderInput);
      resetButton.removeEventListener('click', onResetClick);
      tapButton.removeEventListener('click', onTapClick);
      deltaButtons.forEach(button => button.removeEventListener('click', onDeltaClick));
      clearTimeout(tapFlashTimer);
      unsubscribeTempo();
      unsubscribeTick();
      unobserveClock();
    }
  };
}