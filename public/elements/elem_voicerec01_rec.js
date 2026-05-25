export default function setup(ctx, prevState) {
  const { audioCtx, audioOut, domRoot, clock } = ctx;

  const defaultState = {
    gain: 0.9,
    trimStart: 0,
    trimEnd: 1,
  };
  let state = { ...defaultState, ...prevState };

  let mediaStream = null;
  let mediaRecorder = null;
  let recordedChunks = [];
  let audioBuffer = prevState?.audioBuffer || null;
  let recordStartTime = 0;
  let recordTimerId = null;

  const outputGain = audioCtx.createGain();
  outputGain.gain.setValueAtTime(state.gain, audioCtx.currentTime);
  outputGain.connect(audioOut);

  const scheduledSources = new Set();
  let lastFiredStep = -1;
  let isPlaybackActive = false;

  let recordBtn, stopBtn, playBtn, statusEl, lengthEl, gainSlider, ledEl;
  let waveCanvas, waveCtx, trimStartHandle, trimEndHandle, trimRegion;

  function render() {
    domRoot.innerHTML = `
      <style>
        :host, .card { font-family: -apple-system, system-ui, sans-serif; color: #f4f4f5; }
        .card {
          background: linear-gradient(180deg, #1a1f2e 0%, #0f1320 100%);
          border-radius: 8px; padding: 10px 12px; height: 100%;
          box-sizing: border-box; display: flex; flex-direction: column;
          gap: 6px; overflow: hidden;
        }
        .title {
          font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase;
          color: #8b5cf6; display: flex; align-items: center; gap: 6px;
        }
        .led { width: 8px; height: 8px; border-radius: 50%; background: #3f3f46;
               transition: background 0.1s, box-shadow 0.1s; }
        .led.recording { background: #ef4444; box-shadow: 0 0 8px #ef4444;
                         animation: pulse 0.8s infinite alternate; }
        .led.playing { background: #22c55e; box-shadow: 0 0 8px #22c55e; }
        @keyframes pulse { from { opacity: 0.5; } to { opacity: 1; } }
        .row { display: flex; gap: 4px; }
        button {
          flex: 1; background: #27272a; color: #f4f4f5;
          border: 1px solid #3f3f46; border-radius: 4px;
          padding: 5px 6px; font-size: 10px; cursor: pointer;
          font-weight: 600; transition: background 0.1s;
        }
        button:hover:not(:disabled) { background: #3f3f46; }
        button:disabled { opacity: 0.4; cursor: not-allowed; }
        button.rec { color: #ef4444; }
        button.rec.active { background: #ef4444; color: white; }
        button.play { color: #22c55e; }
        button.play.active { background: #22c55e; color: white; }
        .status { font-size: 9px; color: #a1a1aa; line-height: 1.3; min-height: 11px; }
        .gain-row { display: flex; align-items: center; gap: 6px; font-size: 9px; color: #a1a1aa; }
        input[type=range] { flex: 1; accent-color: #8b5cf6; height: 12px; }
        .wave-wrap {
          position: relative; height: 56px;
          background: #0a0e1a; border: 1px solid #1f2937;
          border-radius: 3px; overflow: hidden; flex-shrink: 0;
        }
        .wave-wrap canvas { display: block; width: 100%; height: 100%; }
        .trim-region {
          position: absolute; top: 0; bottom: 0;
          background: rgba(139, 92, 246, 0.18);
          border-left: 2px solid #8b5cf6; border-right: 2px solid #8b5cf6;
          pointer-events: none;
        }
        .trim-handle {
          position: absolute; top: 0; bottom: 0;
          width: 10px; cursor: ew-resize; background: transparent;
        }
        .trim-handle::before {
          content: ''; position: absolute; top: 50%; left: 50%;
          transform: translate(-50%, -50%);
          width: 2px; height: 100%; background: #8b5cf6;
        }
        .trim-handle:hover::before { background: #a78bfa; width: 3px; }
      </style>
      <div class="card">
        <div class="title"><span class="led" id="led"></span> VOX · ska upbeats</div>
        <div class="wave-wrap" id="wave-wrap">
          <canvas id="wave"></canvas>
          <div class="trim-region" id="trim-region"></div>
          <div class="trim-handle" id="trim-start" style="left:0"></div>
          <div class="trim-handle" id="trim-end" style="right:0"></div>
        </div>
        <div class="row">
          <button class="rec" id="rec-btn">● REC</button>
          <button id="stop-btn" disabled>■ STOP</button>
          <button class="play" id="play-btn" disabled>▶ LOOP</button>
        </div>
        <div class="gain-row">
          <span>vol</span>
          <input type="range" id="gain" min="0" max="1.5" step="0.01" value="${state.gain}">
        </div>
        <div class="status" id="status">No clip yet. Hit REC, speak, then STOP.</div>
        <div class="status" id="length"></div>
      </div>
    `;
    recordBtn = domRoot.getElementById('rec-btn');
    stopBtn = domRoot.getElementById('stop-btn');
    playBtn = domRoot.getElementById('play-btn');
    statusEl = domRoot.getElementById('status');
    lengthEl = domRoot.getElementById('length');
    gainSlider = domRoot.getElementById('gain');
    ledEl = domRoot.getElementById('led');
    waveCanvas = domRoot.getElementById('wave');
    waveCtx = waveCanvas.getContext('2d');
    trimStartHandle = domRoot.getElementById('trim-start');
    trimEndHandle = domRoot.getElementById('trim-end');
    trimRegion = domRoot.getElementById('trim-region');

    recordBtn.addEventListener('click', startRecording);
    stopBtn.addEventListener('click', stopRecording);
    playBtn.addEventListener('click', togglePlayback);
    gainSlider.addEventListener('input', (e) => {
      state.gain = parseFloat(e.target.value);
      outputGain.gain.setTargetAtTime(state.gain, audioCtx.currentTime, 0.02);
    });

    setupTrimHandles();

    if (audioBuffer) {
      playBtn.disabled = false;
      requestAnimationFrame(() => { drawWaveform(); updateTrimUI(); });
      statusEl.textContent = 'Ready. LOOP fires on & of beats 2 & 4.';
    }
  }

  function setupTrimHandles() {
    const grabHandle = (handle, which) => {
      handle.addEventListener('mousedown', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (!audioBuffer) return;
        const wrap = waveCanvas.parentElement;
        const rect = wrap.getBoundingClientRect();
        const onMove = (ev) => {
          const x = Math.max(0, Math.min(rect.width, ev.clientX - rect.left));
          const frac = x / rect.width;
          if (which === 'start') state.trimStart = Math.min(frac, state.trimEnd - 0.01);
          else state.trimEnd = Math.max(frac, state.trimStart + 0.01);
          updateTrimUI();
        };
        const onUp = () => {
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      });
    };
    grabHandle(trimStartHandle, 'start');
    grabHandle(trimEndHandle, 'end');
  }

  function updateTrimUI() {
    const wrap = waveCanvas.parentElement;
    const w = wrap.clientWidth;
    trimStartHandle.style.left = `${state.trimStart * w - 5}px`;
    trimEndHandle.style.left = `${state.trimEnd * w - 5}px`;
    trimRegion.style.left = `${state.trimStart * w}px`;
    trimRegion.style.width = `${(state.trimEnd - state.trimStart) * w}px`;
    if (audioBuffer) {
      const trimmedLen = (state.trimEnd - state.trimStart) * audioBuffer.duration;
      lengthEl.textContent = `Clip ${audioBuffer.duration.toFixed(2)}s · trimmed ${trimmedLen.toFixed(2)}s`;
    }
  }

  function drawWaveform() {
    if (!audioBuffer || !waveCtx) return;
    const wrap = waveCanvas.parentElement;
    const dpr = window.devicePixelRatio || 1;
    const cssW = wrap.clientWidth, cssH = wrap.clientHeight;
    waveCanvas.width = cssW * dpr;
    waveCanvas.height = cssH * dpr;
    waveCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    waveCtx.fillStyle = '#0a0e1a';
    waveCtx.fillRect(0, 0, cssW, cssH);
    const data = audioBuffer.getChannelData(0);
    const samplesPerPixel = Math.max(1, Math.floor(data.length / cssW));
    waveCtx.strokeStyle = '#334155';
    waveCtx.beginPath();
    waveCtx.moveTo(0, cssH / 2);
    waveCtx.lineTo(cssW, cssH / 2);
    waveCtx.stroke();
    waveCtx.fillStyle = '#a78bfa';
    for (let x = 0; x < cssW; x++) {
      let min = 1, max = -1;
      const start = x * samplesPerPixel;
      const end = Math.min(data.length, start + samplesPerPixel);
      for (let i = start; i < end; i++) {
        const v = data[i];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      const y1 = ((1 - max) / 2) * cssH;
      const y2 = ((1 - min) / 2) * cssH;
      waveCtx.fillRect(x, y1, 1, Math.max(1, y2 - y1));
    }
  }

  async function startRecording() {
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      statusEl.textContent = 'Mic denied: ' + err.message;
      return;
    }
    recordedChunks = [];
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : (MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '');
    const opts = mime ? { mimeType: mime } : {};
    mediaRecorder = new MediaRecorder(mediaStream, opts);
    mediaRecorder.addEventListener('dataavailable', (e) => {
      if (e.data && e.data.size > 0) recordedChunks.push(e.data);
    });
    mediaRecorder.addEventListener('stop', onRecorderStopped);
    mediaRecorder.start(250);
    recordStartTime = performance.now();
    recordBtn.classList.add('active');
    stopBtn.disabled = false;
    recordBtn.disabled = true;
    playBtn.disabled = true;
    ledEl.classList.add('recording');
    statusEl.textContent = 'Recording 0.0s';
    recordTimerId = setInterval(() => {
      const elapsed = (performance.now() - recordStartTime) / 1000;
      statusEl.textContent = `Recording ${elapsed.toFixed(1)}s`;
    }, 100);
  }

  function stopRecording() {
    if (!mediaRecorder || mediaRecorder.state === 'inactive') return;
    mediaRecorder.stop();
  }

  async function onRecorderStopped() {
    recordBtn.classList.remove('active');
    ledEl.classList.remove('recording');
    recordBtn.disabled = false;
    stopBtn.disabled = true;
    if (recordTimerId) { clearInterval(recordTimerId); recordTimerId = null; }
    if (mediaStream) {
      mediaStream.getTracks().forEach(t => t.stop());
      mediaStream = null;
    }
    if (recordedChunks.length === 0) {
      statusEl.textContent = 'Nothing captured.';
      return;
    }
    statusEl.textContent = 'Decoding…';
    const blob = new Blob(recordedChunks, { type: recordedChunks[0].type });
    const arrayBuf = await blob.arrayBuffer();
    try {
      audioBuffer = await audioCtx.decodeAudioData(arrayBuf);
      state.trimStart = 0;
      state.trimEnd = 1;
      playBtn.disabled = false;
      drawWaveform();
      updateTrimUI();
      statusEl.textContent = 'Ready. LOOP fires on & of beats 2 & 4.';
    } catch (err) {
      statusEl.textContent = 'Decode failed: ' + err.message;
    }
  }

  function togglePlayback() {
    if (!audioBuffer) return;
    isPlaybackActive = !isPlaybackActive;
    if (isPlaybackActive) {
      playBtn.classList.add('active');
      ledEl.classList.add('playing');
      lastFiredStep = -1;
    } else {
      playBtn.classList.remove('active');
      ledEl.classList.remove('playing');
      scheduledSources.forEach(src => {
        try { src.stop(); } catch (e) {}
      });
      scheduledSources.clear();
    }
  }

  const unsubTick = clock.onTick(({ step, time }) => {
    if (!isPlaybackActive || !audioBuffer) return;
    if (step === lastFiredStep) return;
    if (step % 8 !== 6) return;
    lastFiredStep = step;

    const startSec = state.trimStart * audioBuffer.duration;
    const trimmedDur = (state.trimEnd - state.trimStart) * audioBuffer.duration;
    if (trimmedDur <= 0.005) return;

    const src = audioCtx.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(outputGain);
    src.start(time, startSec, trimmedDur);
    scheduledSources.add(src);
    src.addEventListener('ended', () => scheduledSources.delete(src));
  });

  render();

  const resizeObserver = new ResizeObserver(() => {
    if (audioBuffer) { drawWaveform(); updateTrimUI(); }
  });
  resizeObserver.observe(waveCanvas.parentElement);

  return {
    getState() {
      return { ...state, audioBuffer };
    },
    destroy() {
      if (unsubTick) unsubTick();
      if (recordTimerId) clearInterval(recordTimerId);
      if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        try { mediaRecorder.stop(); } catch (e) {}
      }
      if (mediaStream) {
        mediaStream.getTracks().forEach(t => t.stop());
      }
      scheduledSources.forEach(src => {
        try { src.stop(); } catch (e) {}
      });
      try { outputGain.disconnect(); } catch (e) {}
      try { resizeObserver.disconnect(); } catch (e) {}
    }
  };
}
