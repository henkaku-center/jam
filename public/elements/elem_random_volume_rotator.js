export default function setup(ctx, prevState) {
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;

  const state = {
    enabled: prevState?.enabled ?? true,
    boost: finite(prevState?.boost, 1.65),
    duck: finite(prevState?.duck, 0.16),
    cycleSteps: finite(prevState?.cycleSteps, 16),
    currentId: typeof prevState?.currentId === 'string' ? prevState.currentId : '',
    nextAtStep: finite(prevState?.nextAtStep, -1),
    lastStep: finite(prevState?.lastStep, -1)
  };

  let rafId = 0;
  let pulse = 0;
  let candidateIds = [];
  let lastAppliedKey = '';
  const touchedWrappers = new Set();
  const audioTypes = new Set(['audio', 'synth', 'strudel', 'sampler', 'sequencer']);

  ctx.domRoot.innerHTML = `
    <style>
      :host {
        display: block;
        width: 100%;
        height: 100%;
      }
      .panel {
        box-sizing: border-box;
        height: 100%;
        padding: 14px;
        border: 1px solid rgba(125, 211, 252, 0.34);
        border-radius: 8px;
        background: linear-gradient(180deg, rgba(8, 18, 29, 0.96), rgba(13, 24, 33, 0.96));
        color: #e5f7ff;
        font: 12px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        box-shadow: 0 12px 34px rgba(0, 0, 0, 0.28);
        overflow: hidden;
      }
      .top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 12px;
      }
      .title {
        display: grid;
        gap: 2px;
        min-width: 0;
      }
      h2 {
        margin: 0;
        color: #f8fafc;
        font-size: 15px;
        font-weight: 750;
        letter-spacing: 0;
      }
      .sub {
        color: #93c5fd;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      button {
        border: 1px solid rgba(148, 163, 184, 0.36);
        border-radius: 6px;
        background: rgba(15, 23, 42, 0.86);
        color: #dbeafe;
        font: inherit;
        padding: 7px 9px;
        cursor: pointer;
      }
      button.active {
        border-color: rgba(52, 211, 153, 0.7);
        background: rgba(6, 78, 59, 0.65);
        color: #d1fae5;
      }
      .meter {
        position: relative;
        height: 56px;
        margin: 8px 0 12px;
        border-radius: 8px;
        background:
          linear-gradient(90deg, rgba(14, 165, 233, 0.2), rgba(34, 197, 94, 0.24)),
          rgba(2, 6, 23, 0.64);
        border: 1px solid rgba(148, 163, 184, 0.22);
        overflow: hidden;
      }
      .sweep {
        position: absolute;
        inset: 0 auto 0 0;
        width: 34%;
        background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent);
      }
      .spot {
        position: absolute;
        left: 10px;
        right: 10px;
        top: 9px;
        color: #f8fafc;
        font-size: 13px;
        font-weight: 700;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .count {
        position: absolute;
        left: 10px;
        bottom: 8px;
        color: #bae6fd;
      }
      .grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
      }
      label {
        display: grid;
        gap: 5px;
        color: #bfdbfe;
      }
      input[type="range"] {
        width: 100%;
        accent-color: #38bdf8;
      }
      .read {
        display: flex;
        justify-content: space-between;
        color: #e0f2fe;
      }
      .list {
        margin-top: 11px;
        height: 52px;
        overflow: hidden;
        color: #94a3b8;
        font-size: 11px;
      }
      .empty {
        color: #fca5a5;
      }
    </style>
    <div class="panel">
      <div class="top">
        <div class="title">
          <h2>Volume Rotator</h2>
          <div class="sub">random one-bar spotlight</div>
        </div>
        <button id="enabled" type="button"></button>
      </div>
      <div class="meter" id="meter">
        <div class="sweep"></div>
        <div class="spot" id="spot"></div>
        <div class="count" id="count"></div>
      </div>
      <div class="grid">
        <label>
          <span class="read"><span>boost</span><span id="boostVal"></span></span>
          <input id="boost" type="range" min="1" max="2.5" step="0.01">
        </label>
        <label>
          <span class="read"><span>duck</span><span id="duckVal"></span></span>
          <input id="duck" type="range" min="0" max="0.5" step="0.01">
        </label>
      </div>
      <div class="list" id="list"></div>
    </div>
  `;

  const $ = (selector) => ctx.domRoot.querySelector(selector);
  const els = {
    enabled: $('#enabled'),
    meter: $('#meter'),
    spot: $('#spot'),
    count: $('#count'),
    boost: $('#boost'),
    duck: $('#duck'),
    boostVal: $('#boostVal'),
    duckVal: $('#duckVal'),
    list: $('#list')
  };

  const getLayout = (id) => {
    const map = window.elementsMap;
    if (!map || typeof map.get !== 'function') return null;
    try {
      return map.get(id) || null;
    } catch (_) {
      return null;
    }
  };

  const displayName = (id) => {
    const layout = getLayout(id);
    return layout?.prompt || id;
  };

  const scanCandidates = () => {
    const active = window.activeElements;
    if (!active || typeof active.forEach !== 'function') {
      candidateIds = [];
      return candidateIds;
    }

    const ids = [];
    active.forEach((entry, id) => {
      if (!id || id === ctx.elementId || !entry?.audioVolumeNode) return;
      const layout = getLayout(id) || entry.layout || {};
      const type = String(layout.type || '').toLowerCase();
      if (audioTypes.has(type)) ids.push(id);
    });

    candidateIds = ids.sort();
    if (state.currentId && !candidateIds.includes(state.currentId)) {
      state.currentId = '';
    }
    return candidateIds;
  };

  const pickNext = () => {
    scanCandidates();
    if (candidateIds.length === 0) {
      state.currentId = '';
      return '';
    }
    if (candidateIds.length === 1) {
      state.currentId = candidateIds[0];
      return state.currentId;
    }

    const pool = candidateIds.filter((id) => id !== state.currentId);
    state.currentId = pool[Math.floor(Math.random() * pool.length)];
    pulse = 1;
    ctx.bus.pubGlobal('volume_rotator_current', {
      id: state.currentId,
      step: state.lastStep,
      at: Date.now()
    });
    return state.currentId;
  };

  const clearHighlights = () => {
    touchedWrappers.forEach((wrapper) => {
      if (!wrapper?.style) return;
      wrapper.style.outline = '';
      wrapper.style.boxShadow = '';
    });
    touchedWrappers.clear();
  };

  const applyMix = () => {
    const active = window.activeElements;
    if (!active || typeof active.forEach !== 'function') return;

    scanCandidates();
    if (state.enabled && !state.currentId) pickNext();

    const now = ctx.rawAudioCtx?.currentTime ?? ctx.audioCtx.currentTime;
    const duck = clamp(state.duck, 0, 0.5);
    const boost = clamp(state.boost, 1, 2.5);
    const applyKey = `${state.enabled}|${state.currentId}|${boost}|${duck}|${candidateIds.join(',')}`;

    if (!state.enabled) {
      if (lastAppliedKey !== applyKey) {
        active.forEach((entry) => {
          try {
            entry?.audioVolumeNode?.gain?.setTargetAtTime?.(1, now, 0.035);
          } catch (_) {}
        });
        clearHighlights();
        lastAppliedKey = applyKey;
      }
      return;
    }

    active.forEach((entry, id) => {
      const gain = entry?.audioVolumeNode?.gain;
      if (!gain) return;
      const target = id === state.currentId ? boost : (candidateIds.includes(id) ? duck : 1);
      try {
        gain.cancelScheduledValues?.(now);
        gain.setTargetAtTime(target, now, id === state.currentId ? 0.025 : 0.045);
      } catch (_) {}

      const wrapper = entry.domWrapper;
      if (!wrapper?.style) return;
      touchedWrappers.add(wrapper);
      if (id === state.currentId) {
        wrapper.style.outline = '2px solid rgba(56, 189, 248, 0.86)';
        wrapper.style.boxShadow = '0 0 0 5px rgba(56, 189, 248, 0.14), 0 18px 40px rgba(14, 165, 233, 0.22)';
      } else if (candidateIds.includes(id)) {
        wrapper.style.outline = '1px solid rgba(148, 163, 184, 0.18)';
        wrapper.style.boxShadow = '0 10px 26px rgba(0, 0, 0, 0.22)';
      }
    });

    lastAppliedKey = applyKey;
  };

  const render = () => {
    els.enabled.textContent = state.enabled ? 'on' : 'off';
    els.enabled.classList.toggle('active', state.enabled);
    els.boost.value = String(state.boost);
    els.duck.value = String(state.duck);
    els.boostVal.textContent = `${state.boost.toFixed(2)}x`;
    els.duckVal.textContent = `${Math.round(state.duck * 100)}%`;
    els.spot.textContent = state.currentId ? displayName(state.currentId) : 'waiting for audio elements';
    els.spot.classList.toggle('empty', !state.currentId);
    els.count.textContent = `${candidateIds.length} targets`;
    els.list.textContent = candidateIds.length ? candidateIds.join('  ') : 'No active audio/synth/strudel elements found.';
    const sweep = els.meter.querySelector('.sweep');
    if (sweep) sweep.style.transform = `translateX(${clamp(pulse, 0, 1) * 190 - 100}%)`;
  };

  const onTick = ({ step }) => {
    const cycle = Math.max(1, Math.round(state.cycleSteps));
    state.lastStep = step;
    if (!state.enabled) return;
    if (step % cycle === 0 || !state.currentId) {
      pickNext();
      state.nextAtStep = step + cycle;
      render();
    }
  };

  const frame = () => {
    pulse *= 0.91;
    applyMix();
    render();
    rafId = requestAnimationFrame(frame);
  };

  const onEnabled = () => {
    state.enabled = !state.enabled;
    if (state.enabled) pickNext();
    ctx.bus.pubGlobal('volume_rotator_enabled', state.enabled);
    render();
  };

  const onBoost = () => {
    state.boost = clamp(Number(els.boost.value), 1, 2.5);
    ctx.bus.pubGlobal('volume_rotator_boost', state.boost);
    render();
  };

  const onDuck = () => {
    state.duck = clamp(Number(els.duck.value), 0, 0.5);
    ctx.bus.pubGlobal('volume_rotator_duck', state.duck);
    render();
  };

  els.enabled.addEventListener('click', onEnabled);
  els.boost.addEventListener('input', onBoost);
  els.duck.addEventListener('input', onDuck);

  const unsubs = [
    ctx.clock.onTick(onTick),
    ctx.bus.subGlobal('volume_rotator_enabled', (value) => {
      if (typeof value !== 'boolean') return;
      state.enabled = value;
      if (state.enabled && !state.currentId) pickNext();
      render();
    }),
    ctx.bus.subGlobal('volume_rotator_boost', (value) => {
      if (!Number.isFinite(Number(value))) return;
      state.boost = clamp(Number(value), 1, 2.5);
      render();
    }),
    ctx.bus.subGlobal('volume_rotator_duck', (value) => {
      if (!Number.isFinite(Number(value))) return;
      state.duck = clamp(Number(value), 0, 0.5);
      render();
    })
  ];

  scanCandidates();
  if (state.enabled && !state.currentId) pickNext();
  render();
  rafId = requestAnimationFrame(frame);

  return {
    update() {},
    getState() {
      return { ...state };
    },
    destroy() {
      cancelAnimationFrame(rafId);
      els.enabled.removeEventListener('click', onEnabled);
      els.boost.removeEventListener('input', onBoost);
      els.duck.removeEventListener('input', onDuck);
      unsubs.forEach((unsubscribe) => unsubscribe());
      clearHighlights();
      const active = window.activeElements;
      const now = ctx.rawAudioCtx?.currentTime ?? ctx.audioCtx.currentTime;
      if (active && typeof active.forEach === 'function') {
        active.forEach((entry) => {
          try {
            entry?.audioVolumeNode?.gain?.setTargetAtTime?.(1, now, 0.05);
          } catch (_) {}
        });
      }
    }
  };
}
