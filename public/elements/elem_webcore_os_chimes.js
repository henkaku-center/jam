const PRESETS = [
  {
    id: 'glass-boot',
    label: 'glass boot',
    color: '#39d5ff',
    notes: [523.25, 659.25, 783.99, 1046.5],
    type: 'sine',
    duration: 1.35
  },
  {
    id: 'platinum-bong',
    label: 'platinum bong',
    color: '#9ca3af',
    notes: [196, 392, 493.88],
    type: 'triangle',
    duration: 1.8
  },
  {
    id: 'aqua-login',
    label: 'aqua login',
    color: '#8b5cf6',
    notes: [440, 554.37, 659.25, 880],
    type: 'sine',
    duration: 1.15
  },
  {
    id: 'alert-box',
    label: 'alert box',
    color: '#fb7185',
    notes: [880, 740, 554],
    type: 'square',
    duration: 0.55
  },
  {
    id: 'menu-pop',
    label: 'menu pop',
    color: '#facc15',
    notes: [1174.66, 1567.98],
    type: 'triangle',
    duration: 0.24
  },
  {
    id: 'disk-wake',
    label: 'disk wake',
    color: '#34d399',
    notes: [130.81, 261.63, 329.63, 523.25],
    type: 'sawtooth',
    duration: 0.9
  }
];

