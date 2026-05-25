export default function setup(ctx, prevState) {
  const { audioCtx, audioOut, bus, domRoot, clock } = ctx;

  // --- State Management ---
  const state = {
    frequency: 440,
    gain: 0.5,
    filterCutoff: 1500,
    filterQ: 1,
    playing: false,
    attack: 0.05,
    decay: 0.1,
    sustain: 0.7,
    release: 0.2,
    bpmFactor: 0.25, // Trigger every 1/4 beat
  };

  // Apply previous state if available
  if (prevState) {
    Object.keys(state).forEach(key => {
      if (prevState.hasOwnProperty(key)) {
        state[key] = prevState[key];
      }
    });
  }

  // --- Audio Nodes Setup ---
  const oscillator = audioCtx.createOscillator();
  const oscGain = audioCtx.createGain(); // For ADSR envelope
  const filter = audioCtx.createBiquadFilter();
  const mainGain = audioCtx.createGain(); // Overall module gain

  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(state.frequency, audioCtx.currentTime);
  oscGain.gain.setValueAtTime(0, audioCtx.currentTime); // Start silent
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(state.filterCutoff, audioCtx.currentTime);
  filter.Q.setValueAtTime(state.filterQ, audioCtx.currentTime);
  mainGain.gain.setValueAtTime(state.gain, audioCtx.currentTime);

  // Connections
  oscillator.connect(oscGain);
  oscGain.connect(filter);
  filter.connect(mainGain);
  mainGain.connect(audioOut);

  // Start oscillator immediately, its output is controlled by oscGain
  oscillator.start();

  // --- Visuals & UI Setup ---
  domRoot.innerHTML = `
    <style>
      :host {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        font-family: 'Inter', sans-serif;
        color: #e0e0e0;
        background: #2a2a2a;
        border-radius: 8px;
        padding: 15px;
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
        box-sizing: border-box;
      }
      .controls {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 15px;
        margin-top: 15px;
        width: 100%;
        max-width: 300px;
      }
      .control-group {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 5px;
      }
      label {
        font-size: 0.9em;
        margin-bottom: 5px;
        color: #b0b0b0;
      }
      input[type="range"] {
        -webkit-appearance: none;
        width: 100%;
        height: 8px;
        background: #444;
        border-radius: 4px;
        outline: none;
        transition: opacity .2s;
      }
      input[type="range"]::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: #64ffda; /* Aqua-green accent */
        cursor: pointer;
        box-shadow: 0 0 2px rgba(0, 0, 0, 0.5);
      }
      input[type="range"]::-moz-range-thumb {
        width: 18px;
        height: 18px;
        border-radius: 50%;
        background: #64ffda;
        cursor: pointer;
        box-shadow: 0 0 2px rgba(0, 0, 0, 0.5);
      }
      button {
        background: #007bff;
        color: white;
        border: none;
        padding: 10px 20px;
        border-radius: 5px;
        cursor: pointer;
        font-size: 1em;
        transition: background 0.2s, transform 0.1s;
        width: 100%;
      }
      button:hover {
        background: #0056b3;
      }
      button:active {
        transform: scale(0.98);
      }
      button.active {
        background: #64ffda;
        color: #2a2a2a;
      }
      canvas {
        width: 100px;
        height: 100px;
        border-radius: 50%;
        background: radial-gradient(circle, #3a3a3a 0%, #2a2a2a 100%);
        border: 2px solid #64ffda;
        box-shadow: 0 0 15px rgba(100, 255, 218, 0.3);
      }
      .value-display {
          font-size: 0.8em;
          color: #888;
      }
    </style>
    <canvas id="visualizerCanvas" width="200" height="200"></canvas>
    <div class="controls">
      <div class="control-group">
        <label for="freq">Frequency</label>
        <input type="range" id="freq" min="50" max="2000" value="${state.frequency}">
        <span class="value-display" id="freqValue">${state.frequency.toFixed(1)} Hz</span>
      </div>
      <div class="control-group">
        <label for="gain">Volume</label>
        <input type="range" id="gain" min="0" max="1" step="0.01" value="${state.gain}">
        <span class="value-display" id="gainValue">${(state.gain * 100).toFixed(0)}%</span>
      </div>
      <div class="control-group">
        <label for="filterCutoff">Filter Cutoff</label>
        <input type="range" id="filterCutoff" min="100" max="5000" value="${state.filterCutoff}">
        <span class="value-display" id="filterCutoffValue">${state.filterCutoff.toFixed(1)} Hz</span>
      </div>
      <div class="control-group">
        <label for="filterQ">Filter Q</label>
        <input type="range" id="filterQ" min="0.1" max="10" step="0.1" value="${state.filterQ}">
        <span class="value-display" id="filterQValue">${state.filterQ.toFixed(1)}</span>
      </div>
      <button id="playToggle" class="${state.playing ? 'active' : ''}">${state.playing ? 'STOP' : 'PLAY'}</button>
    </div>
  `;

  const canvas = domRoot.querySelector('#visualizerCanvas');
  const ctx2d = canvas.getContext('2d');
  const freqSlider = domRoot.querySelector('#freq');
  const gainSlider = domRoot.querySelector('#gain');
  const filterCutoffSlider = domRoot.querySelector('#filterCutoff');
  const filterQSlider = domRoot.querySelector('#filterQ');
  const playToggleButton = domRoot.querySelector('#playToggle');

  const freqValueDisplay = domRoot.querySelector('#freqValue');
  const gainValueDisplay = domRoot.querySelector('#gainValue');
  const filterCutoffValueDisplay = domRoot.querySelector('#filterCutoffValue');
  const filterQValueDisplay = domRoot.querySelector('#filterQValue');


  // --- Event Handlers and Bus Communication ---
  const NAMESPACE = 'elem_oqi5cb5vu';

  // Helper to update UI and audio parameter
  const applyFrequency = (value) => {
    state.frequency = parseFloat(value);
    oscillator.frequency.setValueAtTime(state.frequency, audioCtx.currentTime);
    freqSlider.value = state.frequency;
    freqValueDisplay.textContent = `${state.frequency.toFixed(1)} Hz`;
  };

  const applyGain = (value) => {
    state.gain = parseFloat(value);
    mainGain.gain.setValueAtTime(state.gain, audioCtx.currentTime);
    gainSlider.value = state.gain;
    gainValueDisplay.textContent = `${(state.gain * 100).toFixed(0)}%`;
  };

  const applyFilterCutoff = (value) => {
    state.filterCutoff = parseFloat(value);
    filter.frequency.setValueAtTime(state.filterCutoff, audioCtx.currentTime);
    filterCutoffSlider.value = state.filterCutoff;
    filterCutoffValueDisplay.textContent = `${state.filterCutoff.toFixed(1)} Hz`;
  };

  const applyFilterQ = (value) => {
    state.filterQ = parseFloat(value);
    filter.Q.setValueAtTime(state.filterQ, audioCtx.currentTime);
    filterQSlider.value = state.filterQ;
    filterQValueDisplay.textContent = `${state.filterQ.toFixed(1)}`;
  };

  const applyPlayState = (isPlaying) => {
    state.playing = isPlaying;
    playToggleButton.textContent = state.playing ? 'STOP' : 'PLAY';
    if (state.playing) {
      playToggleButton.classList.add('active');
    } else {
      playToggleButton.classList.remove('active');
      // Ensure the envelope fades out if playing stops mid-note
      oscGain.gain.cancelScheduledValues(audioCtx.currentTime);
      oscGain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + state.release);
    }
  };

  // Initial UI updates based on state
  applyFrequency(state.frequency);
  applyGain(state.gain);
  applyFilterCutoff(state.filterCutoff);
  applyFilterQ(state.filterQ);
  applyPlayState(state.playing); // Initialize button state


  // DOM Event Handlers
  const handleFreqInput = (e) => {
    applyFrequency(e.target.value);
    bus.pubGlobal(`${NAMESPACE}:frequency`, state.frequency);
  };

  const handleGainInput = (e) => {
    applyGain(e.target.value);
    bus.pubGlobal(`${NAMESPACE}:gain`, state.gain);
  };

  const handleFilterCutoffInput = (e) => {
    applyFilterCutoff(e.target.value);
    bus.pubGlobal(`${NAMESPACE}:filterCutoff`, state.filterCutoff);
  };

  const handleFilterQInput = (e) => {
    applyFilterQ(e.target.value);
    bus.pubGlobal(`${NAMESPACE}:filterQ`, state.filterQ);
  };

  const handlePlayToggleClick = () => {
    applyPlayState(!state.playing);
    bus.pubGlobal(`${NAMESPACE}:playing`, state.playing);
  };

  freqSlider.addEventListener('input', handleFreqInput);
  gainSlider.addEventListener('input', handleGainInput);
  filterCutoffSlider.addEventListener('input', handleFilterCutoffInput);
  filterQSlider.addEventListener('input', handleFilterQInput);
  playToggleButton.addEventListener('click', handlePlayToggleClick);

  // Bus Subscription Handlers (for syncing state from other sources)
  const subFreqHandler = (val) => applyFrequency(val);
  const subGainHandler = (val) => applyGain(val);
  const subFilterCutoffHandler = (val) => applyFilterCutoff(val);
  const subFilterQHandler = (val) => applyFilterQ(val);
  const subPlayingHandler = (val) => applyPlayState(val);

  bus.subGlobal(`${NAMESPACE}:frequency`, subFreqHandler);
  bus.subGlobal(`${NAMESPACE}:gain`, subGainHandler);
  bus.subGlobal(`${NAMESPACE}:filterCutoff`, subFilterCutoffHandler);
  bus.subGlobal(`${NAMESPACE}:filterQ`, subFilterQHandler);
  bus.subGlobal(`${NAMESPACE}:playing`, subPlayingHandler);

  // --- Clock & Beat-aligned Scheduling ---
  let lastBeatDivision = -1;
  const onClockTick = ({ step, time }) => {
    if (!state.playing) return;

    const beatDivision = Math.floor(step / state.bpmFactor);
    if (beatDivision !== lastBeatDivision) {
      // Trigger ADSR envelope
      const attackEnd = time + state.attack;
      const decayEnd = attackEnd + state.decay;

      oscGain.gain.cancelScheduledValues(time);
      oscGain.gain.setValueAtTime(0.0001, time); // Start from near zero
      oscGain.gain.linearRampToValueAtTime(1.0, attackEnd); // Attack
      oscGain.gain.linearRampToValueAtTime(state.sustain, decayEnd); // Decay to Sustain

      // Schedule release before next trigger point
      const nextBeatTime = time + state.bpmFactor * (60 / ctx.clock.bpm);
      const releaseStartTime = Math.min(nextBeatTime - state.release, decayEnd); 
      oscGain.gain.linearRampToValueAtTime(0.0001, releaseStartTime + state.release); 
      
      triggerVisualPulse(); // Trigger visual on beat
    }
    lastBeatDivision = beatDivision;
  };

  const unsubscribeClock = clock.onTick(onClockTick);

  // --- Visualizer Animation ---
  let pulseIntensity = 0; // 0 to 1

  const drawVisualizer = () => {
    ctx2d.clearRect(0, 0, canvas.width, canvas.height);

    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const baseRadius = canvas.width * 0.2;
    const maxPulse = canvas.width * 0.1;

    const currentPulse = pulseIntensity * maxPulse;
    const radius = baseRadius + currentPulse;

    ctx2d.beginPath();
    ctx2d.arc(centerX, centerY, radius, 0, 2 * Math.PI);
    ctx2d.fillStyle = `rgba(100, 255, 218, ${0.4 + pulseIntensity * 0.4})`;
    ctx2d.fill();
    ctx2d.strokeStyle = '#64ffda';
    ctx2d.lineWidth = 2 + pulseIntensity * 2;
    ctx2d.stroke();

    if (pulseIntensity > 0) {
      pulseIntensity *= 0.85; // Faster decay
      if (pulseIntensity < 0.001) pulseIntensity = 0;
    }
  };

  const triggerVisualPulse = () => {
    pulseIntensity = 1; // Full pulse
  };

  // --- Lifecycle Hooks ---
  return {
    update(tick) {
      // The host calls this update function for per-frame animation
      drawVisualizer();
    },
    getState() {
      return state;
    },
    destroy() {
      // Stop oscillator and disconnect
      oscillator.stop();
      oscillator.disconnect();
      oscGain.disconnect();
      filter.disconnect();
      mainGain.disconnect();

      // Remove DOM event listeners
      freqSlider.removeEventListener('input', handleFreqInput);
      gainSlider.removeEventListener('input', handleGainInput);
      filterCutoffSlider.removeEventListener('input', handleFilterCutoffInput);
      filterQSlider.removeEventListener('input', handleFilterQInput);
      playToggleButton.removeEventListener('click', handlePlayToggleClick);

      // Unsubscribe from bus
      bus.unsubGlobal(`${NAMESPACE}:frequency`, subFreqHandler);
      bus.unsubGlobal(`${NAMESPACE}:gain`, subGainHandler);
      bus.unsubGlobal(`${NAMESPACE}:filterCutoff`, subFilterCutoffHandler);
      bus.unsubGlobal(`${NAMESPACE}:filterQ`, subFilterQHandler);
      bus.unsubGlobal(`${NAMESPACE}:playing`, subPlayingHandler);

      // Unsubscribe from clock
      if (unsubscribeClock) {
        unsubscribeClock();
      }

      // Clear DOM
      domRoot.innerHTML = '';
    }
  };
}