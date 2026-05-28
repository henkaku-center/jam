export default function setup(ctx, prevState) {
  const MAX_VOICES = 8;
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const now = () => ctx.audioCtx.currentTime;
  const midiToFreq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);
  const noteName = (midi) => `${noteNames[midi % 12]}${Math.floor(midi / 12) - 1}`;

  const state = {
    deviceId: prevState?.deviceId ?? null,
    deviceName: prevState?.deviceName ?? 'none',
    volume: Number.isFinite(prevState?.volume) ? clamp(prevState.volume, 0, 1) : 0.72,
    cutoff: Number.isFinite(prevState?.cutoff) ? clamp(prevState.cutoff, 0, 1) : 0.58,
    resonance: Number.isFinite(prevState?.resonance) ? clamp(prevState.resonance, 0, 1) : 0.22,
    mod: 0,
    pitchBend: 0,
    sustain: false,
    lastNote: null,
    lastVelocity: 0
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
          <input id="volume" type="range" min="0" max="1" step="0.001" value="${state.volume}">
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
        </div>
      </div>

      <div class="foot" id="foot">Note on/off, pitch bend, mod wheel, sustain, CC7, CC71 and CC74 respond automatically.</div>
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

  const master = ctx.audioCtx.createGain();
  const analyser = ctx.audioCtx.createAnalyser();
  master.gain.value = 0.0001;
  analyser.fftSize = 128;
  master.connect(analyser);
  analyser.connect(ctx.audioOut);

  let midiAccess = null;
  let currentInput = null;
  let uiTimer = null;
  const voices = new Map();
  const retiredVoices = new Set();
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
  };

  const applyGlobalParams = () => {
    const t = now();
    setParam(master.gain, state.volume * 0.36, t, 0.025);
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
    const ampLevel = 0.08 + velocity * 0.32;

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
    mix.gain.setValueAtTime(0.62, t);
    subGain.gain.setValueAtTime(0.22, t);
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

  const handleControlChange = (cc, raw) => {
    const value = clamp(raw / 127, 0, 1);
    if (cc === 1) state.mod = value;
    if (cc === 7) state.volume = value;
    if (cc === 64) setSustain(raw >= 64);
    if (cc === 71) state.resonance = value;
    if (cc === 74) state.cutoff = value;
    volumeEl.value = String(state.volume);
    cutoffEl.value = String(state.cutoff);
    resonanceEl.value = String(state.resonance);
    applyGlobalParams();
  };

  const handleMidiMessage = (event) => {
    const data = event.data;
    if (!data || data.length < 2) return;
    const command = data[0] & 0xf0;
    const d1 = data[1] ?? 0;
    const d2 = data[2] ?? 0;

    if (command === 0x90) {
      if (d2 === 0) noteOff(d1);
      else noteOn(d1, d2);
      return;
    }
    if (command === 0x80) {
      noteOff(d1);
      return;
    }
    if (command === 0xb0) {
      if (d1 === 120 || d1 === 123) {
        allNotesOff();
        return;
      }
      handleControlChange(d1, d2);
      return;
    }
    if (command === 0xe0) {
      const bend14 = d1 + (d2 << 7);
      state.pitchBend = clamp((bend14 - 8192) / 8192, -1, 1);
      applyGlobalParams();
    }
  };

  const detachCurrentInput = () => {
    if (currentInput && inputHandlers.has(currentInput)) {
      currentInput.removeEventListener('midimessage', inputHandlers.get(currentInput));
      inputHandlers.delete(currentInput);
    }
    currentInput = null;
  };

  const attachInput = (input) => {
    detachCurrentInput();
    allNotesOff();
    currentInput = input;
    state.deviceId = input.id;
    state.deviceName = input.name || input.id;
    input.addEventListener('midimessage', handleMidiMessage);
    inputHandlers.set(input, handleMidiMessage);
    pickerEl.value = input.id;
    setStatus(`connected: ${state.deviceName}`, 'ok');
  };

  const refreshPicker = () => {
    if (!midiAccess) return [];
    const inputs = [...midiAccess.inputs.values()];
    pickerEl.replaceChildren();
    if (inputs.length) {
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
    if (state.deviceId && inputs.some((input) => input.id === state.deviceId)) {
      pickerEl.value = state.deviceId;
    }
    return inputs;
  };

  const pickInput = (inputs) => {
    if (state.deviceId) {
      const saved = inputs.find((input) => input.id === state.deviceId);
      if (saved) return saved;
    }
    const keyboard = inputs.find((input) => /key|midi|controller|launch|oxygen|mpk|minilab|keystation|arturia|akai|novation|komplete|yamaha|roland|korg/i.test(input.name || ''));
    return keyboard || inputs[0] || null;
  };

  const onStateChange = () => {
    const inputs = refreshPicker();
    if (inputs.length === 0) {
      detachCurrentInput();
      allNotesOff();
      setStatus('no MIDI inputs connected', 'warn');
      return;
    }
    if (currentInput && !inputs.some((input) => input.id === currentInput.id)) {
      detachCurrentInput();
      allNotesOff();
    }
    if (!currentInput) {
      const input = pickInput(inputs);
      if (input) attachInput(input);
    }
  };

  const onPickerChange = () => {
    if (!midiAccess || !pickerEl.value) return;
    const input = midiAccess.inputs.get(pickerEl.value);
    if (input) attachInput(input);
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
        deviceId: state.deviceId,
        deviceName: state.deviceName,
        volume: state.volume,
        cutoff: state.cutoff,
        resonance: state.resonance
      };
    },
    destroy() {
      if (uiTimer) clearInterval(uiTimer);
      for (const timer of cleanupTimers) clearTimeout(timer);
      cleanupTimers.clear();
      pickerEl.removeEventListener('change', onPickerChange);
      volumeEl.removeEventListener('input', onVolume);
      cutoffEl.removeEventListener('input', onCutoff);
      resonanceEl.removeEventListener('input', onResonance);
      if (midiAccess) {
        try { midiAccess.removeEventListener('statechange', onStateChange); } catch (_) {}
      }
      detachCurrentInput();
      for (const voice of voices.values()) disposeVoiceNow(voice);
      for (const voice of retiredVoices.values()) disposeVoiceNow(voice);
      voices.clear();
      retiredVoices.clear();
      try { master.disconnect(); } catch (_) {}
      try { analyser.disconnect(); } catch (_) {}
    }
  };
}