export default function setup(ctx, prevState) {
  const dom = ctx.domRoot;
  const audio = ctx.audioCtx;
  const state = {
    enabled: prevState?.enabled ?? true,
    volume: Number.isFinite(prevState?.volume) ? prevState.volume : 0.45,
    density: Number.isFinite(prevState?.density) ? prevState.density : 0.34,
    mode: prevState?.mode || 'shuffle',
    lastPreset: prevState?.lastPreset || 'booting...'
  };

  const master = audio.createGain();
  const compressor = audio.createDynamicsCompressor();
  master.gain.value = state.volume;
  compressor.threshold.value = -20;
  compressor.knee.value = 18;
  compressor.ratio.value = 5;
  compressor.attack.value = 0.004;
  compressor.release.value = 0.18;
  master.connect(compressor);
  compressor.connect(ctx.audioOut);

  let flashUntil = 0;
  let lastStep = -1;

  dom.innerHTML = `
    <style>
      :host {
        display: block;
        width: 100%;
        height: 100%;
      }
      .webcore {
        box-sizing: border-box;
        height: 100%;
        min-height: 210px;
        padding: 12px;
        overflow: hidden;
        color: #ecfeff;
        background:
          linear-gradient(180deg, rgba(255,255,255,0.15), transparent 42%),
          radial-gradient(circle at 18% 10%, rgba(57,213,255,0.34), transparent 34%),
          radial-gradient(circle at 84% 88%, rgba(250,204,21,0.2), transparent 36%),
          #0b1117;
        border: 1px solid rgba(148, 163, 184, 0.55);
        border-radius: 8px;
        font: 12px/1.3 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.28);
      }
      .top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        min-width: 0;
      }
      h2 {
        margin: 0;
        font-size: 14px;
        letter-spacing: 0;
        color: #ffffff;
        text-shadow: 0 1px 10px rgba(57,213,255,0.55);
      }
      button {
        width: 34px;
        height: 28px;
        border: 1px solid rgba(236, 254, 255, 0.62);
        border-radius: 6px;
        color: #071014;
        background: linear-gradient(#ffffff, #8ee7ff 48%, #2dd4bf);
        font: 700 12px/1 ui-monospace, monospace;
        cursor: pointer;
        box-shadow: inset 0 1px 0 rgba(255,255,255,0.95), 0 5px 15px rgba(45,212,191,0.2);
      }
      button[aria-pressed="false"] {
        color: #dbeafe;
        background: linear-gradient(#334155, #111827);
      }
      .screen {
        position: relative;
        display: grid;
        place-items: center;
        height: 66px;
        margin: 12px 0;
        border: 1px solid rgba(125, 211, 252, 0.45);
        border-radius: 7px;
        background:
          repeating-linear-gradient(0deg, rgba(255,255,255,0.05) 0 1px, transparent 1px 4px),
          linear-gradient(135deg, rgba(15,23,42,0.78), rgba(8,47,73,0.74));
        overflow: hidden;
      }
      .screen::before {
        content: "";
        position: absolute;
        inset: -38%;
        background: conic-gradient(from 90deg, transparent, var(--accent, #39d5ff), transparent 28%);
        opacity: var(--pulse, 0.22);
        transform: rotate(var(--spin, 0deg));
      }
      .badge {
        position: relative;
        z-index: 1;
        display: grid;
        gap: 3px;
        text-align: center;
      }
      .name {
        font-size: 16px;
        font-weight: 700;
        color: var(--accent, #39d5ff);
      }
      .sub {
        color: #cbd5e1;
        font-size: 10px;
      }
      .controls {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 9px;
      }
      label {
        display: grid;
        gap: 5px;
        min-width: 0;
        color: #bae6fd;
        font-size: 10px;
        text-transform: uppercase;
      }
      input,
      select {
        width: 100%;
        box-sizing: border-box;
        min-width: 0;
        color: #f8fafc;
        background: rgba(15, 23, 42, 0.82);
        border: 1px solid rgba(125, 211, 252, 0.52);
        border-radius: 5px;
        font: 11px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }
      input {
        accent-color: #22d3ee;
      }
      select {
        height: 25px;
        padding: 2px 5px;
      }
      .ticker {
        display: grid;
        grid-template-columns: repeat(16, minmax(0, 1fr));
        gap: 3px;
        margin-top: 10px;
      }
      .tick {
        height: 13px;
        border-radius: 3px;
        background: rgba(148, 163, 184, 0.28);
      }
      .tick.hot {
        background: var(--accent, #39d5ff);
        box-shadow: 0 0 12px var(--accent, #39d5ff);
      }
    </style>
    <div class="webcore">
      <div class="top">
        <h2>webcore OS chimes</h2>
        <button id="toggle" type="button" title="toggle random chimes" aria-pressed="${state.enabled}">${state.enabled ? 'ON' : 'OFF'}</button>
      </div>
      <div class="screen" id="screen">
        <div class="badge">
          <div class="name" id="name">${state.lastPreset}</div>
          <div class="sub" id="sub">random startup, alert, and UI tones</div>
        </div>
      </div>
      <div class="controls">
        <label>
          volume
          <input id="volume" type="range" min="0" max="1" step="0.01" value="${state.volume}">
        </label>
        <label>
          random
          <input id="density" type="range" min="0" max="1" step="0.01" value="${state.density}">
        </label>
        <label>
          flavor
          <select id="mode">
            <option value="shuffle" ${state.mode === 'shuffle' ? 'selected' : ''}>shuffle</option>
            <option value="boot" ${state.mode === 'boot' ? 'selected' : ''}>boot only</option>
            <option value="tiny" ${state.mode === 'tiny' ? 'selected' : ''}>tiny UI</option>
            <option value="alerts" ${state.mode === 'alerts' ? 'selected' : ''}>alerts</option>
          </select>
        </label>
        <label>
          last
          <select id="preset">
            ${PRESETS.map((preset) => `<option value="${preset.id}">${preset.label}</option>`).join('')}
          </select>
        </label>
      </div>
      <div class="ticker" id="ticker">
        ${Array.from({ length: 16 }, () => '<div class="tick"></div>').join('')}
      </div>
    </div>
  `;

  const root = dom.querySelector('.webcore');
  const screen = dom.querySelector('#screen');
  const nameEl = dom.querySelector('#name');
  const subEl = dom.querySelector('#sub');
  const toggle = dom.querySelector('#toggle');
  const volume = dom.querySelector('#volume');
  const density = dom.querySelector('#density');
  const mode = dom.querySelector('#mode');
  const presetSelect = dom.querySelector('#preset');
  const ticks = Array.from(dom.querySelectorAll('.tick'));

  const now = () => audio.currentTime;

  const setAccent = (preset) => {
    root.style.setProperty('--accent', preset.color);
    nameEl.textContent = preset.label;
    presetSelect.value = preset.id;
    state.lastPreset = preset.label;
    flashUntil = performance.now() + 420;
  };

  const makeNoiseBuffer = (duration) => {
    const size = Math.max(1, Math.floor(audio.sampleRate * duration));
    const buffer = audio.createBuffer(1, size, audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < size; i += 1) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  };

  const playTone = (frequency, start, duration, type, gainValue, panValue = 0) => {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    const filter = audio.createBiquadFilter();
    const panner = audio.createStereoPanner ? audio.createStereoPanner() : null;

    osc.type = type;
    osc.frequency.setValueAtTime(frequency, start);
    osc.frequency.exponentialRampToValueAtTime(frequency * 1.006, start + duration);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(5600, start);
    filter.Q.value = 0.7;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(gainValue, start + 0.018);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    osc.connect(filter);
    filter.connect(gain);
    if (panner) {
      panner.pan.setValueAtTime(panValue, start);
      gain.connect(panner);
      panner.connect(master);
    } else {
      gain.connect(master);
    }

    osc.start(start);
    osc.stop(start + duration + 0.04);
  };

  const playSparkle = (start, preset) => {
    const noise = audio.createBufferSource();
    const filter = audio.createBiquadFilter();
    const gain = audio.createGain();
    noise.buffer = makeNoiseBuffer(0.22);
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(preset.id === 'disk-wake' ? 1800 : 4200, start);
    filter.Q.value = 4.5;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.08, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.2);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    noise.start(start);
    noise.stop(start + 0.24);
  };

  const playPreset = (preset, when = now() + 0.02) => {
    const short = preset.duration < 0.7;
    const spread = short ? 0.055 : 0.14;
    const toneGain = short ? 0.16 : 0.11;
    preset.notes.forEach((frequency, index) => {
      const start = when + index * spread;
      const duration = short ? preset.duration : preset.duration - index * 0.12;
      const pan = preset.notes.length > 1 ? (index / (preset.notes.length - 1)) * 1.2 - 0.6 : 0;
      playTone(frequency, start, Math.max(0.12, duration), preset.type, toneGain, pan);
      if (!short && index % 2 === 0) {
        playTone(frequency * 2.01, start + 0.018, Math.max(0.18, duration * 0.52), 'sine', toneGain * 0.28, -pan);
      }
    });
    if (preset.id === 'alert-box') {
      playTone(220, when + 0.04, 0.4, 'triangle', 0.06, 0);
    } else {
      playSparkle(when + (short ? 0.03 : 0.12), preset);
    }
    setAccent(preset);
    ctx.bus.pub('webcore-chime', { id: preset.id, label: preset.label });
  };

  const choosePreset = () => {
    if (state.mode === 'boot') {
      return PRESETS[Math.floor(Math.random() * 3)];
    }
    if (state.mode === 'tiny') {
      return PRESETS[Math.random() < 0.62 ? 4 : 5];
    }
    if (state.mode === 'alerts') {
      return PRESETS[Math.random() < 0.72 ? 3 : 4];
    }
    return PRESETS[Math.floor(Math.random() * PRESETS.length)];
  };

  const renderSettings = () => {
    master.gain.setTargetAtTime(state.volume, now(), 0.02);
    toggle.textContent = state.enabled ? 'ON' : 'OFF';
    toggle.setAttribute('aria-pressed', String(state.enabled));
    subEl.textContent = state.enabled
      ? `density ${(state.density * 100).toFixed(0)}% / ${state.mode}`
      : 'muted randomizer';
  };

  const onToggle = () => {
    state.enabled = !state.enabled;
    renderSettings();
  };
  const onVolume = () => {
    state.volume = Number(volume.value);
    renderSettings();
  };
  const onDensity = () => {
    state.density = Number(density.value);
    renderSettings();
  };
  const onMode = () => {
    state.mode = mode.value;
    renderSettings();
  };
  const onPreset = () => {
    const preset = PRESETS.find((item) => item.id === presetSelect.value) || PRESETS[0];
    playPreset(preset);
  };

  toggle.addEventListener('click', onToggle);
  volume.addEventListener('input', onVolume);
  density.addEventListener('input', onDensity);
  mode.addEventListener('change', onMode);
  presetSelect.addEventListener('change', onPreset);

  const unsubscribeClock = ctx.clock.onTick(({ step, time }) => {
    const index = step % ticks.length;
    lastStep = index;
    if (!state.enabled) return;
    const isMainBeat = step % 4 === 0;
    const threshold = isMainBeat ? state.density : state.density * 0.22;
    if (Math.random() < threshold) {
      playPreset(choosePreset(), time);
    }
  });

  setAccent(PRESETS.find((preset) => preset.label === state.lastPreset) || PRESETS[0]);
  renderSettings();

  return {
    update() {
      const t = performance.now();
      const pulse = t < flashUntil ? 0.7 : 0.18 + Math.sin(t * 0.003) * 0.05;
      screen.style.setProperty('--pulse', pulse.toFixed(3));
      screen.style.setProperty('--spin', `${(t * 0.02) % 360}deg`);
      ticks.forEach((tick, index) => {
        tick.classList.toggle('hot', index === lastStep || (t < flashUntil && index % 4 === 0));
      });
    },
    getState() {
      return { ...state };
    },
    destroy() {
      toggle.removeEventListener('click', onToggle);
      volume.removeEventListener('input', onVolume);
      density.removeEventListener('input', onDensity);
      mode.removeEventListener('change', onMode);
      presetSelect.removeEventListener('change', onPreset);
      unsubscribeClock();
      master.disconnect();
      compressor.disconnect();
    }
  };
}
