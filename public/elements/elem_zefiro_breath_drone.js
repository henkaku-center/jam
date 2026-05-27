// Breath-driven drone — subscribes to global:zefiro:cc11 (breath) for amplitude
// and global:zefiro:cc1 (lip/mod) for filter cutoff. Falls back to a manual
// slider when no Zefiro data has arrived yet, so the element is usable
// standalone.

export default function setup(ctx, prevState) {
  const state = {
    rootMidi: Number.isFinite(prevState?.rootMidi) ? prevState.rootMidi : 45, // A2
    detuneCents: Number.isFinite(prevState?.detuneCents) ? prevState.detuneCents : 7,
    manualBreath: Number.isFinite(prevState?.manualBreath) ? prevState.manualBreath : 0,
    manualCutoff: Number.isFinite(prevState?.manualCutoff) ? prevState.manualCutoff : 0.4
  };

  let lastBreathFromMidi = -1;
  let lastLipFromMidi = -1;
  let breath = state.manualBreath;
  let cutoffNorm = state.manualCutoff;

  ctx.domRoot.innerHTML = `
    <style>
      .root {
        box-sizing: border-box;
        height: 100%;
        padding: 10px 12px;
        background: #0a0612;
        color: #ddd6fe;
        font: 11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace;
        display: grid;
        gap: 8px;
        align-content: start;
      }
      h1 {
        margin: 0;
        font: 600 12px ui-sans-serif, system-ui, sans-serif;
        letter-spacing: 0.04em;
        color: #c4b5fd;
      }
      .row { display: grid; gap: 4px; }
      input[type=range] { width: 100%; }
      .meters {
        display: grid;
        grid-template-columns: 60px 1fr 36px;
        gap: 6px;
        align-items: center;
      }
      .bar {
        position: relative;
        height: 8px;
        background: #1e1b4b;
        border: 1px solid #312e81;
        overflow: hidden;
      }
      .bar > span {
        position: absolute;
        inset: 0 auto 0 0;
        background: linear-gradient(90deg, #a78bfa, #f0abfc);
      }
      .src { color: #818cf8; font-size: 10px; }
    </style>
    <div class="root">
      <h1>BREATH DRONE</h1>
      <div class="row">
        <label>root midi <input id="root" type="range" min="24" max="72" step="1" value="${state.rootMidi}"></label>
      </div>
      <div class="row">
        <label>detune cents <input id="detune" type="range" min="0" max="30" step="1" value="${state.detuneCents}"></label>
      </div>
      <div class="row">
        <label>breath (manual) <input id="manualBreath" type="range" min="0" max="1" step="0.001" value="${state.manualBreath}"></label>
      </div>
      <div class="row">
        <label>cutoff (manual) <input id="manualCutoff" type="range" min="0" max="1" step="0.001" value="${state.manualCutoff}"></label>
      </div>
      <div class="meters">
        <span>breath</span>
        <span class="bar"><span id="breathBar" style="right:100%"></span></span>
        <span id="breathSrc" class="src">manual</span>
      </div>
      <div class="meters">
        <span>cutoff</span>
        <span class="bar"><span id="cutBar" style="right:100%"></span></span>
        <span id="cutSrc" class="src">manual</span>
      </div>
    </div>
  `;

  const breathBar = ctx.domRoot.querySelector('#breathBar');
  const cutBar = ctx.domRoot.querySelector('#cutBar');
  const breathSrc = ctx.domRoot.querySelector('#breathSrc');
  const cutSrc = ctx.domRoot.querySelector('#cutSrc');

  // Audio graph: two slightly detuned saws -> lowpass -> amp -> out.
  const oscA = ctx.audioCtx.createOscillator();
  const oscB = ctx.audioCtx.createOscillator();
  const mix = ctx.audioCtx.createGain();
  const lpf = ctx.audioCtx.createBiquadFilter();
  const amp = ctx.audioCtx.createGain();
  const sub = ctx.audioCtx.createOscillator();
  const subAmp = ctx.audioCtx.createGain();

  oscA.type = 'sawtooth';
  oscB.type = 'sawtooth';
  sub.type = 'sine';
  lpf.type = 'lowpass';
  lpf.Q.value = 6;
  mix.gain.value = 0.5;
  subAmp.gain.value = 0.35;
  amp.gain.value = 0;

  const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

  const applyPitch = () => {
    const f = midiToFreq(state.rootMidi);
    const now = ctx.audioCtx.currentTime;
    oscA.frequency.setTargetAtTime(f, now, 0.02);
    oscB.frequency.setTargetAtTime(f, now, 0.02);
    sub.frequency.setTargetAtTime(f / 2, now, 0.02);
    oscA.detune.setTargetAtTime(-state.detuneCents, now, 0.02);
    oscB.detune.setTargetAtTime(state.detuneCents, now, 0.02);
  };

  oscA.connect(mix);
  oscB.connect(mix);
  mix.connect(lpf);
  sub.connect(subAmp);
  subAmp.connect(lpf);
  lpf.connect(amp);
  amp.connect(ctx.audioOut);

  applyPitch();
  oscA.start();
  oscB.start();
  sub.start();

  // Subscribe to Zefiro CCs. The bus delivers cached values immediately if
  // present, then live updates after each publish.
  const unsubBreath = ctx.bus.subGlobal('global:zefiro:cc11', (value) => {
    if (!Number.isFinite(value)) return;
    lastBreathFromMidi = value;
    breathSrc.textContent = 'zefiro';
  });
  const unsubLip = ctx.bus.subGlobal('global:zefiro:cc1', (value) => {
    if (!Number.isFinite(value)) return;
    lastLipFromMidi = value;
    cutSrc.textContent = 'zefiro';
  });

  // ~60Hz smoothing + audio-param writes. Web Audio setTargetAtTime
  // gives us a nice tau-shaped slew so breath feels continuous.
  const tick = () => {
    const now = ctx.audioCtx.currentTime;
    const useMidiBreath = lastBreathFromMidi >= 0;
    const useMidiLip = lastLipFromMidi >= 0;
    breath = useMidiBreath ? lastBreathFromMidi : state.manualBreath;
    cutoffNorm = useMidiLip ? lastLipFromMidi : state.manualCutoff;

    // Map breath 0..1 -> amp 0..0.45 with mild exponential feel.
    const targetAmp = Math.pow(breath, 1.4) * 0.45;
    amp.gain.setTargetAtTime(targetAmp, now, 0.015);

    // Cutoff: log sweep 80Hz..12kHz.
    const targetCutoff = 80 * Math.pow(150, cutoffNorm);
    lpf.frequency.setTargetAtTime(targetCutoff, now, 0.04);

    // Visual meters.
    breathBar.style.right = `${(1 - breath) * 100}%`;
    cutBar.style.right = `${(1 - cutoffNorm) * 100}%`;

    if (!useMidiBreath) breathSrc.textContent = 'manual';
    if (!useMidiLip) cutSrc.textContent = 'manual';
  };
  const ticker = setInterval(tick, 16);

  // Wire manual sliders + pitch controls.
  const rootSlider = ctx.domRoot.querySelector('#root');
  const detuneSlider = ctx.domRoot.querySelector('#detune');
  const manualBreathSlider = ctx.domRoot.querySelector('#manualBreath');
  const manualCutoffSlider = ctx.domRoot.querySelector('#manualCutoff');

  const onRoot = () => { state.rootMidi = Number(rootSlider.value); applyPitch(); };
  const onDetune = () => { state.detuneCents = Number(detuneSlider.value); applyPitch(); };
  const onManualBreath = () => { state.manualBreath = Number(manualBreathSlider.value); };
  const onManualCutoff = () => { state.manualCutoff = Number(manualCutoffSlider.value); };

  rootSlider.addEventListener('input', onRoot);
  detuneSlider.addEventListener('input', onDetune);
  manualBreathSlider.addEventListener('input', onManualBreath);
  manualCutoffSlider.addEventListener('input', onManualCutoff);

  return {
    update() {},
    getState() { return { ...state }; },
    destroy() {
      clearInterval(ticker);
      unsubBreath();
      unsubLip();
      rootSlider.removeEventListener('input', onRoot);
      detuneSlider.removeEventListener('input', onDetune);
      manualBreathSlider.removeEventListener('input', onManualBreath);
      manualCutoffSlider.removeEventListener('input', onManualCutoff);
      try { oscA.stop(); oscB.stop(); sub.stop(); } catch (_) {}
      try {
        oscA.disconnect(); oscB.disconnect(); sub.disconnect();
        subAmp.disconnect(); mix.disconnect(); lpf.disconnect(); amp.disconnect();
      } catch (_) {}
    }
  };
}
