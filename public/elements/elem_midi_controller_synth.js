export default function setup(ctx, prevState) {
  const STATE_VERSION = 'midi-controller-synth-cc-map-v1';
  const MAX_VOICES = 8;
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const ccLanes = [
    { key: 'bass', label: 'Bass', defaultCc: 0 },
    { key: 'pluck', label: 'Pluck', defaultCc: 1 },
    { key: 'pad', label: 'Pad', defaultCc: 2 },
    { key: 'bell', label: 'Bell', defaultCc: 3 },
    { key: 'drums', label: 'Drums', defaultCc: 4 }
  ];
  const nanoKontrolSliders = new Map(ccLanes.map((lane, index) => [index, lane]));
  const nanoKontrolModifiers = {
    16: 'cutoff',
    17: 'resonance',
    18: 'mod',
    19: 'volume',
    20: 'cutoff'
  };

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const now = () => ctx.audioCtx.currentTime;
  const midiToFreq = (midi) => 440 * Math.pow(2, (midi + 24 - 69) / 12);
  const noteName = (midi) => `${noteNames[midi % 12]}${Math.floor(midi / 12) - 1}`;
  const inputName = (input) => `${input?.name || ''} ${input?.manufacturer || ''}`.trim();
  const isNanoKey = (input) => /nanokey|nano key/i.test(inputName(input));
  const isNanoKontrol = (input) => /nanokontrol|nano kontrol/i.test(inputName(input));

  const savedAssignments = prevState?.ccAssignments && typeof prevState.ccAssignments === 'object' ? prevState.ccAssignments : {};
  const defaultAssignments = Object.fromEntries(ccLanes.map((lane) => [lane.key, Number.isInteger(savedAssignments[lane.key]) ? savedAssignments[lane.key] : lane.defaultCc]));
  const defaultCcLevels = Object.fromEntries(ccLanes.map((lane) => [lane.key, 0]));

  const state = {
    stateVersion: STATE_VERSION,
    deviceId: prevState?.deviceId ?? null,
    deviceName: prevState?.deviceName ?? 'none',
    volume: prevState?.stateVersion === STATE_VERSION && Number.isFinite(prevState?.volume) ? clamp(prevState.volume, 0, 1.25) : 0.98,
    cutoff: prevState?.stateVersion === STATE_VERSION && Number.isFinite(prevState?.cutoff) ? clamp(prevState.cutoff, 0, 1) : 0.72,
    resonance: Number.isFinite(prevState?.resonance) ? clamp(prevState.resonance, 0, 1) : 0.22,
    mod: 0,
    pitchBend: 0,
    sustain: false,
    lastNote: null,
    lastVelocity: 0,
    lastCc: null,
    lastCcValue: 0,
    ccAssignments: defaultAssignments,
    ccLevels: { ...defaultCcLevels },
    ccLearnIndex: 0
  };

  ctx.domRoot.innerHTML = `
    <style>
      :host, .root { box-sizing: border-box; }
      .root {
        height: 100%;
        min-height: 220px;
        padding: 12px;
        background: #101417;
        color: #eef6f0;
        font: 12px/1.35 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        display: grid;
        grid-template-rows: auto auto 1fr auto;
        gap: 10px;
        overflow: hidden;
      }
      .header {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 10px;
      }
      h1 {
        margin: 0;
        font-size: 14px;
        line-height: 1;
        font-weight: 750;
        letter-spacing: 0;
        color: #f8fafc;
      }
      .voice-count {
        min-width: 54px;
        text-align: right;
        color: #7dd3fc;
        font: 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      .midi {
        display: grid;
        gap: 5px;
      }
      .label {
        color: #a7b6bc;
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      select {
        width: 100%;
        min-height: 30px;
        border: 1px solid #314047;
        border-radius: 5px;
        background: #182126;
        color: #eef6f0;
        padding: 4px 7px;
        font: inherit;
      }
      .status {
        min-height: 16px;
        color: #a7b6bc;
        font-size: 11px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .status.ok { color: #86efac; }
      .status.warn { color: #facc15; }
      .status.err { color: #fb7185; }
      .panel {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 10px;
        align-content: start;
        min-height: 0;
      }
      .control {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 5px 8px;
        align-items: center;
      }
      .control input {
        grid-column: 1 / -1;
        width: 100%;
        accent-color: #2dd4bf;
      }
      .value {
        color: #d1d5db;
        font: 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      .activity {
        display: grid;
        gap: 6px;
        align-content: end;
        min-height: 52px;
      }
      .note {
        display: flex;
        justify-content: space-between;
        gap: 8px;
        font: 24px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
        color: #f8fafc;
      }
      .note span:last-child {
        color: #2dd4bf;
        font-size: 18px;
      }
      .meters {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: 6px;
      }
      .cc-lanes {
        grid-column: 1 / -1;
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        gap: 6px;
        margin-top: 2px;
      }
      .lane {
        min-width: 0;
        display: grid;
        gap: 3px;
      }
      .lane-label {
        overflow: hidden;
        color: #9ca3af;
        font-size: 9px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .meter {
        min-width: 0;
        display: grid;
        gap: 3px;
      }
      .bar {
        position: relative;
        height: 7px;
        background: #243039;
        border-radius: 999px;
        overflow: hidden;
      }
      .bar > span {
        position: absolute;
        inset: 0 auto 0 0;
        width: 0%;
        border-radius: inherit;
        background: #38bdf8;
      }
      .bar.mod > span { background: #a78bfa; }
      .bar.bend > span { background: #fb923c; }
      .bar.vel > span { background: #2dd4bf; }
      .bar.bass > span { background: #60a5fa; }
      .bar.pluck > span { background: #2dd4bf; }
      .bar.pad > span { background: #a78bfa; }
      .bar.bell > span { background: #facc15; }
      .bar.drums > span { background: #fb7185; }
      .foot {
        min-height: 14px;
        color: #6f7f87;
        font-size: 10px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
    </style>
    <div class="root">
      <div class="header">
        <h1>MIDI Synth</h1>
        <div class="voice-count" id="voiceCount">0 voices</div>
      </div>

      <div class="midi">
        <div class="label">MIDI input</div>
        <select id="midiPicker">
          <option value="">Scanning...</option>
        </select>
        <div class="status" id="status">requesting MIDI access...</div>
      </div>

      <div class="panel">
        <label class="control">
          <span class="label">Volume</span>
          <span class="value" id="volumeValue"></span>
          <input id="volume" type="range" min="0" max="1.25" step="0.001" value="${state.volume}">
        </label>
        <label class="control">
          <span class="label">Cutoff</span>
          <span class="value" id="cutoffValue"></span>
          <input id="cutoff" type="range" min="0" max="1" step="0.001" value="${state.cutoff}">
        </label>
        <label class="control">
          <span class="label">Resonance</span>
          <span class="value" id="resonanceValue"></span>
          <input id="resonance" type="range" min="0" max="1" step="0.001" value="${state.resonance}">
        </label>
        <div class="activity">
          <div class="note"><span id="noteName">--</span><span id="sustain">SUS off</span></div>
          <div class="meters">
            <div class="meter">
              <div class="label">Velocity</div>
              <div class="bar vel"><span id="velocityBar"></span></div>
            </div>
            <div class="meter">
              <div class="label">Mod</div>
              <div class="bar mod"><span id="modBar"></span></div>
            </div>
            <div class="meter">
              <div class="label">Bend</div>
              <div class="bar bend"><span id="bendBar"></span></div>
            </div>
          </div>
          <div class="cc-lanes" id="ccLanes">
            ${ccLanes.map((lane) => `
              <div class="lane">
                <div class="lane-label" id="laneLabel-${lane.key}">${lane.label} CC${state.ccAssignments[lane.key]}</div>
                <div class="bar ${lane.key}"><span id="laneBar-${lane.key}"></span></div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <div class="foot" id="foot">nanoKEY plays notes. nanoKONTROL sliders CC0-4 map Bass, Pluck, Pad, Bell, Drums; knobs CC16-20 shape the synth.</div>
    </div>
  `;

  const pickerEl = ctx.domRoot.querySelector('#midiPicker');
  const statusEl = ctx.domRoot.querySelector('#status');
  const voiceCountEl = ctx.domRoot.querySelector('#voiceCount');
  const volumeEl = ctx.domRoot.querySelector('#volume');
  const cutoffEl = ctx.domRoot.querySelector('#cutoff');
  const resonanceEl = ctx.domRoot.querySelector('#resonance');
  const volumeValueEl = ctx.domRoot.querySelector('#volumeValue');
  const cutoffValueEl = ctx.domRoot.querySelector('#cutoffValue');
  const resonanceValueEl = ctx.domRoot.querySelector('#resonanceValue');
  const noteNameEl = ctx.domRoot.querySelector('#noteName');
  const sustainEl = ctx.domRoot.querySelector('#sustain');
  const velocityBarEl = ctx.domRoot.querySelector('#velocityBar');
  const modBarEl = ctx.domRoot.querySelector('#modBar');
  const bendBarEl = ctx.domRoot.querySelector('#bendBar');
  const laneEls = Object.fromEntries(ccLanes.map((lane) => [lane.key, {
    label: ctx.domRoot.querySelector(`#laneLabel-${lane.key}`),
    bar: ctx.domRoot.querySelector(`#laneBar-${lane.key}`)
  }]));

  const master = ctx.audioCtx.createGain();
  const compressor = ctx.audioCtx.createDynamicsCompressor();
  const analyser = ctx.audioCtx.createAnalyser();
  const noiseBuffer = (() => {
    const length = Math.max(1, Math.floor(ctx.audioCtx.sampleRate * 0.6));
    const buffer = ctx.audioCtx.createBuffer(1, length, ctx.audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  })();
  master.gain.value = 0.0001;
  compressor.threshold.value = -18;
  compressor.knee.value = 18;
  compressor.ratio.value = 3.8;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.16;
  analyser.fftSize = 128;
  master.connect(compressor);
  compressor.connect(analyser);
  analyser.connect(ctx.audioOut);

  let midiAccess = null;
  const activeInputs = new Map();
  let uiTimer = null;
  const voices = new Map();
  const retiredVoices = new Set();
  const syncedNodes = new Set();
  const cleanupTimers = new Set();
  const inputHandlers = new WeakMap();

  const setStatus = (text, cls = '') => {
    statusEl.textContent = text;
    statusEl.className = `status ${cls}`.trim();
  };

  const setParam = (param, value, time = now(), smoothing = 0.018) => {
    param.cancelScheduledValues(time);
    param.setTargetAtTime(value, time, smoothing);
  };

  const cutoffHz = () => 180 + Math.pow(state.cutoff, 2.2) * 7800;
  const bendRatio = () => Math.pow(2, (state.pitchBend * 2) / 12);

  const updateStaticUi = () => {
    volumeValueEl.textContent = `${Math.round(state.volume * 100)}%`;
    cutoffValueEl.textContent = `${Math.round(cutoffHz())} Hz`;
    resonanceValueEl.textContent = state.resonance.toFixed(2);
    sustainEl.textContent = state.sustain ? 'SUS on' : 'SUS off';
    noteNameEl.textContent = Number.isFinite(state.lastNote) ? noteName(state.lastNote) : '--';
    velocityBarEl.style.width = `${Math.round(state.lastVelocity * 100)}%`;
    modBarEl.style.width = `${Math.round(state.mod * 100)}%`;
    bendBarEl.style.width = `${Math.round((state.pitchBend * 0.5 + 0.5) * 100)}%`;
    voiceCountEl.textContent = `${voices.size} voice${voices.size === 1 ? '' : 's'}`;
    for (const lane of ccLanes) {
      const refs = laneEls[lane.key];
      if (!refs) continue;
      refs.label.textContent = `${lane.label} CC${state.ccAssignments[lane.key]}`;
      refs.bar.style.width = `${Math.round((state.ccLevels[lane.key] || 0) * 100)}%`;
    }
  };

  const applyGlobalParams = () => {
    const t = now();
    setParam(master.gain, state.volume * 0.82, t, 0.025);
    for (const voice of voices.values()) {
      setParam(voice.filter.frequency, cutoffHz(), t, 0.025);
      setParam(voice.filter.Q, 0.7 + state.resonance * 13, t, 0.025);
      setParam(voice.lfoDepth.gain, state.mod * 8, t, 0.025);
      const ratio = bendRatio();
      voice.oscA.frequency.setTargetAtTime(voice.freq * ratio, t, 0.01);
      voice.oscB.frequency.setTargetAtTime(voice.freq * 1.005 * ratio, t, 0.01);
      voice.sub.frequency.setTargetAtTime(voice.freq * 0.5 * ratio, t, 0.01);
    }
    updateStaticUi();
  };

  const scheduleCleanup = (voice, delayMs) => {
    retiredVoices.add(voice);
    const timer = setTimeout(() => {
      cleanupTimers.delete(timer);
      retiredVoices.delete(voice);
      for (const node of voice.nodes) {
        try { node.disconnect(); } catch (_) {}
      }
    }, delayMs);
    cleanupTimers.add(timer);
  };

  const trackSyncedNodes = (seconds, ...nodes) => {
    nodes.forEach((node) => syncedNodes.add(node));
    const timer = setTimeout(() => {
      cleanupTimers.delete(timer);
      nodes.forEach((node) => {
        try { if (typeof node.disconnect === 'function') node.disconnect(); } catch (_) {}
        syncedNodes.delete(node);
      });
    }, Math.max(80, seconds * 1000 + 160));
    cleanupTimers.add(timer);
  };

  const disposeVoiceNow = (voice) => {
    try { voice.oscA.stop(); } catch (_) {}
    try { voice.oscB.stop(); } catch (_) {}
    try { voice.sub.stop(); } catch (_) {}
    try { voice.lfo.stop(); } catch (_) {}
    for (const node of voice.nodes) {
      try { node.disconnect(); } catch (_) {}
    }
  };

  const releaseVoice = (midi, fast = false) => {
    const voice = voices.get(midi);
    if (!voice) return;
    voices.delete(midi);
    const t = now();
    const release = fast ? 0.035 : 0.22;
    voice.amp.gain.cancelScheduledValues(t);
    voice.amp.gain.setTargetAtTime(0.0001, t, release / 4);
    try {
      voice.oscA.stop(t + release + 0.08);
      voice.oscB.stop(t + release + 0.08);
      voice.sub.stop(t + release + 0.08);
      voice.lfo.stop(t + release + 0.08);
    } catch (_) {}
    scheduleCleanup(voice, Math.round((release + 0.18) * 1000));
    updateStaticUi();
  };

  const allNotesOff = () => {
    for (const midi of [...voices.keys()]) releaseVoice(midi, true);
  };

  const playSyncedTone = (time, midi, velocity, length, type, filterBase = 1800) => {
    const t = Math.max(time, now() + 0.002);
    const freq = midiToFreq(midi);
    const oscA = ctx.audioCtx.createOscillator();
    const oscB = ctx.audioCtx.createOscillator();
    const gain = ctx.audioCtx.createGain();
    const filter = ctx.audioCtx.createBiquadFilter();
    const pan = ctx.audioCtx.createStereoPanner();

    const ratio = bendRatio();
    oscA.type = type;
    oscB.type = type === 'sine' ? 'triangle' : 'sine';
    oscA.frequency.setValueAtTime(freq * ratio, t);
    oscB.frequency.setValueAtTime(freq * 1.505 * ratio, t);
    oscB.detune.setValueAtTime(type === 'sawtooth' ? -9 : 4, t);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(filterBase + state.cutoff * 5200 + velocity * 1100, t);
    filter.Q.setValueAtTime(0.8 + state.resonance * 8, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(velocity, t + 0.012);
    gain.gain.setTargetAtTime(0.0001, t + length, 0.055);
    pan.pan.setValueAtTime((midi % 9 - 4) * 0.055, t);

    oscA.connect(filter);
    oscB.connect(filter);
    filter.connect(gain);
    gain.connect(pan);
    pan.connect(master);
    oscA.start(t);
    oscB.start(t);
    oscA.stop(t + length + 0.16);
    oscB.stop(t + length + 0.16);
    trackSyncedNodes(length + 0.3, oscA, oscB, filter, gain, pan);
  };

  const playSyncedDrum = (time, level, step) => {
    const t = Math.max(time, now() + 0.002);
    const source = ctx.audioCtx.createBufferSource();
    const filter = ctx.audioCtx.createBiquadFilter();
    const gain = ctx.audioCtx.createGain();
    source.buffer = noiseBuffer;
    filter.type = step % 4 === 0 ? 'lowpass' : 'highpass';
    filter.frequency.setValueAtTime(step % 4 === 0 ? 240 : 5200, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime((step % 4 === 0 ? 0.32 : 0.12) * level, t + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + (step % 4 === 0 ? 0.18 : 0.055));
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(t);
    source.stop(t + 0.22);
    trackSyncedNodes(0.32, source, filter, gain);
  };

  const triggerSyncedLanes = (step, time, duration) => {
    const index = ((step % 16) + 16) % 16;
    const bass = state.ccLevels.bass || 0;
    const pluck = state.ccLevels.pluck || 0;
    const pad = state.ccLevels.pad || 0;
    const bell = state.ccLevels.bell || 0;
    const drums = state.ccLevels.drums || 0;
    const root = [45, 48, 43, 50][Math.floor((step % 64) / 16)] || 45;

    if (bass > 0.03 && [0, 6, 8, 14].includes(index)) {
      playSyncedTone(time, root + (index === 14 ? 7 : 0), 0.08 + bass * 0.26, duration * 1.45, 'sawtooth', 520);
    }
    if (pluck > 0.03 && [0, 3, 5, 7, 10, 12, 15].includes(index)) {
      const offsets = [12, 19, 22, 24, 19, 15, 17, 12, 24, 22, 19, 17, 15, 12, 19, 22];
      playSyncedTone(time, root + offsets[index], 0.045 + pluck * 0.15, duration * 0.65, 'triangle', 1800);
    }
    if (pad > 0.03 && index % 8 === 0) {
      [0, 7, 12, 16].forEach((offset, voiceIndex) => {
        playSyncedTone(time + voiceIndex * 0.012, root + offset + 12, 0.025 + pad * 0.06, duration * 5.8, 'sine', 1300);
      });
    }
    if (bell > 0.03 && [2, 6, 9, 13].includes(index)) {
      const offsets = [31, 34, 36, 38, 36, 34, 31, 29, 31, 36, 38, 41, 38, 36, 34, 31];
      playSyncedTone(time + duration * 0.08, root + offsets[index], 0.035 + bell * 0.13, duration * 1.1, 'sine', 4200);
    }
    if (drums > 0.03 && (index % 4 === 0 || index % 2 === 1)) {
      playSyncedDrum(time, drums, index);
    }
  };

  const stealOldestVoice = () => {
    let oldest = null;
    let oldestTime = Infinity;
    for (const [midi, voice] of voices.entries()) {
      if (voice.startedAt < oldestTime) {
        oldest = midi;
        oldestTime = voice.startedAt;
      }
    }
    if (oldest !== null) releaseVoice(oldest, true);
  };

  const noteOn = (midi, velocityRaw) => {
    if (ctx.audioCtx.state === 'suspended') {
      ctx.audioCtx.resume().catch(() => {});
    }
    if (voices.has(midi)) releaseVoice(midi, true);
    if (voices.size >= MAX_VOICES) stealOldestVoice();

    const t = now();
    const freq = midiToFreq(midi);
    const velocity = clamp(velocityRaw / 127, 0.01, 1);
    const ampLevel = 0.14 + velocity * 0.5;

    const oscA = ctx.audioCtx.createOscillator();
    const oscB = ctx.audioCtx.createOscillator();
    const sub = ctx.audioCtx.createOscillator();
    const lfo = ctx.audioCtx.createOscillator();
    const lfoDepth = ctx.audioCtx.createGain();
    const mix = ctx.audioCtx.createGain();
    const subGain = ctx.audioCtx.createGain();
    const filter = ctx.audioCtx.createBiquadFilter();
    const amp = ctx.audioCtx.createGain();
    const pan = ctx.audioCtx.createStereoPanner();

    const ratio = bendRatio();
    oscA.type = 'sawtooth';
    oscB.type = 'triangle';
    sub.type = 'sine';
    oscA.frequency.setValueAtTime(freq * ratio, t);
    oscB.frequency.setValueAtTime(freq * 1.005 * ratio, t);
    sub.frequency.setValueAtTime(freq * 0.5 * ratio, t);
    oscB.detune.setValueAtTime(5, t);
    lfo.frequency.setValueAtTime(5.8, t);
    lfoDepth.gain.setValueAtTime(state.mod * 8, t);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoffHz() * (0.75 + velocity * 0.5), t);
    filter.frequency.setTargetAtTime(cutoffHz(), t + 0.04, 0.08);
    filter.Q.setValueAtTime(0.7 + state.resonance * 13, t);
    mix.gain.setValueAtTime(0.78, t);
    subGain.gain.setValueAtTime(0.32, t);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(ampLevel, t + 0.012);
    amp.gain.setTargetAtTime(ampLevel * 0.72, t + 0.08, 0.18);
    pan.pan.setValueAtTime((midi % 7 - 3) * 0.045, t);

    lfo.connect(lfoDepth);
    lfoDepth.connect(oscA.detune);
    lfoDepth.connect(oscB.detune);
    oscA.connect(mix);
    oscB.connect(mix);
    sub.connect(subGain);
    subGain.connect(mix);
    mix.connect(filter);
    filter.connect(amp);
    amp.connect(pan);
    pan.connect(master);

    oscA.start(t);
    oscB.start(t);
    sub.start(t);
    lfo.start(t);

    voices.set(midi, {
      midi,
      freq,
      oscA,
      oscB,
      sub,
      lfo,
      lfoDepth,
      amp,
      filter,
      held: true,
      startedAt: t,
      nodes: [oscA, oscB, sub, lfo, lfoDepth, mix, subGain, filter, amp, pan]
    });

    state.lastNote = midi;
    state.lastVelocity = velocity;
    ctx.bus.pubGlobal('global:midiSynth:note', { note: midi, velocity });
    updateStaticUi();
  };

  const noteOff = (midi) => {
    const voice = voices.get(midi);
    if (!voice) return;
    voice.held = false;
    if (!state.sustain) releaseVoice(midi);
  };

  const setSustain = (on) => {
    state.sustain = on;
    if (!on) {
      for (const [midi, voice] of voices.entries()) {
        if (!voice.held) releaseVoice(midi);
      }
    }
    updateStaticUi();
  };

  const reservedCc = new Set([1, 7, 64, 71, 74, 120, 123]);

  const laneForCc = (cc, sourceType) => {
    if (sourceType === 'nanokontrol') {
      const sliderLane = nanoKontrolSliders.get(cc);
      if (sliderLane) {
        state.ccAssignments[sliderLane.key] = cc;
        return sliderLane;
      }
      return null;
    }
    const assigned = ccLanes.find((lane) => state.ccAssignments[lane.key] === cc);
    if (assigned) return assigned;
    const defaultLane = ccLanes.find((lane) => lane.defaultCc === cc);
    if (defaultLane) {
      state.ccAssignments[defaultLane.key] = cc;
      return defaultLane;
    }
    if (reservedCc.has(cc)) return null;
    const lane = ccLanes[state.ccLearnIndex % ccLanes.length];
    state.ccAssignments[lane.key] = cc;
    state.ccLearnIndex += 1;
    return lane;
  };

  const applyNanoKontrolModifier = (cc, value) => {
    const target = nanoKontrolModifiers[cc];
    if (target === 'cutoff') state.cutoff = value;
    if (target === 'resonance') state.resonance = value;
    if (target === 'mod') state.mod = value;
    if (target === 'volume') state.volume = value * 1.25;
  };

  const handleControlChange = (cc, raw, sourceType = 'generic', sourceName = '') => {
    const value = clamp(raw / 127, 0, 1);
    const lane = laneForCc(cc, sourceType);
    state.lastCc = cc;
    state.lastCcValue = value;
    if (lane) state.ccLevels[lane.key] = value;
    if (sourceType === 'nanokontrol') {
      applyNanoKontrolModifier(cc, value);
    } else {
      if (cc === 1) state.mod = value;
      if (cc === 7) state.volume = value * 1.25;
      if (cc === 64) setSustain(raw >= 64);
      if (cc === 71) state.resonance = value;
      if (cc === 74) state.cutoff = value;
    }
    ctx.bus.pubGlobal(`global:midiController:cc${cc}`, value);
    ctx.bus.pubGlobal(`global:midiController:cc${cc}_raw`, raw);
    ctx.bus.pubGlobal('global:midiController:lastCc', { cc, value, raw, lane: lane?.key || null, sourceType, sourceName });
    ctx.bus.pubGlobal(`global:zefiro:cc${cc}`, value);
    ctx.bus.pubGlobal(`global:zefiro:cc${cc}_raw`, raw);
    volumeEl.value = String(state.volume);
    cutoffEl.value = String(state.cutoff);
    resonanceEl.value = String(state.resonance);
    applyGlobalParams();
  };

  const sourceTypeForInput = (input) => {
    if (isNanoKontrol(input)) return 'nanokontrol';
    if (isNanoKey(input)) return 'nanokey';
    return 'generic';
  };

  const handleMidiMessage = (event, input) => {
    const data = event.data;
    if (!data || data.length < 2) return;
    const command = data[0] & 0xf0;
    const d1 = data[1] ?? 0;
    const d2 = data[2] ?? 0;
    const sourceType = sourceTypeForInput(input);
    const sourceName = inputName(input);

    if (command === 0x90) {
      if (sourceType === 'nanokontrol') return;
      if (d2 === 0) noteOff(d1);
      else noteOn(d1, d2);
      return;
    }
    if (command === 0x80) {
      if (sourceType === 'nanokontrol') return;
      noteOff(d1);
      return;
    }
    if (command === 0xb0) {
      if (d1 === 120 || d1 === 123) {
        allNotesOff();
        return;
      }
      if (sourceType === 'nanokey' && activeInputs.size > 1) return;
      handleControlChange(d1, d2, sourceType, sourceName);
      return;
    }
    if (command === 0xe0) {
      if (sourceType === 'nanokontrol') return;
      const bend14 = d1 + (d2 << 7);
      state.pitchBend = clamp((bend14 - 8192) / 8192, -1, 1);
      applyGlobalParams();
    }
  };

  const describeActiveInputs = () => {
    const inputs = [...activeInputs.values()];
    const names = inputs.map((input) => input.name || input.manufacturer || input.id);
    const hasKey = inputs.some(isNanoKey);
    const hasKontrol = inputs.some(isNanoKontrol);
    if (hasKey && hasKontrol) return `connected: nanoKEY + nanoKONTROL`;
    if (names.length) return `connected: ${names.join(' + ')}`;
    return 'no MIDI inputs connected';
  };

  const syncActiveInputState = () => {
    const inputs = [...activeInputs.values()];
    state.deviceId = inputs.map((input) => input.id).join(',');
    state.deviceName = inputs.map((input) => input.name || input.id).join(' + ') || 'none';
    setStatus(describeActiveInputs(), inputs.length ? 'ok' : 'warn');
  };

  const detachInput = (input) => {
    if (!input || !inputHandlers.has(input)) return;
    input.removeEventListener('midimessage', inputHandlers.get(input));
    inputHandlers.delete(input);
    activeInputs.delete(input.id);
    syncActiveInputState();
  };

  const detachAllInputs = () => {
    for (const input of [...activeInputs.values()]) detachInput(input);
  };

  const attachInput = (input) => {
    if (!input || activeInputs.has(input.id)) return;
    const handler = (event) => handleMidiMessage(event, input);
    input.addEventListener('midimessage', handler);
    inputHandlers.set(input, handler);
    activeInputs.set(input.id, input);
    syncActiveInputState();
  };

  const refreshPicker = () => {
    if (!midiAccess) return [];
    const inputs = [...midiAccess.inputs.values()];
    pickerEl.replaceChildren();
    if (inputs.length) {
      const autoOption = document.createElement('option');
      autoOption.value = '';
      autoOption.textContent = 'Auto: nanoKEY + nanoKONTROL';
      pickerEl.append(autoOption);
      for (const input of inputs) {
        const option = document.createElement('option');
        option.value = input.id;
        option.textContent = input.name || input.manufacturer || input.id;
        pickerEl.append(option);
      }
    } else {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No MIDI inputs connected';
      pickerEl.append(option);
    }
    pickerEl.disabled = inputs.length === 0;
    pickerEl.value = '';
    return inputs;
  };

  const targetInputs = (inputs) => {
    const nanoTargets = inputs.filter((input) => isNanoKey(input) || isNanoKontrol(input));
    return nanoTargets.length ? nanoTargets : inputs;
  };

  const onStateChange = () => {
    const inputs = refreshPicker();
    if (inputs.length === 0) {
      detachAllInputs();
      allNotesOff();
      syncActiveInputState();
      return;
    }
    const targets = targetInputs(inputs);
    for (const input of [...activeInputs.values()]) {
      if (!targets.some((target) => target.id === input.id)) detachInput(input);
    }
    targets.forEach(attachInput);
    syncActiveInputState();
  };

  const onPickerChange = () => {
    if (!midiAccess) return;
    const inputs = [...midiAccess.inputs.values()];
    detachAllInputs();
    if (!pickerEl.value) {
      targetInputs(inputs).forEach(attachInput);
    } else {
      const input = midiAccess.inputs.get(pickerEl.value);
      if (input) attachInput(input);
    }
    allNotesOff();
    syncActiveInputState();
  };

  const onVolume = () => {
    state.volume = Number(volumeEl.value);
    applyGlobalParams();
  };
  const onCutoff = () => {
    state.cutoff = Number(cutoffEl.value);
    applyGlobalParams();
  };
  const onResonance = () => {
    state.resonance = Number(resonanceEl.value);
    applyGlobalParams();
  };

  pickerEl.addEventListener('change', onPickerChange);
  volumeEl.addEventListener('input', onVolume);
  cutoffEl.addEventListener('input', onCutoff);
  resonanceEl.addEventListener('input', onResonance);

  const unsubscribeClock = ctx.clock.onTick(({ step, time, duration }) => {
    triggerSyncedLanes(step, time, duration);
  });

  const init = async () => {
    if (!navigator.requestMIDIAccess) {
      setStatus('Web MIDI not supported in this browser; use Chrome or Edge', 'err');
      pickerEl.disabled = true;
      return;
    }
    try {
      midiAccess = await navigator.requestMIDIAccess({ sysex: false });
    } catch (err) {
      setStatus(`MIDI access denied: ${err.message || err}`, 'err');
      pickerEl.disabled = true;
      return;
    }
    midiAccess.addEventListener('statechange', onStateChange);
    onStateChange();
  };

  applyGlobalParams();
  updateStaticUi();
  init();
  uiTimer = setInterval(updateStaticUi, 120);

  return {
    update() {},
    getState() {
      return {
        stateVersion: state.stateVersion,
        deviceId: state.deviceId,
        deviceName: state.deviceName,
        volume: state.volume,
        cutoff: state.cutoff,
        resonance: state.resonance,
        ccAssignments: { ...state.ccAssignments }
      };
    },
    destroy() {
      if (uiTimer) clearInterval(uiTimer);
      unsubscribeClock();
      for (const timer of cleanupTimers) clearTimeout(timer);
      cleanupTimers.clear();
      pickerEl.removeEventListener('change', onPickerChange);
      volumeEl.removeEventListener('input', onVolume);
      cutoffEl.removeEventListener('input', onCutoff);
      resonanceEl.removeEventListener('input', onResonance);
      if (midiAccess) {
        try { midiAccess.removeEventListener('statechange', onStateChange); } catch (_) {}
      }
      detachAllInputs();
      for (const voice of voices.values()) disposeVoiceNow(voice);
      for (const voice of retiredVoices.values()) disposeVoiceNow(voice);
      for (const node of syncedNodes.values()) {
        try { if (typeof node.stop === 'function') node.stop(); } catch (_) {}
        try { node.disconnect(); } catch (_) {}
      }
      voices.clear();
      retiredVoices.clear();
      syncedNodes.clear();
      try { master.disconnect(); } catch (_) {}
      try { compressor.disconnect(); } catch (_) {}
      try { analyser.disconnect(); } catch (_) {}
    }
  };
}
