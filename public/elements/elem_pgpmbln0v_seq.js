export default function setup(ctx, prevState) {
  const { audioCtx, audioOut, domRoot, clock, bus } = ctx;
  const instanceId = 'elem_pgpmbln0v'; // Unique ID for this instance

  // --- State Management ---
  const defaultState = {
    isPlaying: false,
    mainFreq: 220, // Hz
    filterBaseFreq: 800, // Hz
    filterLfoDepth: 700, // Hz
    filterLfoFreq: 0.25, // Hz
    ampLfoDepth: 0.5, // 0 to 1
    ampLfoBeatDiv: 2, // 1/2 beat (e.g., 2 beats per cycle = 1/2 beat length)
    gain: 0.3,
  };

  let state = { ...defaultState, ...prevState };

  // --- Audio Nodes ---
  // Main sound path
  let mainOscillator = null;
  let filterNode = null;
  let ampModGain = null; // Node whose gain is modulated by ampLfo
  let mainGainNode = null;

  // Modulators
  let filterLfo = null;
  let filterLfoGain = null; // To control filter LFO depth
  let ampLfo = null;
  let ampLfoScaler = null; // To control amp LFO depth

  let tickUnsubscribe;

  // --- UI Elements ---
  let playPauseButton;
  let canvas;
  let ctx2d;

  // --- Internal Bus Keys for UI updates ---
  // These are local to the instance, so no need for instanceId prefix
  const VISUAL_FILTER_CUTOFF = 'visual:filterCutoff';
  const VISUAL_AMP_VALUE = 'visual:ampValue';

  // --- Audio Setup Function ---
  const createAudioGraph = () => {
    // Clear any existing mainOscillator if re-creating on play/pause
    destroyAudioGraph(false); // Do not stop LFOs or completely clear for play/pause

    // Create persistent nodes if they don't exist (LFOs, Filter, Master Gain)
    if (!filterNode) {
      filterNode = audioCtx.createBiquadFilter();
      filterNode.type = 'lowpass';
      filterNode.frequency.setValueAtTime(state.filterBaseFreq, audioCtx.currentTime);
      filterNode.Q.setValueAtTime(10, audioCtx.currentTime); // High Q for resonance
    }

    if (!ampModGain) {
      ampModGain = audioCtx.createGain();
      // Base gain for ampModGain, LFO will add/subtract from this
      ampModGain.gain.setValueAtTime(1 - state.ampLfoDepth / 2, audioCtx.currentTime);
    }

    if (!mainGainNode) {
      mainGainNode = audioCtx.createGain();
      mainGainNode.gain.setValueAtTime(state.gain, audioCtx.currentTime);
      mainGainNode.connect(audioOut); // Connect main gain to the output
    }

    // --- Modulators ---
    if (!filterLfo) {
      filterLfo = audioCtx.createOscillator();
      filterLfo.frequency.setValueAtTime(state.filterLfoFreq, audioCtx.currentTime);
      filterLfo.type = 'sine';
      filterLfo.start();
    }
    if (!filterLfoGain) {
      filterLfoGain = audioCtx.createGain();
      filterLfoGain.gain.setValueAtTime(state.filterLfoDepth, audioCtx.currentTime);
      filterLfo.connect(filterLfoGain);
      filterLfoGain.connect(filterNode.frequency); // Modulate filter frequency
    }

    if (!ampLfo) {
      ampLfo = audioCtx.createOscillator();
      // Frequency will be set by the clock tick handler based on BPM
      ampLfo.frequency.setValueAtTime(0, audioCtx.currentTime);
      ampLfo.type = 'sine';
      ampLfo.start();
    }
    if (!ampLfoScaler) {
      ampLfoScaler = audioCtx.createGain();
      ampLfoScaler.gain.setValueAtTime(state.ampLfoDepth / 2, audioCtx.currentTime);
      ampLfo.connect(ampLfoScaler);
      ampLfoScaler.connect(ampModGain.gain); // Modulate ampModGain's gain
    }

    // Connect persistent nodes
    filterNode.connect(ampModGain);
    ampModGain.connect(mainGainNode);

    // Create and start main oscillator only if playing
    if (state.isPlaying) {
      mainOscillator = audioCtx.createOscillator();
      mainOscillator.frequency.setValueAtTime(state.mainFreq, audioCtx.currentTime);
      mainOscillator.type = 'sine';
      mainOscillator.connect(filterNode);
      mainOscillator.start(audioCtx.currentTime);
    }
  };

  const destroyAudioGraph = (fullCleanup = true) => {
    // Always stop and disconnect the main oscillator when called
    if (mainOscillator) {
      try {
        mainOscillator.stop(audioCtx.currentTime);
        mainOscillator.disconnect();
      } catch (e) { /* already stopped */ }
      mainOscillator = null;
    }

    // Only stop/disconnect LFOs and other persistent nodes if it's a full cleanup (destroy lifecycle hook)
    if (fullCleanup) {
      if (filterNode) {
        filterNode.disconnect();
        filterNode = null;
      }
      if (ampModGain) {
        ampModGain.disconnect();
        ampModGain = null;
      }
      if (mainGainNode) {
        mainGainNode.disconnect();
        mainGainNode = null;
      }
      if (filterLfo) {
        try {
          filterLfo.stop(audioCtx.currentTime);
          filterLfo.disconnect();
        } catch (e) { /* already stopped */ }
        filterLfo = null;
      }
      if (filterLfoGain) {
        filterLfoGain.disconnect();
        filterLfoGain = null;
      }
      if (ampLfo) {
        try {
          ampLfo.stop(audioCtx.currentTime);
          ampLfo.disconnect();
        } catch (e) { /* already stopped */ }
        ampLfo = null;
      }
      if (ampLfoScaler) {
        ampLfoScaler.disconnect();
        ampLfoScaler = null;
      }
    }
  };

  // --- UI Creation ---
  const createUI = () => {
    domRoot.innerHTML = `
      <style>
        :host {
          display: flex;
          flex-direction: column;
          font-family: 'Inter', sans-serif;
          color: #e0e0e0;
          background: #282c34;
          border-radius: 8px;
          overflow: hidden;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
          width: 100%;
          height: 100%;
          min-width: 280px;
          min-height: 350px;
          container-type: inline-size;
        }
        .container {
          padding: 1cqw;
          display: flex;
          flex-direction: column;
          gap: 1cqw;
          flex-grow: 1;
        }
        .controls {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 1cqw;
          margin-bottom: 1cqw;
        }
        @container (max-width: 400px) {
            .controls {
                grid-template-columns: 1fr;
            }
        }
        .control-group {
          display: flex;
          flex-direction: column;
          gap: 0.5cqw;
          padding: 0.8cqw;
          background: #3a3f4a;
          border-radius: 6px;
          box-shadow: inset 0 1px 3px rgba(0,0,0,0.3);
        }
        label {
          font-size: 0.8em;
          color: #a0a0a0;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        input[type="range"] {
          -webkit-appearance: none;
          width: 100%;
          height: 8px;
          background: #555;
          outline: none;
          opacity: 0.8;
          transition: opacity .2s;
          border-radius: 4px;
        }
        input[type="range"]:hover {
          opacity: 1;
        }
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: #61dafb;
          cursor: pointer;
          box-shadow: 0 0 5px rgba(97, 218, 251, 0.5);
        }
        input[type="range"]::-moz-range-thumb {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: #61dafb;
          cursor: pointer;
          box-shadow: 0 0 5px rgba(97, 218, 251, 0.5);
        }
        button {
          padding: 1cqw 1.5cqw;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          font-size: 1em;
          font-weight: bold;
          transition: background 0.2s, transform 0.1s;
          box-shadow: 0 2px 5px rgba(0,0,0,0.3);
          white-space: nowrap; /* Prevent text wrapping */
        }
        .play-button {
          background-color: #4CAF50; /* Green */
          color: white;
        }
        .play-button:hover {
          background-color: #45a049;
          transform: translateY(-1px);
        }
        .pause-button {
          background-color: #f44336; /* Red */
          color: white;
        }
        .pause-button:hover {
          background-color: #da3329;
          transform: translateY(-1px);
        }
        .header {
          text-align: center;
          padding-bottom: 1cqw;
          font-size: 1.2em;
          color: #61dafb;
          text-shadow: 0 0 5px rgba(97, 218, 251, 0.3);
        }
        canvas {
          width: 100%;
          flex-grow: 1;
          background: #222;
          border-radius: 6px;
          margin-top: 1cqw;
          box-shadow: inset 0 1px 3px rgba(0,0,0,0.3);
          min-height: 100px;
        }
        select {
          width: 100%;
          padding: 6px;
          border-radius: 4px;
          border: 1px solid #555;
          background-color: #444;
          color: #eee;
          -webkit-appearance: none;
          -moz-appearance: none;
          appearance: none;
          background-image: url('data:image/svg+xml;utf8,<svg fill="%23eee" height="24" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg"><path d="M7 10l5 5 5-5z"/><path d="M0 0h24v24H0z" fill="none"/></svg>');
          background-repeat: no-repeat;
          background-position: right 8px center;
          background-size: 16px;
          cursor: pointer;
        }
      </style>
      <div class="container">
        <div class="header">Rhythmic Filter Sweep</div>
        <button id="playPauseButton" class="${state.isPlaying ? 'pause-button' : 'play-button'}">
          ${state.isPlaying ? 'Stop' : 'Play'}
        </button>

        <div class="controls">
          <div class="control-group">
            <label for="mainFreq">Frequency <span id="mainFreqVal">${state.mainFreq.toFixed(0)} Hz</span></label>
            <input type="range" id="mainFreq" min="50" max="1000" value="${state.mainFreq}" step="1">
          </div>
          <div class="control-group">
            <label for="gain">Volume <span id="gainVal">${(state.gain * 100).toFixed(0)}%</span></label>
            <input type="range" id="gain" min="0" max="1" value="${state.gain}" step="0.01">
          </div>
          <div class="control-group">
            <label for="filterBaseFreq">Filter Base <span id="filterBaseFreqVal">${state.filterBaseFreq.toFixed(0)} Hz</span></label>
            <input type="range" id="filterBaseFreq" min="100" max="5000" value="${state.filterBaseFreq}" step="10">
          </div>
          <div class="control-group">
            <label for="filterLfoDepth">Filter LFO Depth <span id="filterLfoDepthVal">${state.filterLfoDepth.toFixed(0)} Hz</span></label>
            <input type="range" id="filterLfoDepth" min="0" max="2000" value="${state.filterLfoDepth}" step="10">
          </div>
          <div class="control-group">
            <label for="filterLfoFreq">Filter LFO Freq <span id="filterLfoFreqVal">${state.filterLfoFreq.toFixed(2)} Hz</span></label>
            <input type="range" id="filterLfoFreq" min="0.01" max="5" value="${state.filterLfoFreq}" step="0.01">
          </div>
          <div class="control-group">
            <label for="ampLfoDepth">Amp LFO Depth <span id="ampLfoDepthVal">${(state.ampLfoDepth * 100).toFixed(0)}%</span></label>
            <input type="range" id="ampLfoDepth" min="0" max="1" value="${state.ampLfoDepth}" step="0.01">
          </div>
          <div class="control-group">
            <label for="ampLfoBeatDiv">Amp LFO Div</label>
            <select id="ampLfoBeatDiv">
              <option value="4" ${state.ampLfoBeatDiv === 4 ? 'selected' : ''}>1/4 Beat</option>
              <option value="2" ${state.ampLfoBeatDiv === 2 ? 'selected' : ''}>1/2 Beat</option>
              <option value="1" ${state.ampLfoBeatDiv === 1 ? 'selected' : ''}>1 Beat</option>
              <option value="0.5" ${state.ampLfoBeatDiv === 0.5 ? 'selected' : ''}>2 Beats</option>
              <option value="0.25" ${state.ampLfoBeatDiv === 0.25 ? 'selected' : ''}>4 Beats</option>
            </select>
          </div>
        </div>
        <canvas id="visualizerCanvas"></canvas>
      </div>
    `;

    playPauseButton = domRoot.querySelector('#playPauseButton');
    canvas = domRoot.querySelector('#visualizerCanvas');
    ctx2d = canvas.getContext('2d');
    resizeCanvas();

    // Event Listeners
    playPauseButton.addEventListener('click', togglePlayPause);
    domRoot.querySelector('#mainFreq').addEventListener('input', updateMainFreq);
    domRoot.querySelector('#gain').addEventListener('input', updateGain);
    domRoot.querySelector('#filterBaseFreq').addEventListener('input', updateFilterBaseFreq);
    domRoot.querySelector('#filterLfoDepth').addEventListener('input', updateFilterLfoDepth);
    domRoot.querySelector('#filterLfoFreq').addEventListener('input', updateFilterLfoFreq);
    domRoot.querySelector('#ampLfoDepth').addEventListener('input', updateAmpLfoDepth);
    domRoot.querySelector('#ampLfoBeatDiv').addEventListener('change', updateAmpLfoBeatDiv);

    window.addEventListener('resize', resizeCanvas);
  };

  const resizeCanvas = () => {
    // Make canvas display size match its actual size for crisp rendering
    const displayWidth = canvas.clientWidth;
    const displayHeight = canvas.clientHeight;

    if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
      canvas.width = displayWidth;
      canvas.height = displayHeight;
    }
  };


  // --- Event Handlers & Global Publishes ---
  const togglePlayPause = () => {
    state.isPlaying = !state.isPlaying;
    if (state.isPlaying) {
      // Re-create the main oscillator and start it
      mainOscillator = audioCtx.createOscillator();
      mainOscillator.frequency.setValueAtTime(state.mainFreq, audioCtx.currentTime);
      mainOscillator.type = 'sine';
      mainOscillator.connect(filterNode);
      mainOscillator.start(audioCtx.currentTime);

      playPauseButton.textContent = 'Stop';
      playPauseButton.className = 'pause-button';
    } else {
      if (mainOscillator) {
        mainOscillator.stop(audioCtx.currentTime);
        mainOscillator.disconnect();
        mainOscillator = null;
      }
      playPauseButton.textContent = 'Play';
      playPauseButton.className = 'play-button';
    }
    bus.pubGlobal(`${instanceId}:isPlaying`, state.isPlaying);
  };

  const updateMainFreq = (e) => {
    state.mainFreq = parseFloat(e.target.value);
    if (mainOscillator) {
      mainOscillator.frequency.linearRampToValueAtTime(state.mainFreq, audioCtx.currentTime + 0.05);
    }
    domRoot.querySelector('#mainFreqVal').textContent = `${state.mainFreq.toFixed(0)} Hz`;
    bus.pubGlobal(`${instanceId}:mainFreq`, state.mainFreq);
  };

  const updateGain = (e) => {
    state.gain = parseFloat(e.target.value);
    if (mainGainNode) {
      mainGainNode.gain.linearRampToValueAtTime(state.gain, audioCtx.currentTime + 0.05);
    }
    domRoot.querySelector('#gainVal').textContent = `${(state.gain * 100).toFixed(0)}%`;
    bus.pubGlobal(`${instanceId}:gain`, state.gain);
  };

  const updateFilterBaseFreq = (e) => {
    state.filterBaseFreq = parseFloat(e.target.value);
    if (filterNode) {
      filterNode.frequency.linearRampToValueAtTime(state.filterBaseFreq, audioCtx.currentTime + 0.05);
    }
    domRoot.querySelector('#filterBaseFreqVal').textContent = `${state.filterBaseFreq.toFixed(0)} Hz`;
    bus.pubGlobal(`${instanceId}:filterBaseFreq`, state.filterBaseFreq);
  };

  const updateFilterLfoDepth = (e) => {
    state.filterLfoDepth = parseFloat(e.target.value);
    if (filterLfoGain) {
      filterLfoGain.gain.linearRampToValueAtTime(state.filterLfoDepth, audioCtx.currentTime + 0.05);
    }
    domRoot.querySelector('#filterLfoDepthVal').textContent = `${state.filterLfoDepth.toFixed(0)} Hz`;
    bus.pubGlobal(`${instanceId}:filterLfoDepth`, state.filterLfoDepth);
  };

  const updateFilterLfoFreq = (e) => {
    state.filterLfoFreq = parseFloat(e.target.value);
    if (filterLfo) {
      filterLfo.frequency.linearRampToValueAtTime(state.filterLfoFreq, audioCtx.currentTime + 0.05);
    }
    domRoot.querySelector('#filterLfoFreqVal').textContent = `${state.filterLfoFreq.toFixed(2)} Hz`;
    bus.pubGlobal(`${instanceId}:filterLfoFreq`, state.filterLfoFreq);
  };

  const updateAmpLfoDepth = (e) => {
    state.ampLfoDepth = parseFloat(e.target.value);
    if (ampLfoScaler && ampModGain) {
      // Update the scaler gain that determines LFO influence
      ampLfoScaler.gain.linearRampToValueAtTime(state.ampLfoDepth / 2, audioCtx.currentTime + 0.05);
      // Update the base gain of ampModGain
      ampModGain.gain.linearRampToValueAtTime(1 - state.ampLfoDepth / 2, audioCtx.currentTime + 0.05);
    }
    domRoot.querySelector('#ampLfoDepthVal').textContent = `${(state.ampLfoDepth * 100).toFixed(0)}%`;
    bus.pubGlobal(`${instanceId}:ampLfoDepth`, state.ampLfoDepth);
  };

  const updateAmpLfoBeatDiv = (e) => {
    state.ampLfoBeatDiv = parseFloat(e.target.value);
    // The frequency will be set by the clock tick, so no need to update it here.
    // Just publish the new beat division.
    bus.pubGlobal(`${instanceId}:ampLfoBeatDiv`, state.ampLfoBeatDiv);
  };

  // --- Clock Tick Handler ---
  const handleTick = ({ time, bpm }) => {
    if (!ampLfo) return; // Audio graph might not be fully initialized yet

    // Calculate LFO frequency based on BPM and beat division
    // Example: beatDiv = 1 means 1 cycle per beat. beatDiv = 2 means 1/2 cycle per beat (2 beats per cycle)
    const beatsPerSecond = bpm / 60;
    const lfoFreq = beatsPerSecond / state.ampLfoBeatDiv;
    ampLfo.frequency.linearRampToValueAtTime(lfoFreq, time);

    // Publish instantaneous values for local visualization
    if (filterNode && filterLfoGain) {
      // filterNode.frequency.value already reflects LFO modulation
      bus.pub(VISUAL_FILTER_CUTOFF, filterNode.frequency.value);
    }
    if (ampModGain) {
      // ampModGain.gain.value already reflects LFO modulation
      bus.pub(VISUAL_AMP_VALUE, ampModGain.gain.value);
    }
  };

  // --- Visuals Update ---
  let currentVisualFilterCutoff = state.filterBaseFreq;
  let currentVisualAmpValue = 1 - state.ampLfoDepth / 2; // Default base value

  // Subscribe to local bus for visualization data
  bus.sub(VISUAL_FILTER_CUTOFF, (val) => { currentVisualFilterCutoff = val; });
  bus.sub(VISUAL_AMP_VALUE, (val) => { currentVisualAmpValue = val; });

  const drawVisuals = () => {
    if (!ctx2d || !canvas) return;

    ctx2d.clearRect(0, 0, canvas.width, canvas.height);

    // Draw filter frequency line
    const maxFilterFreq = 5000; // Max frequency for filter slider
    // Invert Y-axis for visualization: higher frequency = higher on canvas
    const yCutoff = canvas.height * (1 - (currentVisualFilterCutoff / maxFilterFreq));
    ctx2d.strokeStyle = '#61dafb'; // Accent color
    ctx2d.lineWidth = 2;
    ctx2d.beginPath();
    ctx2d.moveTo(0, yCutoff);
    ctx2d.lineTo(canvas.width, yCutoff);
    ctx2d.stroke();

    ctx2d.fillStyle = '#e0e0e0';
    ctx2d.font = '10px sans-serif';
    ctx2d.textAlign = 'left';
    ctx2d.textBaseline = 'bottom';
    ctx2d.fillText(`Filter: ${currentVisualFilterCutoff.toFixed(0)} Hz`, 5, yCutoff - 2);


    // Draw amplitude pulse
    const baseAmp = 1 - state.ampLfoDepth; // Min gain possible with LFO
    const modulatedRange = state.ampLfoDepth;
    let normalizedAmp = 0;
    if (modulatedRange > 0.001) { // Avoid division by zero
      normalizedAmp = (currentVisualAmpValue - baseAmp) / modulatedRange;
      normalizedAmp = Math.max(0, Math.min(1, normalizedAmp)); // Clamp 0-1
    } else {
      normalizedAmp = 1; // If no modulation, it's always at base
    }

    const maxRadius = canvas.width / 3;
    const minRadius = maxRadius * 0.1; // Ensure a minimum radius
    const targetRadius = minRadius + (maxRadius - minRadius) * normalizedAmp;
    const center = { x: canvas.width / 2, y: canvas.height / 2 };

    ctx2d.fillStyle = `rgba(97, 218, 251, ${0.1 + normalizedAmp * 0.4})`; // Fades with amplitude
    ctx2d.beginPath();
    ctx2d.arc(center.x, center.y, targetRadius, 0, Math.PI * 2);
    ctx2d.fill();

    // Draw main oscillator frequency indicator
    const maxMainFreq = 1000; // Max main freq for slider
    const freqRatio = state.mainFreq / maxMainFreq;
    const barHeight = canvas.height * 0.08;
    ctx2d.fillStyle = '#4CAF50';
    ctx2d.fillRect(0, canvas.height - barHeight, canvas.width * freqRatio, barHeight);
    ctx2d.fillStyle = '#e0e0e0';
    ctx2d.textAlign = 'left';
    ctx2d.textBaseline = 'middle';
    ctx2d.fillText(`Osc: ${state.mainFreq.toFixed(0)} Hz`, 5, canvas.height - barHeight / 2);
  };

  // --- Initialize ---
  createAudioGraph(); // Creates all nodes, starts LFOs, but not mainOscillator if isPlaying is false
  createUI();
  tickUnsubscribe = clock.onTick(handleTick);

  // --- Return Lifecycle Hooks ---
  return {
    update(tick) {
      // Optional: per-frame animation (visuals only)
      drawVisuals();
    },
    getState() {
      // Optional: return serializable state
      return state;
    },
    destroy() {
      // Clean up everything you created! Stop oscillators, remove event listeners, unsubscribe from ticks
      destroyAudioGraph(true); // Full cleanup
      if (tickUnsubscribe) {
        tickUnsubscribe();
      }
      playPauseButton.removeEventListener('click', togglePlayPause);
      domRoot.querySelector('#mainFreq').removeEventListener('input', updateMainFreq);
      domRoot.querySelector('#gain').removeEventListener('input', updateGain);
      domRoot.querySelector('#filterBaseFreq').removeEventListener('input', updateFilterBaseFreq);
      domRoot.querySelector('#filterLfoDepth').removeEventListener('input', updateFilterLfoDepth);
      domRoot.querySelector('#filterLfoFreq').removeEventListener('input', updateFilterLfoFreq);
      domRoot.querySelector('#ampLfoDepth').removeEventListener('input', updateAmpLfoDepth);
      domRoot.querySelector('#ampLfoBeatDiv').removeEventListener('change', updateAmpLfoBeatDiv);
      window.removeEventListener('resize', resizeCanvas);

      bus.unsub(VISUAL_FILTER_CUTOFF);
      bus.unsub(VISUAL_AMP_VALUE);

      domRoot.innerHTML = ''; // Clean up DOM
    }
  };
}