export default function setup(ctx, prevState) {
  const state = {
    enabled: prevState?.enabled ?? true,
    baseFreq: Number.isFinite(prevState?.baseFreq) ? prevState.baseFreq : 27.5,
    cycleSeconds: Number.isFinite(prevState?.cycleSeconds) ? prevState.cycleSeconds : 48,
    fadeSeconds: Number.isFinite(prevState?.fadeSeconds) ? prevState.fadeSeconds : 180,
    maxGain: Number.isFinite(prevState?.maxGain) ? prevState.maxGain : 0.34,
    brightness: Number.isFinite(prevState?.brightness) ? prevState.brightness : 0.42
  };

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const now = () => ctx.audioCtx.currentTime;
  const layerCount = 9;
  const centerLayer = (layerCount - 1) / 2;
  const startedAt = now();

  ctx.domRoot.innerHTML = `
    <style>
      .shepard {
        box-sizing: border-box;
        height: 100%;
        padding: 12px;
        background: rgba(7, 12, 18, 0.72);
        border: 1px solid rgba(132, 204, 22, 0.22);
        color: #e5f3d2;
        font: 11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace;
        display: grid;
        grid-template-rows: auto auto 1fr;
        gap: 10px;
        overflow: hidden;
      }
      .top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      h1 {
        margin: 0;
        color: #bef264;
        font: 700 13px/1 ui-sans-serif, system-ui, sans-serif;
      }
      button {
        border: 1px solid rgba(132, 204, 22, 0.35);
        background: rgba(20, 83, 45, 0.32);
        color: #f7fee7;
        font: inherit;
        padding: 5px 8px;
        cursor: pointer;
      }
      button[aria-pressed="false"] {
        background: rgba(15, 23, 42, 0.5);
        color: #94a3b8;
      }
      .grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px 10px;
      }
      label {
        display: grid;
        gap: 4px;
        color: #bfd0ae;
      }
      .line {
        display: flex;
        justify-content: space-between;
        gap: 8px;
      }
      input[type="range"] {
        width: 100%;
        accent-color: #84cc16;
      }
      .meter {
        align-self: end;
        display: grid;
        gap: 6px;
      }
      .bar {
        position: relative;
        height: 12px;
        border: 1px solid rgba(132, 204, 22, 0.28);
        background: rgba(15, 23, 42, 0.55);
        overflow: hidden;
      }
      .fill {
        position: absolute;
        inset: 0 auto 0 0;
        width: var(--level, 0%);
        background: linear-gradient(90deg, #365314, #84cc16, #ecfccb);
      }
      .readout {
        display: flex;
        justify-content: space-between;
        color: #9fb18f;
      }
    </style>
    <div class="shepard">
      <div class="top">
        <h1>SHEPARD SWELL</h1>
        <button id="toggle" type="button" aria-pressed="${state.enabled}">${state.enabled ? 'ON' : 'OFF'}</button>
      </div>
      <div class="grid">
        <label>
          <span class="line"><span>base</span><span id="baseText"></span></span>
          <input id="base" type="range" min="24" max="72" step="0.5" value="${state.baseFreq}">
        </label>
        <label>
          <span class="line"><span>cycle</span><span id="cycleText"></span></span>
          <input id="cycle" type="range" min="24" max="120" step="1" value="${state.cycleSeconds}">
        </label>
        <label>
          <span class="line"><span>swell</span><span id="fadeText"></span></span>
          <input id="fade" type="range" min="45" max="360" step="5" value="${state.fadeSeconds}">
        </label>
        <label>
          <span class="line"><span>ceiling</span><span id="gainText"></span></span>
          <input id="gain" type="range" min="0.08" max="0.55" step="0.01" value="${state.maxGain}">
        </label>
      </div>
      <div class="meter">
        <div class="readout"><span id="pitchText">rising</span><span id="swellText">0%</span></div>
        <div class="bar"><span id="fill" class="fill"></span></div>
      </div>
    </div>
  `;

  const toggle = ctx.domRoot.querySelector('#toggle');
  const baseSlider = ctx.domRoot.querySelector('#base');
  const cycleSlider = ctx.domRoot.querySelector('#cycle');
  const fadeSlider = ctx.domRoot.querySelector('#fade');
  const gainSlider = ctx.domRoot.querySelector('#gain');
  const baseText = ctx.domRoot.querySelector('#baseText');
  const cycleText = ctx.domRoot.querySelector('#cycleText');
  const fadeText = ctx.domRoot.querySelector('#fadeText');
  const gainText = ctx.domRoot.querySelector('#gainText');
  const pitchText = ctx.domRoot.querySelector('#pitchText');
  const swellText = ctx.domRoot.querySelector('#swellText');
  const fill = ctx.domRoot.querySelector('#fill');

  const output = ctx.audioCtx.createGain();
  const filter = ctx.audioCtx.createBiquadFilter();
  const compressor = ctx.audioCtx.createDynamicsCompressor();
  const layers = [];

  output.gain.value = 0;
  filter.type = 'lowpass';
  filter.frequency.value = 4200;
  filter.Q.value = 0.5;
  compressor.threshold.value = -18;
  compressor.knee.value = 18;
  compressor.ratio.value = 3;
  compressor.attack.value = 0.02;
  compressor.release.value = 0.25;

  filter.connect(compressor);
  compressor.connect(output);
  output.connect(ctx.audioOut);

  for (let index = 0; index < layerCount; index += 1) {
    const osc = ctx.audioCtx.createOscillator();
    const gain = ctx.audioCtx.createGain();
    const pan = ctx.audioCtx.createStereoPanner();
    osc.type = index % 3 === 1 ? 'triangle' : 'sine';
    gain.gain.value = 0;
    pan.pan.value = (index - centerLayer) / centerLayer * 0.28;
    osc.connect(gain);
    gain.connect(pan);
    pan.connect(filter);
    osc.start();
    layers.push({ osc, gain, pan });
  }

  const render = () => {
    baseText.textContent = `${Math.round(state.baseFreq)} Hz`;
    cycleText.textContent = `${Math.round(state.cycleSeconds)}s`;
    fadeText.textContent = `${Math.round(state.fadeSeconds)}s`;
    gainText.textContent = state.maxGain.toFixed(2);
    toggle.textContent = state.enabled ? 'ON' : 'OFF';
    toggle.setAttribute('aria-pressed', String(state.enabled));
  };

  const updateAudio = () => {
    const t = now();
    const elapsed = Math.max(0, t - startedAt);
    const cycle = Math.max(1, state.cycleSeconds);
    const octavePhase = (elapsed / cycle) % 1;
    const swell = clamp(elapsed / Math.max(1, state.fadeSeconds), 0, 1);
    const masterTarget = state.enabled ? Math.pow(swell, 1.7) * state.maxGain : 0;
    const cutoff = 1800 + state.brightness * 6400 + swell * 1600;

    output.gain.setTargetAtTime(masterTarget, t, 0.08);
    filter.frequency.setTargetAtTime(cutoff, t, 0.12);

    layers.forEach(({ osc, gain }, index) => {
      const position = index + octavePhase;
      const freq = state.baseFreq * Math.pow(2, position);
      const distanceFromCenter = position - centerLayer;
      const curve = Math.exp(-0.5 * Math.pow(distanceFromCenter / 1.65, 2));
      const layerGain = state.enabled ? curve * (0.105 + state.brightness * 0.045) : 0;
      osc.frequency.setTargetAtTime(clamp(freq, 18, 18000), t, 0.04);
      gain.gain.setTargetAtTime(layerGain, t, 0.06);
    });

    const visibleSwell = Math.round(swell * 100);
    pitchText.textContent = `${Math.round(state.baseFreq * Math.pow(2, octavePhase))} Hz`;
    swellText.textContent = `${visibleSwell}%`;
    fill.style.setProperty('--level', `${visibleSwell}%`);
  };

  const interval = setInterval(updateAudio, 33);

  const onToggle = () => {
    state.enabled = !state.enabled;
    render();
    updateAudio();
  };
  const onBase = () => {
    state.baseFreq = Number(baseSlider.value);
    render();
  };
  const onCycle = () => {
    state.cycleSeconds = Number(cycleSlider.value);
    render();
  };
  const onFade = () => {
    state.fadeSeconds = Number(fadeSlider.value);
    render();
  };
  const onGain = () => {
    state.maxGain = Number(gainSlider.value);
    render();
  };

  toggle.addEventListener('click', onToggle);
  baseSlider.addEventListener('input', onBase);
  cycleSlider.addEventListener('input', onCycle);
  fadeSlider.addEventListener('input', onFade);
  gainSlider.addEventListener('input', onGain);

  render();
  updateAudio();

  return {
    update() {},
    getState() {
      return { ...state };
    },
    destroy() {
      clearInterval(interval);
      toggle.removeEventListener('click', onToggle);
      baseSlider.removeEventListener('input', onBase);
      cycleSlider.removeEventListener('input', onCycle);
      fadeSlider.removeEventListener('input', onFade);
      gainSlider.removeEventListener('input', onGain);
      layers.forEach(({ osc, gain, pan }) => {
        try { osc.stop(); } catch (_) {}
        try {
          osc.disconnect();
          gain.disconnect();
          pan.disconnect();
        } catch (_) {}
      });
      try {
        filter.disconnect();
        compressor.disconnect();
        output.disconnect();
      } catch (_) {}
    }
  };
}
