const STATE_VERSION = 'yodel-vocal-loop-v3';

const FORMANTS = {
  oh: [
    [420, 1.0, 9],
    [820, 0.42, 8],
    [2580, 0.18, 7]
  ],
  eh: [
    [610, 0.9, 8],
    [1760, 0.38, 9],
    [2480, 0.16, 8]
  ],
  ay: [
    [760, 0.88, 7],
    [1420, 0.5, 8],
    [2620, 0.18, 8]
  ],
  ee: [
    [300, 0.82, 9],
    [2260, 0.6, 10],
    [3040, 0.22, 9]
  ],
  ah: [
    [730, 0.9, 8],
    [1180, 0.44, 7],
    [2580, 0.16, 7]
  ]
};

const PHRASE = [
  { step: 0, label: 'yo', vowel: 'oh', midi: [61, 68], length: 1.65, velocity: 0.88, pan: -0.16 },
  { step: 2, label: 'de', vowel: 'eh', midi: [64, 73], length: 1.15, velocity: 0.62, pan: 0.12 },
  { step: 4, label: 'lay', vowel: 'ay', midi: [66, 75, 70], length: 1.85, velocity: 0.82, pan: -0.08 },
  { step: 6, label: 'ee', vowel: 'ee', midi: [68, 80], length: 1.25, velocity: 0.56, pan: 0.2 },
  { step: 8, label: 'oh', vowel: 'oh', midi: [73, 68, 61], length: 1.95, velocity: 0.78, pan: 0.04 },
  { step: 10, label: 'lo', vowel: 'ah', midi: [59, 66], length: 1.2, velocity: 0.5, pan: -0.22 },
  { step: 12, label: 'hee', vowel: 'ee', midi: [64, 76, 80], length: 1.85, velocity: 0.76, pan: 0.18 },
  { step: 14, label: 'yo', vowel: 'oh', midi: [68, 61], length: 1.55, velocity: 0.68, pan: -0.1 }
];

