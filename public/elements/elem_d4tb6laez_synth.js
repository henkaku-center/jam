// LFO-to-filter controller. Publishes local lfo_value for connected synths.
export default function setup(ctx, prevState) {
  const dom = ctx.domRoot;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const asNumber = (value, fallback) => {
    const next = Number(value);
    return Number.isFinite(next) ? next : fallback;
  };
  const normalizeType = (type) => (
    ['sine', 'triangle', 'sawtooth', 'square'].includes(type) ? type : 'triangle'
  );

  const restoreState = (saved = {}) => {
    saved = saved && typeof saved === 'object' ? saved : {};
    return {
    rate: clamp(asNumber(saved.rate, 2), 0.05, 20),
    depth: clamp(asNumber(saved.depth, 0.35), 0, 1),
    type: normalizeType(saved.type),
    polarity: saved.polarity === 'negative' ? 'negative' : 'bipolar',
    rangeHz: clamp(asNumber(saved.rangeHz ?? saved.range, 1500), 100, 3000)
    };
  };

  const state = restoreState(prevState);
  const subscriptions = [];
  const listeners = [];
  let phase = 0;
  let lastTime = 0;
  let lastValue = 0;
  let lastVisualValue = 0;
  let lastCutoffPreview = 1000;

  const formatHz = (value, digits = 1) => `${Number(value).toFixed(digits)}Hz`;
  const waveValue = (position) => {
    const p = ((position % 1) + 1) % 1;
    if (state.type === 'triangle') return 1 - Math.abs(p * 4 - 2);
    if (state.type === 'sawtooth') return p * 2 - 1;
    if (state.type === 'square') return p < 0.5 ? 1 : -1;
    return Math.sin(p * Math.PI * 2);
  };
  const applyPolarity = (value) => (
    state.polarity === 'negative' ? (value - 1) * 0.5 : value
  );

  dom.innerHTML = `
    <style>
      :host {
        display: block;
        width: 100%;
        height: 100%;
      }

      .card {
        width: 100%;
        height: 100%;
        box-sizing: border-box;
        color: #f8fafc;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background:
          radial-gradient(circle at 18% 12%, rgba(45, 212, 191, 0.2), transparent 38%),
          linear-gradient(145deg, rgba(10, 14, 24, 0.98), rgba(24, 18, 37, 0.96));
        border: 1px solid rgba(148, 163, 184, 0.35);
        border-radius: 8px;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 14px 30px rgba(0, 0, 0, 0.28);
        padding: 12px;
        overflow: hidden;
      }

      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 8px;
      }

      h3 {
        margin: 0;
        color: #a7f3d0;
        font-size: 12px;
        font-weight: 800;
        letter-spacing: 0;
        text-transform: uppercase;
      }

      .status {
        min-width: 58px;
        border: 1px solid rgba(45, 212, 191, 0.45);
        border-radius: 999px;
        padding: 3px 7px;
        color: #5eead4;
        background: rgba(20, 184, 166, 0.1);
        font-size: 9px;
        font-weight: 800;
        text-align: center;
      }

      .scope {
        height: 46px;
        border-radius: 7px;
        border: 1px solid rgba(148, 163, 184, 0.22);
        background: rgba(2, 6, 23, 0.76);
        position: relative;
        overflow: hidden;
        margin-bottom: 9px;
      }

      .scope::before {
        content: "";
        position: absolute;
        inset: 50% 0 auto 0;
        height: 1px;
        background: rgba(148, 163, 184, 0.24);
      }

      .trace {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
      }

      .dot {
        position: absolute;
        width: 12px;
        height: 12px;
        left: 50%;
        top: 50%;
        transform: translate(-50%, -50%);
        border-radius: 999px;
        background: #facc15;
        box-shadow: 0 0 18px rgba(250, 204, 21, 0.9);
      }

      .meter {
        position: absolute;
        left: 0;
        bottom: 0;
        height: 3px;
        width: 50%;
        background: linear-gradient(90deg, #2dd4bf, #facc15);
        box-shadow: 0 0 10px rgba(45, 212, 191, 0.6);
      }

      .row {
        display: grid;
        grid-template-columns: 48px minmax(0, 1fr) 52px;
        align-items: center;
        gap: 7px;
        margin-bottom: 6px;
        font-size: 10px;
      }

      label {
        color: #cbd5e1;
        font-weight: 700;
      }

      .val {
        color: #facc15;
        font-variant-numeric: tabular-nums;
        font-size: 10px;
        font-weight: 800;
        text-align: right;
      }

      input[type="range"] {
        width: 100%;
        accent-color: #2dd4bf;
      }

      .selects {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 7px;
      }

      select {
        width: 100%;
        min-width: 0;
        border: 1px solid rgba(148, 163, 184, 0.3);
        border-radius: 6px;
        color: #f8fafc;
        background: rgba(15, 23, 42, 0.94);
        padding: 5px 6px;
        font-size: 10px;
        font-weight: 700;
      }

      .footer {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        margin-top: 8px;
        color: #94a3b8;
        font-size: 9px;
        font-weight: 700;
      }

      .out {
        color: #5eead4;
        font-variant-numeric: tabular-nums;
      }
    </style>

    <div class="card">
      <div class="header">
        <h3>LFO Filter Link</h3>
        <div class="status">LOCAL OUT</div>
      </div>

      <div class="scope" aria-hidden="true">
        <svg class="trace" viewBox="0 0 220 46" preserveAspectRatio="none">
          <path id="wave-path" d="" fill="none" stroke="#2dd4bf" stroke-width="2" stroke-linecap="round" />
        </svg>
        <div class="dot" id="lfo-dot"></div>
        <div class="meter" id="lfo-meter"></div>
      </div>

      <div class="row">
        <label for="rate-slider">Rate</label>
        <input type="range" id="rate-slider" min="0.05" max="20" step="0.05" value="${state.rate}">
        <span class="val" id="rate-val">${formatHz(state.rate, 2)}</span>
      </div>

      <div class="row">
        <label for="depth-slider">Depth</label>
        <input type="range" id="depth-slider" min="0" max="1" step="0.01" value="${state.depth}">
        <span class="val" id="depth-val">${Math.round(state.depth * 100)}%</span>
      </div>

      <div class="row">
        <label for="range-slider">Sweep</label>
        <input type="range" id="range-slider" min="100" max="3000" step="25" value="${state.rangeHz}">
        <span class="val" id="range-val">${Math.round(state.rangeHz)}Hz</span>
      </div>

      <div class="selects">
        <select id="type-select" aria-label="Wave shape">
          <option value="sine" ${state.type === 'sine' ? 'selected' : ''}>Sine</option>
          <option value="triangle" ${state.type === 'triangle' ? 'selected' : ''}>Triangle</option>
          <option value="sawtooth" ${state.type === 'sawtooth' ? 'selected' : ''}>Saw</option>
          <option value="square" ${state.type === 'square' ? 'selected' : ''}>Square</option>
        </select>
        <select id="polarity-select" aria-label="Modulation polarity">
          <option value="bipolar" ${state.polarity === 'bipolar' ? 'selected' : ''}>Bipolar</option>
          <option value="negative" ${state.polarity === 'negative' ? 'selected' : ''}>Down only</option>
        </select>
      </div>

      <div class="footer">
        <span>bus: lfo_value</span>
        <span class="out" id="out-val">0.00</span>
      </div>
    </div>
  `;

  const rateSlider = dom.querySelector('#rate-slider');
  const rateVal = dom.querySelector('#rate-val');
  const depthSlider = dom.querySelector('#depth-slider');
  const depthVal = dom.querySelector('#depth-val');
  const rangeSlider = dom.querySelector('#range-slider');
  const rangeVal = dom.querySelector('#range-val');
  const typeSelect = dom.querySelector('#type-select');
  const polaritySelect = dom.querySelector('#polarity-select');
  const path = dom.querySelector('#wave-path');
  const dot = dom.querySelector('#lfo-dot');
  const meter = dom.querySelector('#lfo-meter');
  const outVal = dom.querySelector('#out-val');

  const drawWave = () => {
    const points = [];
    for (let i = 0; i <= 64; i += 1) {
      const x = (i / 64) * 220;
      const raw = waveValue((i / 64) + phase);
      const y = 23 - applyPolarity(raw) * state.depth * 17;
      points.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`);
    }
    path.setAttribute('d', points.join(' '));
  };

  const updateLabels = () => {
    rateVal.textContent = formatHz(state.rate, 2);
    depthVal.textContent = `${Math.round(state.depth * 100)}%`;
    rangeVal.textContent = `${Math.round(state.rangeHz)}Hz`;
  };

  const publishControl = (key, value) => {
    ctx.bus.pubGlobal(key, value);
  };

  const setRate = (value) => {
    state.rate = clamp(asNumber(value, state.rate), 0.05, 20);
    rateSlider.value = state.rate;
    updateLabels();
  };

  const setDepth = (value) => {
    state.depth = clamp(asNumber(value, state.depth), 0, 1);
    depthSlider.value = state.depth;
    updateLabels();
  };

  const setRangeHz = (value) => {
    state.rangeHz = clamp(asNumber(value, state.rangeHz), 100, 3000);
    rangeSlider.value = state.rangeHz;
    updateLabels();
  };

  const setType = (value) => {
    state.type = normalizeType(value);
    typeSelect.value = state.type;
  };

  const setPolarity = (value) => {
    state.polarity = value === 'negative' ? 'negative' : 'bipolar';
    polaritySelect.value = state.polarity;
  };

  const on = (element, type, handler) => {
    element.addEventListener(type, handler);
    listeners.push(() => element.removeEventListener(type, handler));
  };

  on(rateSlider, 'input', (event) => {
    setRate(event.target.value);
    publishControl('lfo_rate', state.rate);
  });

  on(depthSlider, 'input', (event) => {
    setDepth(event.target.value);
    publishControl('lfo_depth', state.depth);
  });

  on(rangeSlider, 'input', (event) => {
    setRangeHz(event.target.value);
    publishControl('lfo_range_hz', state.rangeHz);
  });

  on(typeSelect, 'change', (event) => {
    setType(event.target.value);
    publishControl('lfo_type', state.type);
  });

  on(polaritySelect, 'change', (event) => {
    setPolarity(event.target.value);
    publishControl('lfo_polarity', state.polarity);
  });

  const subGlobal = (key, handler) => {
    const unsub = ctx.bus.subGlobal(key, handler);
    if (typeof unsub === 'function') subscriptions.push(unsub);
  };

  subGlobal('lfo_rate', (value) => {
    setRate(value);
  });

  subGlobal('lfo_depth', (value) => {
    setDepth(value);
  });

  subGlobal('lfo_range_hz', (value) => {
    setRangeHz(value);
  });

  subGlobal('lfo_type', (value) => {
    setType(value);
  });

  subGlobal('lfo_polarity', (value) => {
    setPolarity(value);
  });

  updateLabels();
  drawWave();

  return {
    update(tick) {
      const now = asNumber(tick?.time ?? ctx.audioCtx?.currentTime, performance.now() / 1000);
      const delta = lastTime > 0 ? clamp(now - lastTime, 0, 0.08) : 1 / 60;
      lastTime = now;
      phase = (phase + state.rate * delta) % 1;

      const raw = waveValue(phase);
      lastVisualValue = applyPolarity(raw) * state.depth;
      lastValue = lastVisualValue * (state.rangeHz / 1500);
      lastCutoffPreview = clamp(1000 + lastValue * 1500, 100, 4000);

      const x = 50 + lastVisualValue * 44;
      const y = 50 - lastVisualValue * 34;
      dot.style.left = `${clamp(x, 6, 94)}%`;
      dot.style.top = `${clamp(y, 12, 88)}%`;
      meter.style.width = `${clamp(50 + lastVisualValue * 50, 0, 100)}%`;
      outVal.textContent = `${lastValue.toFixed(2)} -> ${Math.round(lastCutoffPreview)}Hz`;
      drawWave();

      ctx.bus.pub('lfo_value', lastValue);
      ctx.bus.pub('lfo_cutoff_preview_hz', lastCutoffPreview);
    },

    getState() {
      return {
        rate: state.rate,
        depth: state.depth,
        type: state.type,
        polarity: state.polarity,
        rangeHz: state.rangeHz
      };
    },

    destroy() {
      listeners.forEach((remove) => remove());
      subscriptions.forEach((unsubscribe) => unsubscribe());
      ctx.bus.pub('lfo_value', 0);
      dom.innerHTML = '';
    }
  };
}
