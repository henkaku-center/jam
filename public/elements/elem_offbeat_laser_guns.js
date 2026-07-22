export default function setup(ctx, prevState) {
  const state = {
    enabled: prevState?.enabled ?? true,
    chance: Number.isFinite(prevState?.chance) ? prevState.chance : 0.62,
    volume: Number.isFinite(prevState?.volume) ? prevState.volume : 0.38,
    pitch: Number.isFinite(prevState?.pitch) ? prevState.pitch : 0.58,
    chaos: Number.isFinite(prevState?.chaos) ? prevState.chaos : 0.48
  };

  const audio = ctx.audioCtx;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const now = () => audio.currentTime;
  const offbeats = new Set([2, 6, 10, 14]);
  const activeNodes = new Set();
  const cleanupTimers = new Set();
  let lastStep = -1;
  let lastCycle = -1;
  let currentHitPlan = new Set();

  ctx.domRoot.innerHTML = `
    <style>
      .laser {
        box-sizing: border-box;
        height: 100%;
        min-width: 260px;
        padding: 12px;
        overflow: hidden;
        display: grid;
        grid-template-rows: auto auto 1fr;
        gap: 10px;
        color: #eaf7ff;
        background: rgba(6, 12, 20, 0.78);
        border: 1px solid rgba(56, 189, 248, 0.32);
        font: 11px/1.32 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }
      .top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      h1 {
        margin: 0;
        color: #67e8f9;
        font: 700 13px/1 ui-sans-serif, system-ui, sans-serif;
      }
      button {
        border: 1px solid rgba(56, 189, 248, 0.45);
        background: rgba(8, 145, 178, 0.34);
        color: #ecfeff;
        font: inherit;
        padding: 5px 8px;
        cursor: pointer;
      }
      button[aria-pressed="false"] {
        background: rgba(15, 23, 42, 0.62);
        color: #94a3b8;
      }
      .controls {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px 10px;
      }
      label {
        display: grid;
        gap: 4px;
        min-width: 0;
        color: #bae6fd;
      }
      .line {
        display: flex;
        justify-content: space-between;
        gap: 8px;
      }
      input[type="range"] {
        width: 100%;
        min-width: 0;
        accent-color: #06b6d4;
      }
      .grid {
        align-self: end;
        display: grid;
        grid-template-columns: repeat(16, minmax(0, 1fr));
        gap: 4px;
        min-height: 54px;
        align-items: end;
      }
      .step {
        position: relative;
        height: 34px;
        border: 1px solid rgba(56, 189, 248, 0.18);
        background: rgba(15, 23, 42, 0.68);
        overflow: hidden;
      }
      .step.offbeat {
        border-color: rgba(56, 189, 248, 0.46);
      }
      .step.planned::before {
        content: "";
        position: absolute;
        inset: auto 0 0;
        height: 45%;
        background: rgba(34, 211, 238, 0.28);
      }
      .step.active {
        border-color: #f0f9ff;
        box-shadow: 0 0 14px rgba(34, 211, 238, 0.72);
      }
      .step.active::before {
        height: 100%;
        background: linear-gradient(180deg, #f0f9ff, #22d3ee 45%, #0e7490);
      }
      .readout {
        display: flex;
        justify-content: space-between;
        color: #7dd3fc;
      }
    </style>
    <div class="laser">
      <div class="top">
        <h1>OFFBEAT LASERS</h1>
        <button id="toggle" type="button" aria-pressed="${state.enabled}">${state.enabled ? 'ON' : 'OFF'}</button>
      </div>
      <div class="controls">
        <label>
          <span class="line"><span>chance</span><span id="chanceText"></span></span>
          <input id="chance" type="range" min="0" max="1" step="0.01" value="${state.chance}">
        </label>
        <label>
          <span class="line"><span>volume</span><span id="volumeText"></span></span>
          <input id="volume" type="range" min="0" max="0.8" step="0.01" value="${state.volume}">
        </label>
        <label>
          <span class="line"><span>pitch</span><span id="pitchText"></span></span>
          <input id="pitch" type="range" min="0" max="1" step="0.01" value="${state.pitch}">
        </label>
        <label>
          <span class="line"><span>chaos</span><span id="chaosText"></span></span>
          <input id="chaos" type="range" min="0" max="1" step="0.01" value="${state.chaos}">
        </label>
      </div>
      <div>
        <div class="readout"><span id="cycleText">cycle --</span><span>every other cycle</span></div>
        <div id="grid" class="grid"></div>
      </div>
    </div>
  `;

  const toggle = ctx.domRoot.querySelector('#toggle');
  const chanceSlider = ctx.domRoot.querySelector('#chance');
  const volumeSlider = ctx.domRoot.querySelector('#volume');
  const pitchSlider = ctx.domRoot.querySelector('#pitch');
  const chaosSlider = ctx.domRoot.querySelector('#chaos');
  const chanceText = ctx.domRoot.querySelector('#chanceText');
  const volumeText = ctx.domRoot.querySelector('#volumeText');
  const pitchText = ctx.domRoot.querySelector('#pitchText');
  const chaosText = ctx.domRoot.querySelector('#chaosText');
  const cycleText = ctx.domRoot.querySelector('#cycleText');
  const grid = ctx.domRoot.querySelector('#grid');

  const stepEls = Array.from({ length: 16 }, (_, index) => {
    const el = document.createElement('span');
    el.className = `step${offbeats.has(index) ? ' offbeat' : ''}`;
    grid.appendChild(el);
    return el;
  });

  const output = audio.createGain();
  const limiter = audio.createDynamicsCompressor();
  output.gain.value = state.enabled ? state.volume : 0;
  limiter.threshold.value = -16;
  limiter.knee.value = 12;
  limiter.ratio.value = 8;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.08;
  output.connect(limiter);
  limiter.connect(ctx.audioOut);

  const remember = (...nodes) => nodes.forEach((node) => activeNodes.add(node));
  const forgetLater = (seconds, ...nodes) => {
    const timer = setTimeout(() => {
      cleanupTimers.delete(timer);
      nodes.forEach((node) => {
        try { node.disconnect(); } catch (_) {}
        activeNodes.delete(node);
      });
    }, Math.max(120, seconds * 1000 + 180));
    cleanupTimers.add(timer);
  };

  const makeNoiseBuffer = () => {
    const length = Math.max(1, Math.floor(audio.sampleRate * 0.11));
    const buffer = audio.createBuffer(1, length, audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    }
    return buffer;
  };

  const planCycle = (cycle) => {
    currentHitPlan = new Set();
    if (cycle % 2 === 0) return;
    offbeats.forEach((step) => {
      if (Math.random() < state.chance) currentHitPlan.add(step);
    });
    if (currentHitPlan.size === 0 && Math.random() < 0.45 + state.chance * 0.4) {
      const choices = Array.from(offbeats);
      currentHitPlan.add(choices[Math.floor(Math.random() * choices.length)]);
    }
  };

  const triggerLaser = (time, step) => {
    const t = Math.max(time, now() + 0.004);
    const sweep = 0.11 + Math.random() * (0.07 + state.chaos * 0.1);
    const base = 320 + state.pitch * 920 + Math.random() * state.chaos * 520;
    const drop = 0.18 + Math.random() * 0.22;

    const osc = audio.createOscillator();
    const zap = audio.createOscillator();
    const noise = audio.createBufferSource();
    const amp = audio.createGain();
    const zapAmp = audio.createGain();
    const noiseAmp = audio.createGain();
    const filter = audio.createBiquadFilter();
    const pan = audio.createStereoPanner();

    osc.type = 'sawtooth';
    zap.type = 'square';
    noise.buffer = makeNoiseBuffer();
    filter.type = 'bandpass';
    filter.Q.value = 8 + state.chaos * 12;
    pan.pan.value = clamp((step - 8) / 8 + (Math.random() - 0.5) * state.chaos, -0.85, 0.85);

    osc.frequency.setValueAtTime(base * (1.6 + state.chaos), t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(52, base * drop), t + sweep);
    zap.frequency.setValueAtTime(base * 2.01, t);
    zap.frequency.exponentialRampToValueAtTime(Math.max(80, base * 0.31), t + sweep * 0.72);
    filter.frequency.setValueAtTime(base * 2.2, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(180, base * 0.55), t + sweep);

    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(0.62, t + 0.006);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + sweep);
    zapAmp.gain.setValueAtTime(0.0001, t);
    zapAmp.gain.exponentialRampToValueAtTime(0.22 + state.chaos * 0.16, t + 0.004);
    zapAmp.gain.exponentialRampToValueAtTime(0.0001, t + sweep * 0.82);
    noiseAmp.gain.setValueAtTime(0.0001, t);
    noiseAmp.gain.exponentialRampToValueAtTime(0.12 + state.chaos * 0.18, t + 0.003);
    noiseAmp.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);

    osc.connect(amp);
    zap.connect(zapAmp);
    noise.connect(noiseAmp);
    amp.connect(filter);
    zapAmp.connect(filter);
    noiseAmp.connect(filter);
    filter.connect(pan);
    pan.connect(output);

    osc.start(t);
    zap.start(t);
    noise.start(t);
    osc.stop(t + sweep + 0.04);
    zap.stop(t + sweep + 0.04);
    noise.stop(t + 0.12);
    remember(osc, zap, noise, amp, zapAmp, noiseAmp, filter, pan);
    forgetLater(sweep + 0.12, osc, zap, noise, amp, zapAmp, noiseAmp, filter, pan);
  };

  const render = () => {
    chanceText.textContent = state.chance.toFixed(2);
    volumeText.textContent = state.volume.toFixed(2);
    pitchText.textContent = state.pitch.toFixed(2);
    chaosText.textContent = state.chaos.toFixed(2);
    toggle.textContent = state.enabled ? 'ON' : 'OFF';
    toggle.setAttribute('aria-pressed', String(state.enabled));
    output.gain.setTargetAtTime(state.enabled ? state.volume : 0, now(), 0.02);
  };

  const renderSteps = (step, cycle) => {
    cycleText.textContent = `cycle ${cycle % 2 === 1 ? 'armed' : 'rest'}`;
    stepEls.forEach((el, index) => {
      el.classList.toggle('planned', currentHitPlan.has(index));
      el.classList.toggle('active', index === step && currentHitPlan.has(index));
    });
  };

  const onToggle = () => {
    state.enabled = !state.enabled;
    render();
  };
  const onChance = () => {
    state.chance = Number(chanceSlider.value);
    render();
  };
  const onVolume = () => {
    state.volume = Number(volumeSlider.value);
    render();
  };
  const onPitch = () => {
    state.pitch = Number(pitchSlider.value);
    render();
  };
  const onChaos = () => {
    state.chaos = Number(chaosSlider.value);
    render();
  };

  toggle.addEventListener('click', onToggle);
  chanceSlider.addEventListener('input', onChance);
  volumeSlider.addEventListener('input', onVolume);
  pitchSlider.addEventListener('input', onPitch);
  chaosSlider.addEventListener('input', onChaos);

  const unsubscribeTick = ctx.clock.onTick(({ step, time }) => {
    if (step === lastStep) return;
    lastStep = step;
    const localStep = ((step % 16) + 16) % 16;
    const cycle = Math.floor(step / 16);
    if (cycle !== lastCycle) {
      lastCycle = cycle;
      planCycle(cycle);
    }
    if (state.enabled && currentHitPlan.has(localStep)) triggerLaser(time, localStep);
    renderSteps(localStep, cycle);
  });

  render();
  planCycle(0);
  renderSteps(0, 0);

  return {
    update() {},
    getState() {
      return { ...state };
    },
    destroy() {
      toggle.removeEventListener('click', onToggle);
      chanceSlider.removeEventListener('input', onChance);
      volumeSlider.removeEventListener('input', onVolume);
      pitchSlider.removeEventListener('input', onPitch);
      chaosSlider.removeEventListener('input', onChaos);
      unsubscribeTick();
      cleanupTimers.forEach((timer) => clearTimeout(timer));
      cleanupTimers.clear();
      activeNodes.forEach((node) => {
        try { if (typeof node.stop === 'function') node.stop(); } catch (_) {}
        try { if (typeof node.disconnect === 'function') node.disconnect(); } catch (_) {}
      });
      activeNodes.clear();
      try {
        output.disconnect();
        limiter.disconnect();
      } catch (_) {}
    }
  };
}