export default function setup(ctx, prevState) {
  const audio = ctx.audioCtx;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
  const midiToFreq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

  const previousMatches = /^yodel-vocal-loop-v\d+$/.test(String(prevState?.stateVersion || ''));
  const state = {
    stateVersion: STATE_VERSION,
    enabled: previousMatches ? prevState.enabled !== false : true,
    volume: previousMatches ? finite(prevState.volume, 0.46) : 0.46,
    pitch: previousMatches ? finite(prevState.pitch, 0.5) : 0.5,
    brightness: previousMatches ? finite(prevState.brightness, 0.58) : 0.58,
    yodel: previousMatches ? finite(prevState.yodel, 0.78) : 0.78,
    shepard: previousMatches ? finite(prevState.shepard, 0.32) : 0.32,
    echo: previousMatches ? finite(prevState.echo, 0.28) : 0.28
  };

  let zefiroPitch = null;
  let currentStep = -1;
  let currentSyllable = 'ready';
  let pulse = 0;
  let stepSeconds = 0.125;
  let shepardRise = 0;
  let shepardLoudSince = null;
  let shepardCrashed = false;
  let raf = 0;
  let audioStateKey = '';
  const pitchNorm = () => clamp(zefiroPitch ?? state.pitch, 0, 1);
  const pitchSemitones = () => Math.round((pitchNorm() * 2 - 1) * 12);

  const liveNodes = new Set();
  const cleanupTimers = new Set();
  const output = audio.createGain();
  const highpass = audio.createBiquadFilter();
  const compressor = audio.createDynamicsCompressor();
  const delay = audio.createDelay(1);
  const feedback = audio.createGain();
  const delayTone = audio.createBiquadFilter();
  const wet = audio.createGain();

  output.gain.value = state.enabled ? state.volume : 0;
  highpass.type = 'highpass';
  highpass.frequency.value = 120;
  compressor.threshold.value = -22;
  compressor.knee.value = 18;
  compressor.ratio.value = 3.5;
  compressor.attack.value = 0.006;
  compressor.release.value = 0.16;
  delay.delayTime.value = 0.23;
  feedback.gain.value = 0.24;
  delayTone.type = 'lowpass';
  delayTone.frequency.value = 3100;
  wet.gain.value = state.echo;

  output.connect(highpass);
  highpass.connect(compressor);
  compressor.connect(ctx.audioOut);
  delay.connect(delayTone);
  delayTone.connect(feedback);
  feedback.connect(delay);
  delayTone.connect(wet);
  wet.connect(output);

  ctx.domRoot.innerHTML = `
    <style>
      .root {
        box-sizing: border-box;
        height: 100%;
        min-width: 260px;
        padding: 10px 12px;
        overflow: hidden;
        display: grid;
        grid-template-rows: auto auto 1fr;
        gap: 9px;
        color: #f7fee7;
        background:
          linear-gradient(135deg, rgba(15, 23, 42, 0.96), rgba(26, 31, 18, 0.96) 54%, rgba(7, 20, 19, 0.96)),
          repeating-linear-gradient(0deg, rgba(255, 255, 255, 0.04) 0 1px, transparent 1px 16px);
        border: 1px solid rgba(190, 242, 100, 0.42);
        border-radius: 8px;
        font: 11px/1.32 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }
      .top {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: 8px;
      }
      h1 {
        margin: 0;
        color: #d9f99d;
        font: 700 12px/1 ui-sans-serif, system-ui, sans-serif;
        letter-spacing: 0;
      }
      .sub {
        margin-top: 3px;
        color: #94a3b8;
        font-size: 10px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      button {
        height: 28px;
        min-width: 48px;
        padding: 0 9px;
        border: 1px solid rgba(190, 242, 100, 0.56);
        border-radius: 5px;
        color: #07140f;
        background: #bef264;
        font: inherit;
        cursor: pointer;
      }
      button.off {
        color: #cbd5e1;
        background: rgba(15, 23, 42, 0.78);
        border-color: rgba(148, 163, 184, 0.34);
      }
      .controls {
        display: grid;
        gap: 6px;
      }
      label {
        min-width: 0;
        display: grid;
        grid-template-columns: 70px minmax(0, 1fr) 34px;
        align-items: center;
        gap: 7px;
        color: #dbeafe;
      }
      input[type="range"] {
        width: 100%;
        min-width: 0;
        accent-color: #bef264;
      }
      .stage {
        min-height: 68px;
        border: 1px solid rgba(132, 204, 22, 0.34);
        background:
          radial-gradient(circle at calc(50% + var(--pan) * 18%) 44%, rgba(250, 204, 21, 0.48), transparent calc(23% + var(--pulse) * 15%)),
          linear-gradient(180deg, rgba(6, 15, 12, 0.62), rgba(2, 6, 23, 0.8));
        display: grid;
        grid-template-columns: 1fr auto;
        align-items: end;
        gap: 8px;
        padding: 9px;
        overflow: hidden;
      }
      .syllable {
        color: #fef9c3;
        font: 700 24px/0.95 ui-sans-serif, system-ui, sans-serif;
        letter-spacing: 0;
        transform: translateY(calc(var(--pulse) * -5px));
        text-shadow: 0 0 calc(5px + var(--pulse) * 16px) rgba(250, 204, 21, 0.72);
      }
      .steps {
        display: grid;
        grid-template-columns: repeat(16, 5px);
        gap: 3px;
        align-self: center;
      }
      .steps span {
        width: 5px;
        height: 24px;
        background: rgba(148, 163, 184, 0.25);
      }
      .steps span.on {
        background: #bef264;
        box-shadow: 0 0 10px rgba(190, 242, 100, 0.72);
      }
      .source {
        margin-top: -3px;
        color: #94a3b8;
        font-size: 10px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    </style>
    <div class="root">
      <div class="top">
        <div>
          <h1>YODEL VOX</h1>
          <div class="sub">clocked vocal formant loop</div>
        </div>
        <button id="enabled" type="button"></button>
      </div>
      <div class="controls">
        <label>volume <input id="volume" type="range" min="0" max="0.9" step="0.01"><span id="volumeVal"></span></label>
        <label>pitch <input id="pitch" type="range" min="0" max="1" step="0.01"><span id="pitchVal"></span></label>
        <div id="pitchSource" class="source"></div>
        <label>bright <input id="brightness" type="range" min="0" max="1" step="0.01"><span id="brightnessVal"></span></label>
        <label>jump <input id="yodel" type="range" min="0" max="1" step="0.01"><span id="yodelVal"></span></label>
        <label>shepard <input id="shepard" type="range" min="0" max="0.8" step="0.01"><span id="shepardVal"></span></label>
        <label>echo <input id="echo" type="range" min="0" max="0.7" step="0.01"><span id="echoVal"></span></label>
      </div>
      <div id="stage" class="stage" style="--pulse:0;--pan:0">
        <div id="syllable" class="syllable">ready</div>
        <div id="steps" class="steps"></div>
      </div>
    </div>
  `;

  const $ = (selector) => ctx.domRoot.querySelector(selector);
  const enabledButton = $('#enabled');
  const sliders = {
    volume: $('#volume'),
    pitch: $('#pitch'),
    brightness: $('#brightness'),
    yodel: $('#yodel'),
    shepard: $('#shepard'),
    echo: $('#echo')
  };
  const values = {
    volume: $('#volumeVal'),
    pitch: $('#pitchVal'),
    brightness: $('#brightnessVal'),
    yodel: $('#yodelVal'),
    shepard: $('#shepardVal'),
    echo: $('#echoVal')
  };
  const pitchSource = $('#pitchSource');
  const stage = $('#stage');
  const syllable = $('#syllable');
  const steps = $('#steps');
  const stepEls = Array.from({ length: 16 }, () => {
    const el = document.createElement('span');
    steps.appendChild(el);
    return el;
  });

  const track = (seconds, ...nodes) => {
    nodes.forEach((node) => liveNodes.add(node));
    const timer = setTimeout(() => {
      cleanupTimers.delete(timer);
      nodes.forEach((node) => {
        try { if (typeof node.disconnect === 'function') node.disconnect(); } catch (_) {}
        liveNodes.delete(node);
      });
    }, Math.max(160, seconds * 1000 + 220));
    cleanupTimers.add(timer);
  };

  const makeNoiseBuffer = (seconds) => {
    const length = Math.max(1, Math.floor(audio.sampleRate * seconds));
    const buffer = audio.createBuffer(1, length, audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 1.7);
    }
    return buffer;
  };

  const schedulePitch = (osc, points, startTime, duration) => {
    const jump = clamp(state.yodel, 0, 1);
    const transpose = pitchSemitones();
    const first = midiToFreq(points[0] + transpose);
    osc.frequency.setValueAtTime(first, startTime);
    points.forEach((midi, index) => {
      if (index === 0) return;
      const position = index / (points.length - 1);
      const targetTime = startTime + duration * (0.18 + position * 0.7);
      const targetMidi = points[0] + transpose + (midi - points[0]) * (0.42 + jump * 0.58);
      osc.frequency.exponentialRampToValueAtTime(midiToFreq(targetMidi), targetTime);
    });
  };

  const playSyllable = (event, time, tickDuration) => {
    if (!state.enabled) return;
    const t = Math.max(time, audio.currentTime + 0.004);
    const length = clamp(event.length * tickDuration, 0.11, 0.62);
    const brightness = clamp(state.brightness, 0, 1);
    const voice = audio.createOscillator();
    const head = audio.createOscillator();
    const voiceGain = audio.createGain();
    const headGain = audio.createGain();
    const vowelGain = audio.createGain();
    const breath = audio.createBufferSource();
    const breathFilter = audio.createBiquadFilter();
    const breathGain = audio.createGain();
    const pan = typeof audio.createStereoPanner === 'function' ? audio.createStereoPanner() : null;
    const lfo = audio.createOscillator();
    const lfoDepth = audio.createGain();

    voice.type = 'sawtooth';
    head.type = 'triangle';
    schedulePitch(voice, event.midi, t, length);
    schedulePitch(head, event.midi.map((midi) => midi + 12), t, length);
    voice.detune.setValueAtTime(-8, t);
    head.detune.setValueAtTime(4, t);
    lfo.frequency.setValueAtTime(5.2 + state.yodel * 3.8, t);
    lfoDepth.gain.setValueAtTime(10 + state.yodel * 34, t);
    lfo.connect(lfoDepth);
    lfoDepth.connect(voice.detune);
    lfoDepth.connect(head.detune);

    const peak = event.velocity * 0.42;
    vowelGain.gain.setValueAtTime(0.0001, t);
    vowelGain.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + 0.018);
    vowelGain.gain.setTargetAtTime(Math.max(0.0001, peak * 0.58), t + length * 0.36, 0.055);
    vowelGain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    voiceGain.gain.setValueAtTime(0.78, t);
    headGain.gain.setValueAtTime(0.16 + state.yodel * 0.2, t);
    breath.buffer = makeNoiseBuffer(length + 0.03);
    breathFilter.type = 'highpass';
    breathFilter.frequency.setValueAtTime(1800 + brightness * 2500, t);
    breathGain.gain.setValueAtTime(0.0001, t);
    breathGain.gain.exponentialRampToValueAtTime(peak * (0.12 + brightness * 0.12), t + 0.012);
    breathGain.gain.exponentialRampToValueAtTime(0.0001, t + length * 0.68);
    if (pan) pan.pan.setValueAtTime(event.pan, t);

    const formantNodes = [];
    const formants = FORMANTS[event.vowel] || FORMANTS.oh;
    voice.connect(voiceGain);
    head.connect(headGain);
    formants.forEach(([freq, gain, q], index) => {
      const filter = audio.createBiquadFilter();
      const formantGain = audio.createGain();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(freq * (0.92 + brightness * 0.18), t);
      filter.Q.setValueAtTime(q, t);
      formantGain.gain.setValueAtTime(gain * (index === 0 ? 1 : 0.72 + brightness * 0.42), t);
      voiceGain.connect(filter);
      headGain.connect(filter);
      filter.connect(formantGain);
      formantGain.connect(vowelGain);
      formantNodes.push(filter, formantGain);
    });

    breath.connect(breathFilter);
    breathFilter.connect(breathGain);
    breathGain.connect(vowelGain);
    if (pan) {
      vowelGain.connect(pan);
      pan.connect(output);
      pan.connect(delay);
    } else {
      vowelGain.connect(output);
      vowelGain.connect(delay);
    }

    voice.start(t);
    head.start(t);
    lfo.start(t);
    breath.start(t);
    voice.stop(t + length + 0.04);
    head.stop(t + length + 0.04);
    lfo.stop(t + length + 0.04);
    breath.stop(t + length + 0.02);
    track(length + 0.08, voice, head, voiceGain, headGain, vowelGain, breath, breathFilter, breathGain, lfo, lfoDepth, ...formantNodes, ...(pan ? [pan] : []));

    currentSyllable = event.label;
    pulse = 1;
    stage.style.setProperty('--pan', String(event.pan));
  };

  const playShepard = (time, tickDuration, step) => {
    if (!state.enabled || state.shepard <= 0 || shepardCrashed) return;
    const t = Math.max(time, audio.currentTime + 0.004);
    const phase = (((step % 64) + 64) % 64) / 64;
    const length = clamp(tickDuration * 2.6, 0.18, 0.9);
    const base = midiToFreq(33 + pitchSemitones());
    const stackGain = audio.createGain();
    const toneFilter = audio.createBiquadFilter();
    const pan = typeof audio.createStereoPanner === 'function' ? audio.createStereoPanner() : null;
    const maxGain = state.shepard * (0.04 + shepardRise * 0.28);

    stackGain.gain.setValueAtTime(0.0001, t);
    stackGain.gain.exponentialRampToValueAtTime(Math.max(0.0002, maxGain), t + 0.04);
    stackGain.gain.setTargetAtTime(Math.max(0.0001, maxGain * 0.72), t + length * 0.42, 0.08);
    stackGain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    toneFilter.type = 'bandpass';
    toneFilter.frequency.setValueAtTime(880 + state.brightness * 1400, t);
    toneFilter.Q.setValueAtTime(0.72, t);
    if (pan) pan.pan.setValueAtTime(Math.sin(step * 0.37) * 0.28, t);

    const nodes = [stackGain, toneFilter];
    for (let octave = 0; octave < 7; octave += 1) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      const octavePosition = octave + phase;
      const freq = base * Math.pow(2, octavePosition);
      if (freq > 40 && freq < audio.sampleRate * 0.42) {
        const distance = (octavePosition - 3.25) / 1.65;
        const weight = Math.exp(-0.5 * distance * distance);
        osc.type = octave % 2 ? 'triangle' : 'sine';
        osc.frequency.setValueAtTime(freq, t);
        osc.frequency.exponentialRampToValueAtTime(freq * Math.pow(2, 1 / 64), t + length);
        gain.gain.setValueAtTime(weight, t);
        osc.connect(gain);
        gain.connect(stackGain);
        osc.start(t);
        osc.stop(t + length + 0.03);
        nodes.push(osc, gain);
      }
    }

    stackGain.connect(toneFilter);
    if (pan) {
      toneFilter.connect(pan);
      pan.connect(output);
      pan.connect(delay);
      nodes.push(pan);
    } else {
      toneFilter.connect(output);
      toneFilter.connect(delay);
    }
    track(length + 0.06, ...nodes);
  };

  const playShepardCrash = (time, tickDuration) => {
    const t = Math.max(time, audio.currentTime + 0.004);
    const length = clamp(tickDuration * 7, 0.7, 1.8);
    const noise = audio.createBufferSource();
    const noiseFilter = audio.createBiquadFilter();
    const noiseGain = audio.createGain();
    const dropOsc = audio.createOscillator();
    const dropGain = audio.createGain();
    const impact = audio.createOscillator();
    const impactGain = audio.createGain();
    const crashBus = audio.createGain();
    const maxGain = clamp(0.38 + state.shepard * 0.72, 0.35, 0.95);

    noise.buffer = makeNoiseBuffer(length);
    noiseFilter.type = 'lowpass';
    noiseFilter.frequency.setValueAtTime(7600, t);
    noiseFilter.frequency.exponentialRampToValueAtTime(170, t + length * 0.78);
    noiseFilter.Q.setValueAtTime(1.4, t);
    noiseGain.gain.setValueAtTime(0.0001, t);
    noiseGain.gain.exponentialRampToValueAtTime(maxGain, t + 0.018);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, t + length);

    dropOsc.type = 'sawtooth';
    dropOsc.frequency.setValueAtTime(midiToFreq(67 + pitchSemitones()), t);
    dropOsc.frequency.exponentialRampToValueAtTime(42, t + length * 0.9);
    dropGain.gain.setValueAtTime(0.0001, t);
    dropGain.gain.exponentialRampToValueAtTime(maxGain * 0.28, t + 0.025);
    dropGain.gain.exponentialRampToValueAtTime(0.0001, t + length * 0.86);

    impact.type = 'sine';
    impact.frequency.setValueAtTime(54, t);
    impact.frequency.exponentialRampToValueAtTime(28, t + 0.28);
    impactGain.gain.setValueAtTime(0.0001, t);
    impactGain.gain.exponentialRampToValueAtTime(maxGain * 0.6, t + 0.01);
    impactGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);

    crashBus.gain.setValueAtTime(1, t);
    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(crashBus);
    dropOsc.connect(dropGain);
    dropGain.connect(crashBus);
    impact.connect(impactGain);
    impactGain.connect(crashBus);
    crashBus.connect(output);
    crashBus.connect(delay);

    noise.start(t);
    dropOsc.start(t);
    impact.start(t);
    noise.stop(t + length + 0.02);
    dropOsc.stop(t + length + 0.03);
    impact.stop(t + 0.48);
    track(length + 0.08, noise, noiseFilter, noiseGain, dropOsc, dropGain, impact, impactGain, crashBus);

    shepardCrashed = true;
    shepardRise = 0;
    shepardLoudSince = null;
    currentSyllable = 'crash';
    pulse = 1.25;
  };

  const updateShepardBuild = (time, tickDuration) => {
    if (!state.enabled || state.shepard <= 0 || shepardCrashed) return;
    shepardRise = clamp(shepardRise + 1 / 128, 0, 1);
    if (shepardRise >= 0.86) {
      if (shepardLoudSince === null) shepardLoudSince = time;
      if (time - shepardLoudSince >= 5) playShepardCrash(time, tickDuration);
    } else {
      shepardLoudSince = null;
    }
  };

  const applyAudioState = () => {
    const nextKey = [state.enabled, state.volume, state.echo, state.brightness].join('|');
    if (nextKey === audioStateKey) return;
    audioStateKey = nextKey;
    output.gain.setTargetAtTime(state.enabled ? state.volume : 0, audio.currentTime, 0.035);
    wet.gain.setTargetAtTime(state.echo, audio.currentTime, 0.05);
    feedback.gain.setTargetAtTime(0.12 + state.echo * 0.58, audio.currentTime, 0.05);
    delayTone.frequency.setTargetAtTime(1900 + state.brightness * 4200, audio.currentTime, 0.05);
  };

  const render = () => {
    enabledButton.textContent = state.enabled ? 'on' : 'off';
    enabledButton.classList.toggle('off', !state.enabled);
    Object.keys(sliders).forEach((key) => {
      if (sliders[key].value !== String(state[key])) sliders[key].value = String(state[key]);
      if (key === 'pitch') values[key].textContent = `${pitchSemitones() >= 0 ? '+' : ''}${pitchSemitones()}`;
      else if (key === 'shepard') values[key].textContent = shepardCrashed ? 'crash' : `${Math.round(shepardRise * 100)}%`;
      else values[key].textContent = Number(state[key]).toFixed(2);
    });
    pitchSource.textContent = zefiroPitch === null ? 'pitch source: manual slider' : 'pitch source: Zefiro CC1 lip/mod';
    applyAudioState();
    syllable.textContent = currentSyllable;
    stepEls.forEach((el, index) => el.classList.toggle('on', index === currentStep));
    stage.style.setProperty('--pulse', pulse.toFixed(3));
  };

  const onTick = ({ step, time, duration }) => {
    currentStep = ((step % 16) + 16) % 16;
    if (Number.isFinite(duration) && duration > 0) stepSeconds = duration;
    const tickDuration = clamp(duration || stepSeconds, 0.07, 0.34);
    delay.delayTime.setTargetAtTime(tickDuration * (1.45 + state.echo * 1.4), audio.currentTime, 0.04);
    updateShepardBuild(time, tickDuration);
    playShepard(time, tickDuration, step);
    const event = PHRASE.find((item) => item.step === currentStep);
    if (event) playSyllable(event, time, tickDuration);
    render();
  };

  const animate = () => {
    pulse *= 0.9;
    render();
    raf = requestAnimationFrame(animate);
  };

  const onEnabled = () => {
    state.enabled = !state.enabled;
    render();
  };
  const onSlider = (key) => () => {
    state[key] = Number(sliders[key].value);
    if (key === 'shepard') {
      shepardRise = 0;
      shepardLoudSince = null;
      shepardCrashed = false;
    }
    render();
  };
  const sliderHandlers = {
    volume: onSlider('volume'),
    pitch: onSlider('pitch'),
    brightness: onSlider('brightness'),
    yodel: onSlider('yodel'),
    shepard: onSlider('shepard'),
    echo: onSlider('echo')
  };

  enabledButton.addEventListener('click', onEnabled);
  Object.entries(sliderHandlers).forEach(([key, handler]) => sliders[key].addEventListener('input', handler));
  const unsubscribeClock = ctx.clock.onTick(onTick);
  const unsubscribeZefiroPitch = ctx.bus.subGlobal('global:zefiro:cc1', (value) => {
    if (!Number.isFinite(value)) return;
    zefiroPitch = clamp(value, 0, 1);
    render();
  });
  render();
  raf = requestAnimationFrame(animate);

  return {
    update() {},
    getState() {
      return { ...state };
    },
    destroy() {
      cancelAnimationFrame(raf);
      unsubscribeClock();
      unsubscribeZefiroPitch();
      enabledButton.removeEventListener('click', onEnabled);
      Object.entries(sliderHandlers).forEach(([key, handler]) => sliders[key].removeEventListener('input', handler));
      cleanupTimers.forEach((timer) => clearTimeout(timer));
      cleanupTimers.clear();
      for (const node of liveNodes) {
        try { if (typeof node.stop === 'function') node.stop(); } catch (_) {}
        try { if (typeof node.disconnect === 'function') node.disconnect(); } catch (_) {}
      }
      liveNodes.clear();
      try {
        output.disconnect(); highpass.disconnect(); compressor.disconnect(); delay.disconnect();
        feedback.disconnect(); delayTone.disconnect(); wet.disconnect();
      } catch (_) {}
    }
  };
}
