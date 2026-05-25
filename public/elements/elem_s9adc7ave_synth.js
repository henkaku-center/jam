export default function setup(ctx, prevState) {
  const { audioCtx, audioOut, bus, domRoot, clock } = ctx;

  // --- State Management ---
  let state = {
    isOn: false,
    filterFrequency: 2000, // Hz
    filterQ: 1,            // Filter Q for resonance
    volume: 0.2,
    canvasWidth: 300,
    canvasHeight: 150,
    minFrequency: 50,      // Adjusted min frequency for wider range
    maxFrequency: 12000,   // Adjusted max frequency for wider range
    minQ: 0.1,             // Min Q for filter
    maxQ: 20,              // Max Q for filter
    minVolume: 0,
    maxVolume: 1,
  };

  // Restore state from prevState if available
  if (prevState) {
    // Basic state merge. For complex schema changes, add translation logic here.
    state = { ...state, ...prevState };
  }

  // --- Audio Nodes ---
  let noiseBufferSource = null;
  let filterNode = null;
  let gainNode = null;

  function createNoiseBuffer() {
    const bufferSize = audioCtx.sampleRate * 2; // 2 seconds of noise
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const output = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1; // White noise from -1 to 1
    }
    return buffer;
  }

  function setupAudio() {
    // Clean up any existing nodes if this function is called multiple times without destroy
    if (noiseBufferSource) { noiseBufferSource.stop(); noiseBufferSource.disconnect(); }
    if (filterNode) filterNode.disconnect();
    if (gainNode) gainNode.disconnect();

    // Create nodes
    noiseBufferSource = audioCtx.createBufferSource();
    noiseBufferSource.buffer = createNoiseBuffer();
    noiseBufferSource.loop = true; // Loop the buffer continuously
    noiseBufferSource.start(0); // Start immediately, control audibility with gainNode

    filterNode = audioCtx.createBiquadFilter();
    filterNode.type = 'lowpass';
    filterNode.frequency.setValueAtTime(state.filterFrequency, audioCtx.currentTime);
    filterNode.Q.setValueAtTime(state.filterQ, audioCtx.currentTime);

    gainNode = audioCtx.createGain();
    // Set initial gain based on state.isOn. If off, set to 0.
    gainNode.gain.setValueAtTime(state.isOn ? state.volume : 0, audioCtx.currentTime);

    // Connections
    noiseBufferSource.connect(filterNode);
    filterNode.connect(gainNode);
    gainNode.connect(audioOut); // Connect to the parent spatial output
  }

  function toggleAudio(isOn) {
    const now = audioCtx.currentTime;
    if (isOn) {
      gainNode.gain.cancelScheduledValues(now);
      gainNode.gain.linearRampToValueAtTime(state.volume, now + 0.05); // Fade in
    } else {
      gainNode.gain.cancelScheduledValues(now);
      gainNode.gain.linearRampToValueAtTime(0, now + 0.05); // Fade out
    }
    state.isOn = isOn; // Update internal state
  }

  function setFilterFrequency(freq) {
    state.filterFrequency = freq;
    const now = audioCtx.currentTime;
    filterNode.frequency.cancelScheduledValues(now);
    filterNode.frequency.exponentialRampToValueAtTime(freq, now + 0.05); // Smooth exponential ramp
  }

  function setFilterQ(q) {
    state.filterQ = q;
    const now = audioCtx.currentTime;
    filterNode.Q.cancelScheduledValues(now);
    filterNode.Q.linearRampToValueAtTime(q, now + 0.05); // Smooth linear ramp
  }

  function setVolume(vol) {
    state.volume = vol;
    // Only apply if sound is currently on, otherwise the gain is 0 (controlled by toggleAudio)
    if (state.isOn) {
      const now = audioCtx.currentTime;
      gainNode.gain.cancelScheduledValues(now);
      gainNode.gain.linearRampToValueAtTime(vol, now + 0.05);
    }
  }

  // --- UI Elements ---
  const style = document.createElement('style');
  style.textContent = `
    :host {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      font-family: 'Segoe UI', sans-serif;
      color: #e0e0e0;
      background: #2a2a2a;
      border-radius: 8px;
      padding: 15px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
      width: fit-content;
      margin: 10px;
      min-width: 280px;
    }
    h3 {
      color: #90caf9;
      margin-top: 0;
      margin-bottom: 15px;
      font-weight: 400;
      letter-spacing: 0.5px;
    }
    .controls {
      display: flex;
      flex-direction: column;
      gap: 12px;
      width: 100%;
      align-items: center;
    }
    .control-group {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      max-width: 250px;
    }
    button {
      background-color: #4CAF50;
      color: white;
      border: none;
      padding: 10px 15px;
      border-radius: 5px;
      cursor: pointer;
      font-size: 1em;
      transition: background-color 0.2s ease, transform 0.1s ease;
      min-width: 80px;
    }
    button:hover {
      background-color: #45a049;
      transform: translateY(-1px);
    }
    button:active {
      transform: translateY(0);
    }
    button.off {
      background-color: #f44336;
    }
    button.off:hover {
      background-color: #da190b;
    }
    input[type="range"] {
      -webkit-appearance: none;
      width: 150px;
      height: 8px;
      background: #555;
      outline: none;
      opacity: 0.7;
      transition: opacity .2s;
      border-radius: 5px;
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
      background: #007bff;
      cursor: pointer;
      transition: background 0.2s ease, transform 0.1s ease;
    }
    input[type="range"]::-webkit-slider-thumb:hover {
      background: #0056b3;
      transform: scale(1.1);
    }
    label {
      min-width: 80px;
      text-align: right;
      margin-right: 10px;
      color: #bbbbbb;
      font-size: 0.9em;
    }
    canvas {
      border: 1px solid #444;
      background-color: #1a1a1a;
      border-radius: 4px;
      margin-top: 20px;
      box-shadow: inset 0 0 5px rgba(0,0,0,0.5);
    }
  `;
  domRoot.appendChild(style);

  const container = document.createElement('div');
  container.className = 'noise-generator-app';

  const title = document.createElement('h3');
  title.textContent = 'Spatial White Noise';
  container.appendChild(title);

  const controlsDiv = document.createElement('div');
  controlsDiv.className = 'controls';

  // Power Toggle
  const toggleGroup = document.createElement('div');
  toggleGroup.className = 'control-group';
  const toggleButton = document.createElement('button');
  toggleButton.textContent = state.isOn ? 'STOP' : 'PLAY';
  toggleButton.className = state.isOn ? '' : 'off';
  toggleGroup.appendChild(document.createElement('label')).textContent = 'Power:';
  toggleGroup.appendChild(toggleButton);
  controlsDiv.appendChild(toggleGroup);

  // Filter Frequency Slider
  const filterGroup = document.createElement('div');
  filterGroup.className = 'control-group';
  const filterSlider = document.createElement('input');
  filterSlider.type = 'range';
  filterSlider.min = state.minFrequency;
  filterSlider.max = state.maxFrequency;
  filterSlider.value = state.filterFrequency;
  filterSlider.step = 10;
  const filterLabel = document.createElement('label');
  filterLabel.textContent = `Filter Freq: ${state.filterFrequency.toFixed(0)} Hz`;
  filterGroup.appendChild(filterLabel);
  filterGroup.appendChild(filterSlider);
  controlsDiv.appendChild(filterGroup);

  // Filter Q Slider
  const filterQGroup = document.createElement('div');
  filterQGroup.className = 'control-group';
  const filterQSlider = document.createElement('input');
  filterQSlider.type = 'range';
  filterQSlider.min = state.minQ;
  filterQSlider.max = state.maxQ;
  filterQSlider.value = state.filterQ;
  filterQSlider.step = 0.1;
  const filterQLabel = document.createElement('label');
  filterQLabel.textContent = `Filter Q: ${state.filterQ.toFixed(1)}`;
  filterQGroup.appendChild(filterQLabel);
  filterQGroup.appendChild(filterQSlider);
  controlsDiv.appendChild(filterQGroup);

  // Volume Slider
  const volumeGroup = document.createElement('div');
  volumeGroup.className = 'control-group';
  const volumeSlider = document.createElement('input');
  volumeSlider.type = 'range';
  volumeSlider.min = state.minVolume;
  volumeSlider.max = state.maxVolume;
  volumeSlider.value = state.volume;
  volumeSlider.step = 0.01;
  const volumeLabel = document.createElement('label');
  volumeLabel.textContent = `Volume: ${(state.volume * 100).toFixed(0)}%`;
  volumeGroup.appendChild(volumeLabel);
  volumeGroup.appendChild(volumeSlider);
  controlsDiv.appendChild(volumeGroup);

  container.appendChild(controlsDiv);

  const canvas = document.createElement('canvas');
  canvas.width = state.canvasWidth;
  canvas.height = state.canvasHeight;
  const ctx2d = canvas.getContext('2d');
  container.appendChild(canvas);

  domRoot.appendChild(container);

  // --- Event Listeners ---
  const eventListeners = []; // To keep track for cleanup

  const handleToggleClick = () => {
    state.isOn = !state.isOn;
    toggleButton.textContent = state.isOn ? 'STOP' : 'PLAY';
    toggleButton.className = state.isOn ? '' : 'off';
    toggleAudio(state.isOn);
    // Broadcast state globally for synchronization with the Host machine
    bus.pubGlobal('noise_sound_on', state.isOn);
  };
  toggleButton.addEventListener('click', handleToggleClick);
  eventListeners.push({ element: toggleButton, event: 'click', handler: handleToggleClick });

  const handleFilterInput = (e) => {
    const freq = parseFloat(e.target.value);
    setFilterFrequency(freq);
    filterLabel.textContent = `Filter Freq: ${freq.toFixed(0)} Hz`;
    // Broadcast state globally
    bus.pubGlobal('noise_filter_cutoff', freq);
  };
  filterSlider.addEventListener('input', handleFilterInput);
  eventListeners.push({ element: filterSlider, event: 'input', handler: handleFilterInput });

  const handleFilterQInput = (e) => {
    const q = parseFloat(e.target.value);
    setFilterQ(q);
    filterQLabel.textContent = `Filter Q: ${q.toFixed(1)}`;
    // Broadcast state globally
    bus.pubGlobal('noise_filter_q', q);
  };
  filterQSlider.addEventListener('input', handleFilterQInput);
  eventListeners.push({ element: filterQSlider, event: 'input', handler: handleFilterQInput });

  const handleVolumeInput = (e) => {
    const vol = parseFloat(e.target.value);
    setVolume(vol);
    volumeLabel.textContent = `Volume: ${(vol * 100).toFixed(0)}%`;
    // Broadcast state globally
    bus.pubGlobal('noise_volume', vol);
  };
  volumeSlider.addEventListener('input', handleVolumeInput);
  eventListeners.push({ element: volumeSlider, event: 'input', handler: handleVolumeInput });


  // --- Bus Subscriptions for Remote Control ---
  const busSubscriptions = [];

  const subSoundOn = bus.subGlobal('noise_sound_on', (isOn) => {
    if (state.isOn !== isOn) { // Only update if value changed to avoid unnecessary re-renders/audio param calls
      state.isOn = isOn;
      toggleButton.textContent = state.isOn ? 'STOP' : 'PLAY';
      toggleButton.className = state.isOn ? '' : 'off';
      toggleAudio(isOn); // Pass the received value directly
    }
  });
  busSubscriptions.push(() => bus.unsubGlobal('noise_sound_on', subSoundOn));

  const subFilterCutoff = bus.subGlobal('noise_filter_cutoff', (freq) => {
    if (state.filterFrequency !== freq) {
      setFilterFrequency(freq);
      filterSlider.value = freq;
      filterLabel.textContent = `Filter Freq: ${freq.toFixed(0)} Hz`;
    }
  });
  busSubscriptions.push(() => bus.unsubGlobal('noise_filter_cutoff', subFilterCutoff));

  const subFilterQ = bus.subGlobal('noise_filter_q', (q) => {
    if (state.filterQ !== q) {
      setFilterQ(q);
      filterQSlider.value = q;
      filterQLabel.textContent = `Filter Q: ${q.toFixed(1)}`;
    }
  });
  busSubscriptions.push(() => bus.unsubGlobal('noise_filter_q', subFilterQ));

  const subVolume = bus.subGlobal('noise_volume', (vol) => {
    if (state.volume !== vol) {
      setVolume(vol);
      volumeSlider.value = vol;
      volumeLabel.textContent = `Volume: ${(vol * 100).toFixed(0)}%`;
    }
  });
  busSubscriptions.push(() => bus.unsubGlobal('noise_volume', subVolume));


  // --- Visuals ---
  function drawVisuals(animationTime) {
    ctx2d.clearRect(0, 0, canvas.width, canvas.height);

    // Background gradient
    const bgGradient = ctx2d.createLinearGradient(0, 0, canvas.width, canvas.height);
    bgGradient.addColorStop(0, '#2a2a2a');
    bgGradient.addColorStop(1, '#1a1a1a');
    ctx2d.fillStyle = bgGradient;
    ctx2d.fillRect(0, 0, canvas.width, canvas.height);

    // Filter frequency indicator (dynamic bar/line)
    const freqNorm = (state.filterFrequency - state.minFrequency) / (state.maxFrequency - state.minFrequency);
    const barHeight = 8;
    const barY = canvas.height - barHeight - 10;
    const barWidth = canvas.width * freqNorm;

    ctx2d.fillStyle = `hsl(${freqNorm * 120}, 70%, 50%)`; // Green to Yellow/Red based on freq
    ctx2d.fillRect(0, barY, barWidth, barHeight);

    // Filter Q indicator (line thickness / glow)
    const qNorm = (state.filterQ - state.minQ) / (state.maxQ - state.minQ);
    ctx2d.strokeStyle = `rgba(255, 255, 255, ${0.1 + qNorm * 0.2})`;
    ctx2d.lineWidth = 1 + qNorm * 3; // Thicker line for higher Q
    ctx2d.beginPath();
    ctx2d.moveTo(0, barY - 10);
    ctx2d.lineTo(canvas.width, barY - 10);
    ctx2d.stroke();

    // Pulsing central circle for volume and activity
    if (state.isOn) {
      const pulse = Math.sin(animationTime * 5) * 0.5 + 0.5; // 0 to 1
      const radius = 20 + (state.volume * 30 * pulse);
      ctx2d.beginPath();
      ctx2d.arc(canvas.width / 2, canvas.height / 2, radius, 0, Math.PI * 2);
      ctx2d.fillStyle = `rgba(0, 123, 255, ${0.4 + state.volume * 0.3})`; // Blue color, brighter with volume
      ctx2d.shadowColor = 'rgba(0, 123, 255, 0.8)';
      ctx2d.shadowBlur = radius / 4;
      ctx2d.fill();
      ctx2d.shadowBlur = 0; // Reset shadow
    } else {
      // Small static circle when off
      ctx2d.beginPath();
      ctx2d.arc(canvas.width / 2, canvas.height / 2, 10, 0, Math.PI * 2);
      ctx2d.fillStyle = 'rgba(100, 100, 100, 0.3)';
      ctx2d.fill();
    }

    // A subtle moving 'wave' or 'grain' effect
    ctx2d.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx2d.lineWidth = 1;
    ctx2d.beginPath();
    for(let i=0; i<canvas.width; i+=10) {
        const offset = Math.sin((i + animationTime * 20) * 0.05) * 5;
        ctx2d.moveTo(i, 0);
        ctx2d.lineTo(i + offset, canvas.height);
    }
    ctx2d.stroke();
  }

  // --- Initialization ---
  setupAudio();
  // Ensure initial UI state matches audio state, and values are propagated
  // These calls will also apply the values to the audio nodes and update labels
  toggleAudio(state.isOn);
  setFilterFrequency(state.filterFrequency);
  setFilterQ(state.filterQ);
  setVolume(state.volume);

  // --- Lifecycle Hooks ---
  return {
    update(tick) {
      // This is called by the framework's own requestAnimationFrame loop for visuals
      drawVisuals(tick.time); // Pass the current time for animation
    },
    getState() {
      // Return current serializable state for persistence
      return {
        isOn: state.isOn,
        filterFrequency: state.filterFrequency,
        filterQ: state.filterQ,
        volume: state.volume,
        canvasWidth: state.canvasWidth,
        canvasHeight: state.canvasHeight,
        minFrequency: state.minFrequency,
        maxFrequency: state.maxFrequency,
        minQ: state.minQ,
        maxQ: state.maxQ,
        minVolume: state.minVolume,
        maxVolume: state.maxVolume,
      };
    },
    destroy() {
      // Stop audio source
      if (noiseBufferSource) {
        noiseBufferSource.stop(); // Stop the continuous buffer playback
        noiseBufferSource.disconnect();
        noiseBufferSource = null;
      }

      // Disconnect all nodes
      if (filterNode) {
        filterNode.disconnect();
        filterNode = null;
      }
      if (gainNode) {
        gainNode.disconnect();
        gainNode = null;
      }

      // Remove UI elements from the DOM
      if (container.parentNode === domRoot) {
        domRoot.removeChild(container);
      }
      if (style.parentNode === domRoot) {
        domRoot.removeChild(style);
      }

      // Remove all registered event listeners
      eventListeners.forEach(({ element, event, handler }) => {
        element.removeEventListener(event, handler);
      });
      eventListeners.length = 0; // Clear array for garbage collection

      // Unsubscribe from all bus events
      busSubscriptions.forEach(unsub => unsub());
      busSubscriptions.length = 0; // Clear array for garbage collection
    }
  };
}