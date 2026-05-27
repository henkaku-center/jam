// Interactive Synthesizer Element
export default function setup(ctx, prevState) {
  const dom = ctx.domRoot;
  let state = {
    frequency: prevState?.frequency || 220,
    volume: prevState?.volume || 0.3,
    waveform: prevState?.waveform || 'sawtooth',
    cutoff: prevState?.cutoff || 1000,
    ...prevState
  };

  // Audio setup
  const osc = ctx.audioCtx.createOscillator();
  const filter = ctx.audioCtx.createBiquadFilter();
  const gain = ctx.audioCtx.createGain();

  osc.type = state.waveform;
  osc.frequency.setValueAtTime(state.frequency, ctx.audioCtx.currentTime);
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(state.cutoff, ctx.audioCtx.currentTime);
  gain.gain.setValueAtTime(state.volume, ctx.audioCtx.currentTime);

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.audioOut);
  
  osc.start();

  // Create UI HTML
  dom.innerHTML = `
    <style>
      .card {
        background: rgba(20, 20, 30, 0.95);
        border: 2px solid #ef4444;
        border-radius: 12px;
        padding: 15px;
        color: #fff;
        font-family: monospace;
        box-shadow: 0 4px 20px rgba(239, 68, 68, 0.2);
        width: 260px;
        box-sizing: border-box;
      }
      h3 { margin: 0 0 10px 0; color: #ef4444; text-align: center; font-size: 14px; }
      .row { display: flex; justify-content: space-between; margin-bottom: 8px; font-size: 11px; align-items: center; }
      input[type=range] { flex-grow: 1; margin-left: 10px; accent-color: #ef4444; }
      .val { color: #fbbf24; font-weight: bold; min-width: 45px; text-align: right; }
      .wave-btn {
        flex: 1; margin: 0 2px; padding: 4px; background: #2d2d3d; border: 1px solid #ef4444;
        color: #fff; border-radius: 4px; cursor: pointer; font-size: 9px;
      }
      .wave-btn.active {
        background: #ef4444; color: #000; font-weight: bold;
      }
    </style>
    <div class="card">
      <h3>🎹 ANALOG SYNTH</h3>
      <div class="row">
        <span>Freq:</span>
        <input type="range" id="freq-slider" min="50" max="800" step="1" value="${state.frequency}">
        <span class="val" id="freq-val">${state.frequency}Hz</span>
      </div>
      <div class="row">
        <span>Cutoff:</span>
        <input type="range" id="cutoff-slider" min="100" max="4000" step="10" value="${state.cutoff}">
        <span class="val" id="cutoff-val">${state.cutoff}Hz</span>
      </div>
      <div class="row">
        <span>Volume:</span>
        <input type="range" id="vol-slider" min="0" max="1" step="0.01" value="${state.volume}">
        <span class="val" id="vol-val">${Math.round(state.volume * 100)}%</span>
      </div>
      <div class="row" style="margin-top: 10px;">
        <button class="wave-btn ${state.waveform==='sine'?'active':''}" data-wave="sine">Sine</button>
        <button class="wave-btn ${state.waveform==='triangle'?'active':''}" data-wave="triangle">Tri</button>
        <button class="wave-btn ${state.waveform==='sawtooth'?'active':''}" data-wave="sawtooth">Saw</button>
        <button class="wave-btn ${state.waveform==='square'?'active':''}" data-wave="square">Squ</button>
      </div>
    </div>
  `;

  const freqSlider = dom.querySelector('#freq-slider');
  const freqVal = dom.querySelector('#freq-val');
  const cutoffSlider = dom.querySelector('#cutoff-slider');
  const cutoffVal = dom.querySelector('#cutoff-val');
  const volSlider = dom.querySelector('#vol-slider');
  const volVal = dom.querySelector('#vol-val');
  const waveBtns = dom.querySelectorAll('.wave-btn');

  // Input events - Route through Yjs global sync (pubGlobal) so all users stay identical!
  freqSlider.addEventListener('input', (e) => {
    ctx.bus.pubGlobal('synth_freq', parseFloat(e.target.value));
  });
  cutoffSlider.addEventListener('input', (e) => {
    ctx.bus.pubGlobal('synth_cutoff', parseFloat(e.target.value));
  });
  volSlider.addEventListener('input', (e) => {
    ctx.bus.pubGlobal('synth_vol', parseFloat(e.target.value));
  });
  waveBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      ctx.bus.pubGlobal('synth_wave', btn.dataset.wave);
    });
  });

  // Subscriptions to update state and audio
  const unsub1 = ctx.bus.subGlobal('synth_freq', (val) => {
    state.frequency = val;
    freqSlider.value = val;
    freqVal.textContent = val + 'Hz';
    osc.frequency.setTargetAtTime(val, ctx.audioCtx.currentTime, 0.05);
  });
  const unsub2 = ctx.bus.subGlobal('synth_cutoff', (val) => {
    state.cutoff = val;
    cutoffSlider.value = val;
    cutoffVal.textContent = val + 'Hz';
    filter.frequency.setTargetAtTime(val, ctx.audioCtx.currentTime, 0.05);
  });
  const unsub3 = ctx.bus.subGlobal('synth_vol', (val) => {
    state.volume = val;
    volSlider.value = val;
    volVal.textContent = Math.round(val * 100) + '%';
    gain.gain.setTargetAtTime(val, ctx.audioCtx.currentTime, 0.05);
  });
  const unsub4 = ctx.bus.subGlobal('synth_wave', (val) => {
    state.waveform = val;
    osc.type = val;
    waveBtns.forEach(btn => {
      if (btn.dataset.wave === val) btn.classList.add('active');
      else btn.classList.remove('active');
    });
  });

  // Subscribe to local bus (high-frequency) to listen to our LFO modifier if connected!
  const unsubLFO = ctx.bus.sub('lfo_value', (lfoVal) => {
    // Modulate cutoff frequency using high-frequency LFO signal
    const baseCutoff = state.cutoff;
    const modulatedCutoff = Math.max(100, Math.min(4000, baseCutoff + lfoVal * 1500));
    filter.frequency.setValueAtTime(modulatedCutoff, ctx.audioCtx.currentTime);
  });

  return {
    update(tick) {
      // Optional animation
    },
    getState() {
      return state;
    },
    destroy() {
      unsub1();
      unsub2();
      unsub3();
      unsub4();
      unsubLFO();
      osc.stop();
      osc.disconnect();
      filter.disconnect();
      gain.disconnect();
    }
  };
}