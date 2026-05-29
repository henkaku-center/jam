const STATE_VERSION = 'beatbox-v1';
const HIT_EVENT = 'beatbox:hit';

export default function setup(ctx, prevState) {
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
  const pitchHz = (value) => Math.min(20000, value * 4);

  const state = {
    stateVersion: STATE_VERSION,
    running: prevState?.running ?? true,
    volume: finite(prevState?.volume, 0.76),
    tone: finite(prevState?.tone, 0.54),
    breath: finite(prevState?.breath, 0.62),
    human: finite(prevState?.human, 0.38),
    pattern: Number.isInteger(prevState?.pattern) ? clamp(prevState.pattern, 0, 2) : 0
  };

  const audio = ctx.audioCtx;
  const master = audio.createGain();
  const dry = audio.createGain();
  const room = audio.createDelay(0.7);
  const roomTone = audio.createBiquadFilter();
  const roomFeedback = audio.createGain();
  const roomWet = audio.createGain();
  const compressor = audio.createDynamicsCompressor();

  master.gain.value = state.running ? state.volume : 0;
  dry.gain.value = 0.9;
  room.delayTime.value = 0.115;
  roomTone.type = 'bandpass';
  roomTone.frequency.value = pitchHz(1550);
  roomTone.Q.value = 0.8;
  roomFeedback.gain.value = 0.18;
  roomWet.gain.value = 0.18;
  compressor.threshold.value = -18;
  compressor.knee.value = 18;
  compressor.ratio.value = 3.2;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.13;

  dry.connect(master);
  dry.connect(room);
  room.connect(roomTone);
  roomTone.connect(roomFeedback);
  roomFeedback.connect(room);
  roomTone.connect(roomWet);
  roomWet.connect(master);
  master.connect(compressor);
  compressor.connect(ctx.audioOut);

  const liveNodes = new Set();
  const cleanupTimers = new Set();
  let destroyed = false;
  let currentStep = -1;
  let pulse = 0;
  let clockStepSeconds = 0.125;

  const patterns = [
    {
      name: 'pocket',
      kick: [1, 0, 0, 0.2, 0.82, 0, 0.28, 0, 1, 0, 0.18, 0, 0.68, 0, 0.34, 0],
      snare: [0, 0, 0.14, 0, 0.82, 0, 0.08, 0, 0, 0.12, 0.18, 0, 0.92, 0, 0.2, 0],
      hat: [0.32, 0.52, 0.28, 0.46, 0.36, 0.58, 0.3, 0.5, 0.34, 0.54, 0.3, 0.48, 0.38, 0.62, 0.32, 0.5],
      click: [0, 0.2, 0, 0, 0, 0, 0.24, 0, 0, 0, 0, 0.18, 0, 0, 0.3, 0]
    },
    {
      name: 'busker',
      kick: [1, 0, 0.32, 0, 0.74, 0, 0, 0.24, 0.92, 0, 0.38, 0, 0, 0.68, 0, 0.28],
      snare: [0, 0.12, 0, 0, 0.88, 0.18, 0, 0.24, 0, 0, 0.12, 0, 0.9, 0, 0.22, 0.32],
      hat: [0.24, 0.5, 0.42, 0.3, 0.3, 0.58, 0.46, 0.34, 0.26, 0.54, 0.44, 0.32, 0.34, 0.64, 0.5, 0.38],
      click: [0, 0, 0.22, 0, 0, 0.22, 0, 0, 0.18, 0, 0, 0.26, 0, 0.2, 0, 0.34]
    },
    {
      name: 'doubletime',
      kick: [0.92, 0, 0.2, 0.26, 0, 0.68, 0, 0.18, 0.9, 0, 0.28, 0, 0, 0.72, 0.35, 0],
      snare: [0, 0.1, 0, 0.28, 0.88, 0, 0.2, 0, 0, 0.16, 0, 0.34, 0.9, 0.2, 0.28, 0.42],
      hat: [0.42, 0.36, 0.5, 0.34, 0.46, 0.4, 0.56, 0.36, 0.44, 0.38, 0.52, 0.34, 0.48, 0.42, 0.64, 0.46],
      click: [0, 0.24, 0, 0, 0.18, 0, 0.24, 0, 0, 0.22, 0, 0, 0.16, 0, 0.32, 0]
    }
  ];

  const randomFor = (step, salt) => {
    const raw = Math.sin((step + 1) * 121.13 + salt * 89.41) * 43758.5453;
    return raw - Math.floor(raw);
  };

  const makeNoiseBuffer = () => {
    const buffer = audio.createBuffer(1, Math.floor(audio.sampleRate * 0.7), audio.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i += 1) {
      const white = Math.random() * 2 - 1;
      last = last * 0.28 + white * 0.72;
      data[i] = last;
    }
    return buffer;
  };

  const noiseBuffer = makeNoiseBuffer();

  const track = (seconds, ...nodes) => {
    nodes.forEach((node) => liveNodes.add(node));
    const timer = setTimeout(() => {
      cleanupTimers.delete(timer);
      nodes.forEach((node) => {
        try { if (typeof node.disconnect === 'function') node.disconnect(); } catch (_) {}
        liveNodes.delete(node);
      });
    }, Math.max(120, seconds * 1000 + 180));
    cleanupTimers.add(timer);
  };

  const humanize = (step, salt, amount = 1) => {
    const spread = state.human * amount * 0.018;
    return (randomFor(step, salt) - 0.5) * spread;
  };

  const publishHit = (voice, time, velocity) => {
    ctx.bus.pub(HIT_EVENT, {
      voice,
      time,
      velocity: clamp(Number(velocity) || 0, 0, 1.2),
      step: currentStep,
      pattern: state.pattern
    });
  };

  const playKick = (time, velocity) => {
    const t = Math.max(time, audio.currentTime + 0.001);
    const length = 0.19 + state.breath * 0.12;
    const throat = audio.createOscillator();
    const pop = audio.createOscillator();
    const body = audio.createBiquadFilter();
    const mouth = audio.createBiquadFilter();
    const gain = audio.createGain();
    const popGain = audio.createGain();

    throat.type = 'sine';
    throat.frequency.setValueAtTime(pitchHz(118 + state.tone * 34), t);
    throat.frequency.exponentialRampToValueAtTime(pitchHz(45 + state.tone * 9), t + length);
    pop.type = 'triangle';
    pop.frequency.setValueAtTime(pitchHz(310 + state.tone * 190), t);
    pop.frequency.exponentialRampToValueAtTime(pitchHz(82), t + 0.035);
    body.type = 'lowpass';
    body.frequency.setValueAtTime(pitchHz(360 + state.tone * 360), t);
    body.Q.setValueAtTime(1.8 + state.breath * 1.2, t);
    mouth.type = 'peaking';
    mouth.frequency.setValueAtTime(pitchHz(145 + state.tone * 90), t);
    mouth.Q.setValueAtTime(4.5, t);
    mouth.gain.setValueAtTime(8, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.68 * velocity, t + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    popGain.gain.setValueAtTime(0.14 * velocity, t);
    popGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.038);

    throat.connect(body);
    body.connect(mouth);
    mouth.connect(gain);
    pop.connect(popGain);
    popGain.connect(dry);
    gain.connect(dry);
    throat.start(t);
    pop.start(t);
    throat.stop(t + length + 0.04);
    pop.stop(t + 0.05);
    track(length + 0.08, throat, pop, body, mouth, gain, popGain);
    publishHit('kick', t, velocity);
  };

  const playSnare = (time, velocity) => {
    const t = Math.max(time, audio.currentTime + 0.001);
    const length = 0.095 + state.breath * 0.13;
    const noise = audio.createBufferSource();
    const hiss = audio.createBiquadFilter();
    const nasal = audio.createBiquadFilter();
    const gain = audio.createGain();
    const body = audio.createOscillator();
    const bodyGain = audio.createGain();

    noise.buffer = noiseBuffer;
    hiss.type = 'bandpass';
    hiss.frequency.setValueAtTime(pitchHz(1550 + state.tone * 1900), t);
    hiss.Q.setValueAtTime(0.8 + state.breath * 1.1, t);
    nasal.type = 'peaking';
    nasal.frequency.setValueAtTime(pitchHz(870 + state.tone * 580), t);
    nasal.Q.setValueAtTime(6, t);
    nasal.gain.setValueAtTime(5 + state.breath * 3, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime((0.28 + state.breath * 0.18) * velocity, t + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    body.type = 'triangle';
    body.frequency.setValueAtTime(pitchHz(210 + state.tone * 42), t);
    body.frequency.exponentialRampToValueAtTime(pitchHz(150), t + 0.06);
    bodyGain.gain.setValueAtTime(0.08 * velocity, t);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);

    noise.connect(hiss);
    hiss.connect(nasal);
    nasal.connect(gain);
    gain.connect(dry);
    gain.connect(room);
    body.connect(bodyGain);
    bodyGain.connect(dry);
    noise.start(t, 0, length + 0.02);
    body.start(t);
    body.stop(t + 0.13);
    track(length + 0.08, noise, hiss, nasal, gain, body, bodyGain);
    publishHit('snare', t, velocity);
  };

  const playHat = (time, velocity, open = false) => {
    const t = Math.max(time, audio.currentTime + 0.001);
    const length = open ? 0.18 + state.breath * 0.12 : 0.035 + state.breath * 0.035;
    const noise = audio.createBufferSource();
    const high = audio.createBiquadFilter();
    const teeth = audio.createBiquadFilter();
    const gain = audio.createGain();
    const panner = typeof audio.createStereoPanner === 'function' ? audio.createStereoPanner() : null;

    noise.buffer = noiseBuffer;
    high.type = 'highpass';
    high.frequency.setValueAtTime(pitchHz(open ? 4200 + state.tone * 1700 : 6200 + state.tone * 2200), t);
    high.Q.setValueAtTime(open ? 0.55 : 1.2, t);
    teeth.type = 'bandpass';
    teeth.frequency.setValueAtTime(pitchHz(7600 + state.tone * 2200), t);
    teeth.Q.setValueAtTime(open ? 0.8 : 1.8, t);
    gain.gain.setValueAtTime((open ? 0.12 : 0.07) * velocity, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    if (panner) panner.pan.setValueAtTime(open ? 0.3 : -0.24 + randomFor(currentStep, 5) * 0.48, t);

    noise.connect(high);
    high.connect(teeth);
    teeth.connect(gain);
    if (panner) {
      gain.connect(panner);
      panner.connect(dry);
    } else {
      gain.connect(dry);
    }
    noise.start(t, 0, length + 0.02);
    track(length + 0.08, noise, high, teeth, gain, ...(panner ? [panner] : []));
    publishHit(open ? 'open-hat' : 'hat', t, velocity);
  };

  const playClick = (time, velocity) => {
    const t = Math.max(time, audio.currentTime + 0.001);
    const click = audio.createOscillator();
    const clickFilter = audio.createBiquadFilter();
    const gain = audio.createGain();
    const panner = typeof audio.createStereoPanner === 'function' ? audio.createStereoPanner() : null;

    click.type = 'square';
    click.frequency.setValueAtTime(pitchHz(1180 + state.tone * 1040 + randomFor(currentStep, 9) * 240), t);
    click.frequency.exponentialRampToValueAtTime(pitchHz(640 + state.tone * 260), t + 0.032);
    clickFilter.type = 'bandpass';
    clickFilter.frequency.setValueAtTime(pitchHz(1150 + state.tone * 1200), t);
    clickFilter.Q.setValueAtTime(9, t);
    gain.gain.setValueAtTime(0.07 * velocity, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.052);
    if (panner) panner.pan.setValueAtTime(-0.45 + randomFor(currentStep, 11) * 0.9, t);

    click.connect(clickFilter);
    clickFilter.connect(gain);
    if (panner) {
      gain.connect(panner);
      panner.connect(dry);
      panner.connect(room);
    } else {
      gain.connect(dry);
      gain.connect(room);
    }
    click.start(t);
    click.stop(t + 0.065);
    track(0.12, click, clickFilter, gain, ...(panner ? [panner] : []));
    publishHit('click', t, velocity);
  };

  const playStep = ({ step, time, duration }) => {
    if (Number.isFinite(duration) && duration > 0) clockStepSeconds = duration;
    currentStep = ((step % 16) + 16) % 16;
    render();
    if (!state.running) return;

    const pattern = patterns[state.pattern] || patterns[0];
    const stepSeconds = clamp(duration || clockStepSeconds, 0.055, 0.35);
    const swing = currentStep % 2 ? stepSeconds * (0.035 + state.human * 0.12) : 0;
    const at = time + swing;
    const accent = currentStep % 4 === 0 ? 1.08 : currentStep % 2 === 0 ? 0.9 : 0.78;

    const kick = pattern.kick[currentStep];
    if (kick) playKick(at + humanize(step, 1), clamp(kick * accent, 0.04, 1.1));

    const snare = pattern.snare[currentStep];
    if (snare) playSnare(at + humanize(step, 2), clamp(snare * (0.9 + state.breath * 0.22), 0.04, 1.05));

    const hat = pattern.hat[currentStep];
    if (hat) playHat(at + humanize(step, 3, 0.7), clamp(hat * (0.75 + state.tone * 0.24), 0.04, 0.92), [3, 7, 11, 15].includes(currentStep) && state.breath > 0.48);

    const click = pattern.click[currentStep];
    if (click) playClick(at + stepSeconds * (0.22 + state.human * 0.18) + humanize(step, 4), clamp(click * (0.85 + state.tone * 0.32), 0.04, 0.82));

    if (state.human > 0.64 && [6, 14].includes(currentStep)) {
      playHat(at + stepSeconds * 0.48 + humanize(step, 7), 0.24 + state.breath * 0.18, false);
    }

    room.delayTime.setTargetAtTime(stepSeconds * (0.78 + state.breath * 0.62), audio.currentTime, 0.03);
    roomTone.frequency.setTargetAtTime(pitchHz(1050 + state.tone * 2500), audio.currentTime, 0.04);
    roomWet.gain.setTargetAtTime(0.1 + state.breath * 0.18, audio.currentTime, 0.05);
    pulse = Math.max(pulse, 0.72);
    render();
  };

  ctx.domRoot.innerHTML = `
    <style>
      :host { display: block; height: 100%; }
      .root {
        box-sizing: border-box;
        height: 100%;
        min-width: 300px;
        min-height: 220px;
        padding: 10px;
        display: grid;
        grid-template-rows: auto auto 1fr auto;
        gap: 9px;
        overflow: hidden;
        color: #eff6ff;
        background:
          linear-gradient(135deg, #111315, #1c1b18 52%, #101923),
          repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.04) 0 1px, transparent 1px 18px);
        border: 1px solid rgba(251, 191, 36, 0.5);
        border-radius: 8px;
        font: 11px/1.25 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }
      .top {
        min-width: 0;
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: 8px;
      }
      h1 {
        margin: 0;
        color: #fde68a;
        font: 700 14px/1 ui-sans-serif, system-ui, sans-serif;
        letter-spacing: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .sub {
        margin-top: 3px;
        color: #a7b1bd;
        font-size: 10px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      button,
      input {
        font: inherit;
      }
      button {
        height: 28px;
        border: 1px solid rgba(253, 230, 138, 0.58);
        border-radius: 5px;
        color: #1f1604;
        background: #fbbf24;
        cursor: pointer;
      }
      button.off {
        color: #cbd5e1;
        background: #18202a;
        border-color: #475569;
      }
      .pattern {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 5px;
      }
      .pattern button {
        width: 100%;
        min-width: 0;
        padding: 0 6px;
        color: #dbeafe;
        background: #17202a;
        border-color: #405064;
      }
      .pattern button.active {
        color: #1f1604;
        background: #f59e0b;
        border-color: #fde68a;
      }
      .body {
        min-height: 76px;
        display: grid;
        grid-template-rows: repeat(4, 1fr);
        gap: 4px;
      }
      .row {
        min-width: 0;
        display: grid;
        grid-template-columns: 38px repeat(16, minmax(0, 1fr));
        align-items: stretch;
        gap: 3px;
      }
      .voice {
        display: grid;
        align-items: center;
        color: #cbd5e1;
        font-size: 10px;
      }
      .cell {
        min-width: 0;
        border: 1px solid #344255;
        background: #121923;
        border-radius: 3px;
        opacity: 0.46;
      }
      .cell.hit {
        opacity: 1;
        background: #64748b;
      }
      .row.kick .cell.hit { background: #f97316; }
      .row.snare .cell.hit { background: #38bdf8; }
      .row.hat .cell.hit { background: #fde047; }
      .row.click .cell.hit { background: #a78bfa; }
      .cell.now {
        outline: 2px solid #f8fafc;
        outline-offset: -2px;
        transform: translateY(-1px);
      }
      .controls {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 6px 10px;
      }
      label {
        min-width: 0;
        display: grid;
        grid-template-columns: 48px minmax(0, 1fr) 34px;
        align-items: center;
        gap: 6px;
        color: #d4dde8;
      }
      input[type="range"] {
        width: 100%;
        min-width: 0;
        accent-color: #f59e0b;
      }
      .meter {
        height: 9px;
        overflow: hidden;
        border: 1px solid #4b5563;
        background: #0b1118;
        border-radius: 3px;
      }
      .meter span {
        display: block;
        width: 0%;
        height: 100%;
        background: linear-gradient(90deg, #f97316, #facc15, #38bdf8);
      }
    </style>
    <div class="root">
      <div class="top">
        <div>
          <h1>Beatbox</h1>
          <div class="sub">vocal kick, psh snare, tss hats, mouth clicks</div>
        </div>
        <button id="run" type="button"></button>
      </div>
      <div class="pattern" id="patterns"></div>
      <div class="body" id="grid"></div>
      <div class="controls">
        <label>vol <input id="volume" type="range" min="0" max="1.1" step="0.01"><span id="volumeVal"></span></label>
        <label>tone <input id="tone" type="range" min="0" max="1" step="0.01"><span id="toneVal"></span></label>
        <label>air <input id="breath" type="range" min="0" max="1" step="0.01"><span id="breathVal"></span></label>
        <label>loose <input id="human" type="range" min="0" max="1" step="0.01"><span id="humanVal"></span></label>
      </div>
      <div class="meter"><span id="meter"></span></div>
    </div>
  `;

  const $ = (selector) => ctx.domRoot.querySelector(selector);
  const runButton = $('#run');
  const patternEl = $('#patterns');
  const gridEl = $('#grid');
  const meterEl = $('#meter');
  const sliders = {
    volume: $('#volume'),
    tone: $('#tone'),
    breath: $('#breath'),
    human: $('#human')
  };
  const valueEls = {
    volume: $('#volumeVal'),
    tone: $('#toneVal'),
    breath: $('#breathVal'),
    human: $('#humanVal')
  };

  const patternButtons = patterns.map((pattern, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = pattern.name;
    button.addEventListener('click', () => {
      state.pattern = index;
      render();
    });
    patternEl.appendChild(button);
    return button;
  });

  const voices = [
    ['kick', 'bt'],
    ['snare', 'psh'],
    ['hat', 'tss'],
    ['click', 'clk']
  ];
  const cells = {};
  voices.forEach(([voice, label]) => {
    const row = document.createElement('div');
    row.className = `row ${voice}`;
    const voiceEl = document.createElement('div');
    voiceEl.className = 'voice';
    voiceEl.textContent = label;
    row.appendChild(voiceEl);
    cells[voice] = [];
    for (let i = 0; i < 16; i += 1) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      row.appendChild(cell);
      cells[voice].push(cell);
    }
    gridEl.appendChild(row);
  });

  const setMasterGain = () => {
    master.gain.setTargetAtTime(state.running ? state.volume : 0, audio.currentTime, 0.025);
  };

  function render() {
    runButton.textContent = state.running ? 'stop' : 'play';
    runButton.classList.toggle('off', !state.running);
    patternButtons.forEach((button, index) => button.classList.toggle('active', index === state.pattern));
    Object.entries(sliders).forEach(([key, input]) => {
      if (input.value !== String(state[key])) input.value = String(state[key]);
      valueEls[key].textContent = Number(state[key]).toFixed(2);
    });

    const pattern = patterns[state.pattern] || patterns[0];
    voices.forEach(([voice]) => {
      for (let i = 0; i < 16; i += 1) {
        const active = Boolean(pattern[voice][i]);
        cells[voice][i].classList.toggle('hit', active);
        cells[voice][i].classList.toggle('now', i === currentStep);
      }
    });
    pulse *= 0.78;
    meterEl.style.width = `${clamp(pulse, 0, 1) * 100}%`;
  }

  const onRun = () => {
    state.running = !state.running;
    setMasterGain();
    render();
  };
  const onSlider = (key) => () => {
    state[key] = Number(sliders[key].value);
    if (key === 'volume') setMasterGain();
    render();
  };
  const sliderHandlers = Object.fromEntries(Object.keys(sliders).map((key) => [key, onSlider(key)]));

  runButton.addEventListener('click', onRun);
  Object.entries(sliderHandlers).forEach(([key, handler]) => sliders[key].addEventListener('input', handler));
  const unsubscribeClock = ctx.clock.onTick(playStep);
  const uiTimer = setInterval(render, 80);
  render();

  return {
    update() {},
    getState() {
      return { ...state };
    },
    destroy() {
      destroyed = true;
      clearInterval(uiTimer);
      unsubscribeClock();
      runButton.removeEventListener('click', onRun);
      patternButtons.forEach((button) => {
        button.replaceWith(button.cloneNode(true));
      });
      Object.entries(sliderHandlers).forEach(([key, handler]) => sliders[key].removeEventListener('input', handler));
      cleanupTimers.forEach((timer) => clearTimeout(timer));
      cleanupTimers.clear();
      for (const node of liveNodes) {
        try { if (typeof node.stop === 'function') node.stop(); } catch (_) {}
        try { if (typeof node.disconnect === 'function') node.disconnect(); } catch (_) {}
      }
      liveNodes.clear();
      try {
        master.disconnect();
        dry.disconnect();
        room.disconnect();
        roomTone.disconnect();
        roomFeedback.disconnect();
        roomWet.disconnect();
        compressor.disconnect();
      } catch (_) {}
    }
  };
}
