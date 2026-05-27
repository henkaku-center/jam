// House Voice Clip Sampler Element
export default function setup(ctx, prevState) {
  const dom = ctx.domRoot;
  const arrangementLength = 64;
  const defaultVoicePattern = [1, 0, 0, 0.5, 0, 0, 0.7, 0, 0, 0.45, 0, 0, 1, 0, 0.55, 0];
  const clipColors = ['#f472b6', '#38bdf8', '#a3e635', '#facc15', '#c084fc', '#fb7185', '#2dd4bf', '#fb923c'];

  const cloneArrangement = (arrangement) => {
    const source = Array.isArray(arrangement) ? arrangement : [];
    return Array.from({ length: arrangementLength }, (_, index) => {
      const value = source[index];
      if (value && typeof value === 'object' && value.clipId) {
        return {
          clipId: String(value.clipId),
          velocity: Number.isFinite(value.velocity) ? value.velocity : 1
        };
      }
      if (typeof value === 'string') return { clipId: value, velocity: 1 };
      return null;
    });
  };

  const migrateArrangement = () => {
    if (Array.isArray(prevState?.arrangement)) return cloneArrangement(prevState.arrangement);
    const source = Array.isArray(prevState?.pattern) ? prevState.pattern : defaultVoicePattern;
    const arrangement = Array.from({ length: arrangementLength }, () => null);
    for (let bar = 0; bar < 4; bar += 1) {
      source.forEach((velocity, index) => {
        if (velocity) arrangement[bar * 16 + index] = { clipId: 'clip_1', velocity };
      });
    }
    return arrangement;
  };

  const state = {
    enabled: prevState?.enabled ?? true,
    clipMeta: Array.isArray(prevState?.clipMeta) ? prevState.clipMeta.slice(0, 8) : [],
    selectedClipId: prevState?.selectedClipId || null,
    arrangement: migrateArrangement(),
    rate: Number.isFinite(prevState?.rate) ? prevState.rate : 0.92,
    tone: Number.isFinite(prevState?.tone) ? prevState.tone : 0.38,
    drive: Number.isFinite(prevState?.drive) ? prevState.drive : 0.42,
    echo: Number.isFinite(prevState?.echo) ? prevState.echo : 0.18,
    space: Number.isFinite(prevState?.space) ? prevState.space : 0.12,
    launch: prevState?.launch === 'slice' ? 'slice' : 'clip'
  };

  if (!state.selectedClipId && state.clipMeta[0]) state.selectedClipId = state.clipMeta[0].id;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const now = () => ctx.audioCtx.currentTime;
  const randomFor = (step, salt) => {
    const raw = Math.sin((step + 1) * 111.17 + salt * 271.31) * 43758.5453;
    return raw - Math.floor(raw);
  };
  const clipBuffers = new Map();
  const formatDuration = (duration) => Number.isFinite(duration) ? `${duration.toFixed(1)}s` : 'local only';
  const findClip = (id) => state.clipMeta.find((clip) => clip.id === id);
  const selectedClip = () => findClip(state.selectedClipId);
  const selectedColor = () => selectedClip()?.color || clipColors[0];

  let stream = null;
  let micSource = null;
  let recorder = null;
  let recorderSink = null;
  let recording = false;
  let recordChunks = [];
  let recordFrames = 0;
  let currentStep = -1;
  let pulse = 0;
  let status = state.clipMeta.length ? 'Re-record clips locally' : 'No clips';

  const output = ctx.audioCtx.createGain();
  const delaySend = ctx.audioCtx.createGain();
  const delay = ctx.audioCtx.createDelay(1);
  const delayFeedback = ctx.audioCtx.createGain();
  const delayFilter = ctx.audioCtx.createBiquadFilter();
  const convolver = ctx.audioCtx.createConvolver();
  const reverbSend = ctx.audioCtx.createGain();
  const reverbGain = ctx.audioCtx.createGain();
  const analyser = ctx.audioCtx.createAnalyser();

  output.gain.setValueAtTime(0.8, now());
  delay.delayTime.setValueAtTime(0.19, now());
  delayFeedback.gain.setValueAtTime(0.28, now());
  delayFilter.type = 'lowpass';
  delayFilter.frequency.setValueAtTime(3600, now());
  analyser.fftSize = 256;

  const impulse = ctx.audioCtx.createBuffer(2, Math.floor(ctx.audioCtx.sampleRate * 0.9), ctx.audioCtx.sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < data.length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / data.length, 2.8) * 0.46;
    }
  }
  convolver.buffer = impulse;

  output.connect(analyser);
  analyser.connect(ctx.audioOut);
  delaySend.connect(delay);
  delay.connect(delayFilter);
  delayFilter.connect(delayFeedback);
  delayFeedback.connect(delay);
  delayFilter.connect(output);
  reverbSend.connect(convolver);
  convolver.connect(reverbGain);
  reverbGain.connect(output);

  const makeShaper = (amount) => {
    const curve = new Float32Array(1024);
    const k = 1 + amount * 26;
    for (let i = 0; i < curve.length; i += 1) {
      const x = i * 2 / curve.length - 1;
      curve[i] = Math.tanh(k * x) / Math.tanh(k);
    }
    return curve;
  };

  const updateFx = () => {
    const t = now();
    delaySend.gain.setTargetAtTime(state.echo, t, 0.03);
    delayFeedback.gain.setTargetAtTime(0.16 + state.echo * 0.48, t, 0.03);
    reverbSend.gain.setTargetAtTime(state.space, t, 0.03);
    reverbGain.gain.setTargetAtTime(0.28 + state.space * 0.22, t, 0.04);
  };

  const flattenRecording = () => {
    if (!recordFrames) return null;
    const merged = new Float32Array(recordFrames);
    let offset = 0;
    recordChunks.forEach((chunk) => {
      merged.set(chunk, offset);
      offset += chunk.length;
    });

    const trimThreshold = 0.012;
    let start = 0;
    let end = merged.length - 1;
    while (start < merged.length && Math.abs(merged[start]) < trimThreshold) start += 1;
    while (end > start && Math.abs(merged[end]) < trimThreshold) end -= 1;
    const trimmed = merged.slice(Math.max(0, start - 128), Math.min(merged.length, end + 2048));
    if (trimmed.length < ctx.audioCtx.sampleRate * 0.08) return null;

    const buffer = ctx.audioCtx.createBuffer(1, trimmed.length, ctx.audioCtx.sampleRate);
    buffer.copyToChannel(trimmed, 0);
    return buffer;
  };

  const ensureMic = async () => {
    if (stream) return true;
    if (!navigator.mediaDevices?.getUserMedia) {
      status = 'Mic unavailable';
      render();
      return false;
    }

    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    });
    micSource = ctx.audioCtx.createMediaStreamSource(stream);
    recorder = ctx.audioCtx.createScriptProcessor(2048, 1, 1);
    recorderSink = ctx.audioCtx.createGain();
    recorderSink.gain.value = 0;
    recorder.onaudioprocess = (event) => {
      if (!recording) return;
      const input = event.inputBuffer.getChannelData(0);
      recordChunks.push(new Float32Array(input));
      recordFrames += input.length;
    };
    micSource.connect(recorder);
    recorder.connect(recorderSink);
    recorderSink.connect(ctx.audioOut);
    status = 'Mic ready';
    render();
    return true;
  };

  const publishClipState = () => {
    ctx.bus.pubGlobal('voice_clip_meta', state.clipMeta);
    ctx.bus.pubGlobal('voice_selected_clip', state.selectedClipId);
  };

  const defaultPlacementsFor = (clipId) => {
    const arrangementHasEvents = state.arrangement.some(Boolean);
    if (arrangementHasEvents) return;
    [0, 6, 12, 19, 24, 35, 48, 54, 60].forEach((index) => {
      state.arrangement[index] = { clipId, velocity: index % 12 === 0 ? 1 : 0.72 };
    });
    ctx.bus.pubGlobal('voice_arrangement', state.arrangement);
  };

  const startRecording = async () => {
    try {
      await ctx.audioCtx.resume();
      const ready = await ensureMic();
      if (!ready) return;
      recordChunks = [];
      recordFrames = 0;
      recording = true;
      status = 'Recording...';
      render();
    } catch (error) {
      status = 'Mic blocked';
      render();
      console.error('[House Voice] Mic error:', error);
    }
  };

  const stopRecording = () => {
    recording = false;
    const nextBuffer = flattenRecording();
    if (nextBuffer) {
      const nameInput = dom.querySelector('#clip-name');
      const index = state.clipMeta.length + 1;
      const name = String(nameInput?.value || '').trim() || `voice ${index}`;
      const existingId = state.selectedClipId && !clipBuffers.has(state.selectedClipId) ? state.selectedClipId : null;
      const id = existingId || `clip_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`;
      const existingMetaIndex = state.clipMeta.findIndex((clip) => clip.id === id);
      const meta = {
        id,
        name: name.slice(0, 16),
        color: state.clipMeta[existingMetaIndex]?.color || clipColors[state.clipMeta.length % clipColors.length],
        duration: nextBuffer.duration
      };
      clipBuffers.set(id, nextBuffer);
      if (existingMetaIndex >= 0) state.clipMeta[existingMetaIndex] = meta;
      else state.clipMeta.push(meta);
      state.selectedClipId = id;
      status = `${meta.name} ${formatDuration(meta.duration)}`;
      publishClipState();
      defaultPlacementsFor(id);
    } else {
      status = 'Too quiet';
    }
    recordChunks = [];
    recordFrames = 0;
    render();
  };

  const playClip = (clipId, time, step, velocity, duration) => {
    const buffer = clipBuffers.get(clipId);
    if (!buffer || !state.enabled) return;
    const t = Math.max(time, now() + 0.004);
    const source = ctx.audioCtx.createBufferSource();
    const highpass = ctx.audioCtx.createBiquadFilter();
    const lowpass = ctx.audioCtx.createBiquadFilter();
    const shaper = ctx.audioCtx.createWaveShaper();
    const gain = ctx.audioCtx.createGain();
    const pan = ctx.audioCtx.createStereoPanner();

    const pitchSet = [1, 0.944, 1, 1.122, 0.84, 1];
    const pitch = pitchSet[step % pitchSet.length] * state.rate;
    const sliceCount = 8;
    const sliceDuration = buffer.duration / sliceCount;
    const sliceIndex = Math.floor((step * 3 + (step % 4 === 2 ? 1 : 0)) % sliceCount);
    const offset = state.launch === 'slice'
      ? clamp(sliceIndex * sliceDuration + randomFor(step, 4) * Math.min(0.025, sliceDuration * 0.12), 0, Math.max(0, buffer.duration - 0.04))
      : 0;
    const maxDuration = state.launch === 'slice' ? sliceDuration * 0.92 : Math.min(buffer.duration, duration * 3.8);
    const playDuration = Math.min(maxDuration, buffer.duration - offset);

    source.buffer = buffer;
    source.playbackRate.setValueAtTime(pitch, t);
    highpass.type = 'highpass';
    highpass.frequency.setValueAtTime(120 + state.drive * 260, t);
    lowpass.type = 'lowpass';
    lowpass.frequency.setValueAtTime(1200 + state.tone * 6500, t);
    lowpass.Q.setValueAtTime(3.4 + state.drive * 5, t);
    shaper.curve = makeShaper(state.drive);
    shaper.oversample = '4x';
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.58 * velocity, t + 0.012);
    gain.gain.setTargetAtTime(0.0001, t + playDuration * 0.78, 0.045);
    pan.pan.setValueAtTime((randomFor(step, 9) - 0.5) * 0.46, t);

    source.connect(highpass);
    highpass.connect(lowpass);
    lowpass.connect(shaper);
    shaper.connect(gain);
    gain.connect(pan);
    pan.connect(output);
    pan.connect(delaySend);
    pan.connect(reverbSend);

    source.start(t, offset, Math.max(0.02, playDuration));
    source.stop(t + playDuration + 0.08);
    setTimeout(() => {
      [source, highpass, lowpass, shaper, gain, pan].forEach((node) => {
        try { node.disconnect(); } catch (e) {}
      });
    }, Math.max(100, (t + playDuration + 0.1 - now()) * 1000));
  };

  const render = () => {
    const clipOptions = state.clipMeta.map((clip, index) => {
      const local = clipBuffers.has(clip.id) ? '' : ' *';
      return `<option value="${clip.id}" ${clip.id === state.selectedClipId ? 'selected' : ''}>${index + 1}. ${clip.name}${local}</option>`;
    }).join('');

    dom.innerHTML = `
      <style>
        .sampler {
          width: 260px;
          height: 200px;
          box-sizing: border-box;
          padding: 7px;
          background: #120f16;
          border: 1px solid ${selectedColor()};
          border-radius: 8px;
          color: #f8fafc;
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          overflow: hidden;
          box-shadow: 0 8px 24px rgba(244, 114, 182, 0.2);
        }
        h3 {
          margin: 0 0 4px;
          color: #f9a8d4;
          font-size: 11px;
          text-align: center;
          letter-spacing: 0;
        }
        .scope {
          height: 32px;
          background: #07060a;
          border: 1px solid #3f2636;
          border-radius: 5px;
          overflow: hidden;
          margin-bottom: 5px;
        }
        canvas {
          display: block;
          width: 100%;
          height: 100%;
        }
        .clip-row {
          display: grid;
          grid-template-columns: 1fr 54px;
          gap: 5px;
          margin-bottom: 4px;
        }
        .select-row {
          display: grid;
          grid-template-columns: 1fr 48px 48px;
          gap: 5px;
          margin-bottom: 5px;
        }
        input[type="text"],
        select {
          min-width: 0;
          height: 20px;
          box-sizing: border-box;
          border: 1px solid #5b294d;
          border-radius: 4px;
          background: #1d1020;
          color: #fce7f3;
          font: inherit;
          font-size: 9px;
          padding: 1px 4px;
        }
        button {
          height: 20px;
          min-width: 0;
          border: 1px solid ${selectedColor()};
          border-radius: 4px;
          background: #251322;
          color: #fce7f3;
          font: inherit;
          font-size: 8px;
          cursor: pointer;
          padding: 0 3px;
        }
        button.hot {
          background: ${recording ? '#be123c' : selectedColor()};
          color: #180913;
        }
        .controls {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 4px 6px;
          margin-bottom: 5px;
        }
        label {
          display: grid;
          gap: 1px;
          color: #e9d5ff;
          font-size: 7px;
        }
        input[type="range"] {
          width: 100%;
          accent-color: ${selectedColor()};
        }
        .arrangement {
          display: grid;
          grid-template-columns: repeat(16, 1fr);
          grid-template-rows: repeat(4, 9px);
          gap: 2px;
        }
        .cell {
          height: 9px;
          min-width: 0;
          padding: 0;
          border: 0;
          border-radius: 2px;
          background: #271827;
          font-size: 0;
        }
        .cell.event {
          box-shadow: inset 0 0 0 1px rgba(255,255,255,0.28);
        }
        .cell.current {
          background: #facc15 !important;
          box-shadow: 0 0 8px rgba(250, 204, 21, 0.9);
        }
        .status {
          margin-top: 4px;
          color: #f9a8d4;
          font-size: 8px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      </style>
      <div class="sampler">
        <h3>VOICE CLIPS</h3>
        <div class="scope"><canvas id="voice-scope" width="244" height="32"></canvas></div>
        <div class="clip-row">
          <input id="clip-name" type="text" maxlength="16" value="${selectedClip()?.name || ''}" placeholder="clip name">
          <button class="hot" id="record">${recording ? 'Stop' : 'Record'}</button>
        </div>
        <div class="select-row">
          <select id="clip-select">${clipOptions || '<option value="">No clips</option>'}</select>
          <button id="launch">${state.launch === 'clip' ? 'Clip' : 'Slice'}</button>
          <button id="enabled">${state.enabled ? 'On' : 'Muted'}</button>
        </div>
        <div class="controls">
          <label>Rate <input id="rate" type="range" min="0.5" max="1.8" step="0.01" value="${state.rate}"></label>
          <label>Tone <input id="tone" type="range" min="0" max="1" step="0.01" value="${state.tone}"></label>
          <label>Drive <input id="drive" type="range" min="0" max="1" step="0.01" value="${state.drive}"></label>
          <label>Echo <input id="echo" type="range" min="0" max="0.8" step="0.01" value="${state.echo}"></label>
        </div>
        <div class="arrangement" id="arrangement"></div>
        <div class="status">${status} | 4 bars</div>
      </div>
    `;

    dom.querySelector('#record').addEventListener('click', () => {
      if (recording) stopRecording();
      else startRecording();
    });
    dom.querySelector('#enabled').addEventListener('click', () => {
      ctx.bus.pubGlobal('voice_enabled', !state.enabled);
    });
    dom.querySelector('#launch').addEventListener('click', () => {
      state.launch = state.launch === 'clip' ? 'slice' : 'clip';
      ctx.bus.pubGlobal('voice_launch', state.launch);
      render();
    });

    const select = dom.querySelector('#clip-select');
    select.addEventListener('change', () => {
      state.selectedClipId = select.value || null;
      ctx.bus.pubGlobal('voice_selected_clip', state.selectedClipId);
      render();
    });

    const nameInput = dom.querySelector('#clip-name');
    nameInput.addEventListener('change', () => {
      const clip = selectedClip();
      if (!clip) return;
      clip.name = String(nameInput.value || clip.name).trim().slice(0, 16) || clip.name;
      publishClipState();
      render();
    });

    ['rate', 'tone', 'drive', 'echo'].forEach((key) => {
      const input = dom.querySelector(`#${key}`);
      input.addEventListener('input', () => {
        const value = Number(input.value);
        state[key] = value;
        ctx.bus.pubGlobal(`voice_${key}`, value);
        updateFx();
      });
    });

    const arrangement = dom.querySelector('#arrangement');
    state.arrangement.forEach((event, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `cell ${event ? 'event' : ''}`;
      button.dataset.index = String(index);
      if (event) {
        const clip = findClip(event.clipId);
        button.style.background = clip?.color || '#db2777';
        button.title = `${clip?.name || event.clipId} bar ${Math.floor(index / 16) + 1}.${index % 16 + 1}`;
      } else {
        button.title = `empty bar ${Math.floor(index / 16) + 1}.${index % 16 + 1}`;
      }
      button.addEventListener('click', () => {
        const nextArrangement = cloneArrangement(state.arrangement);
        const selected = state.selectedClipId;
        if (!selected) return;
        const current = nextArrangement[index];
        nextArrangement[index] = current?.clipId === selected ? null : { clipId: selected, velocity: current?.velocity || 1 };
        ctx.bus.pubGlobal('voice_arrangement', nextArrangement);
      });
      arrangement.appendChild(button);
    });
  };

  render();
  updateFx();

  const unsubscribers = [
    ctx.bus.subGlobal('voice_enabled', (enabled) => {
      state.enabled = Boolean(enabled);
      render();
    }),
    ctx.bus.subGlobal('voice_clip_meta', (clipMeta) => {
      if (!Array.isArray(clipMeta)) return;
      state.clipMeta = clipMeta.slice(0, 8).map((clip, index) => ({
        id: String(clip.id || `clip_${index + 1}`),
        name: String(clip.name || `voice ${index + 1}`).slice(0, 16),
        color: clip.color || clipColors[index % clipColors.length],
        duration: Number(clip.duration) || null
      }));
      if (!state.selectedClipId && state.clipMeta[0]) state.selectedClipId = state.clipMeta[0].id;
      render();
    }),
    ctx.bus.subGlobal('voice_selected_clip', (clipId) => {
      state.selectedClipId = clipId || null;
      render();
    }),
    ctx.bus.subGlobal('voice_arrangement', (arrangement) => {
      state.arrangement = cloneArrangement(arrangement);
      render();
    }),
    ctx.bus.subGlobal('voice_pattern', (pattern) => {
      if (!Array.isArray(pattern)) return;
      const clipId = state.selectedClipId || state.clipMeta[0]?.id || 'clip_1';
      const nextArrangement = Array.from({ length: arrangementLength }, () => null);
      for (let bar = 0; bar < 4; bar += 1) {
        pattern.slice(0, 16).forEach((velocity, index) => {
          if (velocity) nextArrangement[bar * 16 + index] = { clipId, velocity: Number(velocity) || 1 };
        });
      }
      state.arrangement = nextArrangement;
      ctx.bus.pubGlobal('voice_arrangement', nextArrangement);
      render();
    }),
    ctx.bus.subGlobal('voice_launch', (launch) => {
      state.launch = launch === 'slice' ? 'slice' : 'clip';
      render();
    }),
    ...['rate', 'tone', 'drive', 'echo'].map((key) => ctx.bus.subGlobal(`voice_${key}`, (value) => {
      const number = Number(value);
      if (!Number.isFinite(number)) return;
      state[key] = number;
      const input = dom.querySelector(`#${key}`);
      if (input) input.value = String(number);
      updateFx();
    }))
  ];

  const unsubscribeClock = ctx.clock.onTick(({ step, time, duration }) => {
    currentStep = step % arrangementLength;
    const event = state.arrangement[currentStep];
    if (event?.clipId) {
      playClip(event.clipId, time, step, event.velocity || 1, duration);
      pulse = Math.max(pulse, event.velocity || 1);
    }
  });

  const waveData = new Uint8Array(analyser.frequencyBinCount);
  const freqData = new Uint8Array(analyser.frequencyBinCount);
  let visualPhase = 0;

  return {
    update() {
      pulse *= 0.9;
      visualPhase += 0.025 + pulse * 0.05;
      const canvas = dom.querySelector('#voice-scope');
      if (canvas) {
        const g = canvas.getContext('2d');
        analyser.getByteTimeDomainData(waveData);
        analyser.getByteFrequencyData(freqData);
        let energy = pulse;
        for (let i = 0; i < 20; i += 1) energy += freqData[i] / 255 / 20;
        energy = clamp(energy, 0, 1.4);

        g.fillStyle = `rgba(7, 6, 10, ${0.18 + Math.max(0, 0.22 - energy * 0.08)})`;
        g.fillRect(0, 0, canvas.width, canvas.height);
        g.globalCompositeOperation = 'lighter';

        for (let i = 0; i < 24; i += 1) {
          const mag = freqData[i] / 255;
          const x = i / 23 * canvas.width;
          const h = mag * (12 + energy * 22);
          g.fillStyle = `hsla(${315 + i * 8 + visualPhase * 90}, 92%, ${54 + mag * 18}%, ${0.2 + mag * 0.52})`;
          g.fillRect(x, canvas.height - h, 4, h);
          g.fillRect(canvas.width - x, 0, 4, h * 0.65);
        }

        g.strokeStyle = `rgba(255, 241, 242, ${0.42 + energy * 0.3})`;
        g.lineWidth = 1.2;
        g.beginPath();
        for (let i = 0; i < waveData.length; i += 1) {
          const x = i / (waveData.length - 1) * canvas.width;
          const y = waveData[i] / 255 * canvas.height;
          if (i === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.stroke();
        g.globalCompositeOperation = 'source-over';
      }

      dom.querySelectorAll('.cell').forEach((cell) => {
        cell.classList.toggle('current', Number(cell.dataset.index) === currentStep);
      });
    },
    getState() {
      return {
        enabled: state.enabled,
        clipMeta: state.clipMeta.slice(),
        selectedClipId: state.selectedClipId,
        arrangement: cloneArrangement(state.arrangement),
        rate: state.rate,
        tone: state.tone,
        drive: state.drive,
        echo: state.echo,
        space: state.space,
        launch: state.launch
      };
    },
    destroy() {
      unsubscribeClock();
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      if (stream) stream.getTracks().forEach((track) => track.stop());
      [micSource, recorder, recorderSink, output, delaySend, delay, delayFeedback, delayFilter, convolver, reverbSend, reverbGain, analyser].forEach((node) => {
        try { node.disconnect(); } catch (e) {}
      });
    }
  };
}
