// House Voice Clip Sampler Element
export default function setup(ctx, prevState) {
  const dom = ctx.domRoot;
  const arrangementLength = 64;
  const moodVersion = 'laidback-v1';
  const isLaidBackState = prevState?.moodVersion === moodVersion;
  const defaultVoicePattern = [0.72, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.48, 0, 0, 0, 0, 0];
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

  const mellowArrangement = (arrangement) => {
    const source = cloneArrangement(arrangement);
    const next = Array.from({ length: arrangementLength }, () => null);
    for (let start = 0; start < arrangementLength; start += 8) {
      const event = source.slice(start, start + 8).find(Boolean);
      if (!event) continue;
      next[start] = {
        clipId: event.clipId,
        velocity: Math.max(0.12, Math.min(1, event.velocity * 0.72))
      };
    }
    return next;
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
    moodVersion,
    enabled: prevState?.enabled ?? true,
    clipMeta: Array.isArray(prevState?.clipMeta) ? prevState.clipMeta.slice(0, 16) : [],
    selectedClipId: prevState?.selectedClipId || null,
    arrangement: isLaidBackState ? migrateArrangement() : mellowArrangement(migrateArrangement()),
    clipSlices: prevState?.clipSlices && typeof prevState.clipSlices === 'object' ? { ...prevState.clipSlices } : {},
    rate: isLaidBackState && Number.isFinite(prevState?.rate) ? prevState.rate : 0.84,
    tone: isLaidBackState && Number.isFinite(prevState?.tone) ? prevState.tone : 0.28,
    drive: isLaidBackState && Number.isFinite(prevState?.drive) ? prevState.drive : 0.16,
    echo: isLaidBackState && Number.isFinite(prevState?.echo) ? prevState.echo : 0.28,
    space: isLaidBackState && Number.isFinite(prevState?.space) ? prevState.space : 0.3,
    launch: prevState?.launch === 'clip' ? 'clip' : 'slice'
  };
  const initialRelaxedArrangement = cloneArrangement(state.arrangement);
  const relaxedFx = {
    rate: 0.84,
    tone: 0.28,
    drive: 0.16,
    echo: 0.28,
    space: 0.3
  };

  if (!state.selectedClipId && state.clipMeta[0]) state.selectedClipId = state.clipMeta[0].id;

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const now = () => ctx.audioCtx.currentTime;
  const randomFor = (step, salt) => {
    const raw = Math.sin((step + 1) * 111.17 + salt * 271.31) * 43758.5453;
    return raw - Math.floor(raw);
  };
  const sampleNameFor = (value, fallback = 'voice') => {
    const cleaned = String(value || '')
      .trim()
      .replace(/\s+/g, '_')
      .replace(/[^A-Za-z0-9_-]/g, '')
      .slice(0, 24);
    return cleaned || fallback;
  };
  const parseSampleRef = (value, fallbackIndex = 0) => {
    let text = String(value ?? '').trim();
    const strudelMatch = text.match(/^s\(\s*(['"])(.*?)\1\s*\)$/);
    if (strudelMatch) text = strudelMatch[2];
    const match = text.match(/^(.*?)(?::(-?\d+))?$/);
    return {
      name: sampleNameFor(match?.[1] || text, 'voice'),
      index: Number.isFinite(Number(match?.[2])) ? Number(match[2]) : fallbackIndex
    };
  };
  const ensureGlobalSampleRegistry = () => {
    if (typeof globalThis === 'undefined') return null;
    if (!globalThis.__jamSampleRegistry) {
      const registry = {
        byId: new Map(),
        byName: new Map(),
        register(sample) {
          const previous = this.byId.get(sample.id);
          if (previous?.name && previous.name !== sample.name) this.byName.delete(previous.name);
          this.byId.set(sample.id, sample);
          this.byName.set(sample.name, sample);
          globalThis.dispatchEvent?.(new CustomEvent('jam-samples-change', { detail: this.list() }));
          return sample;
        },
        unregister(id) {
          const sample = this.byId.get(id);
          if (!sample) return;
          this.byId.delete(id);
          if (this.byName.get(sample.name)?.id === id) this.byName.delete(sample.name);
          globalThis.dispatchEvent?.(new CustomEvent('jam-samples-change', { detail: this.list() }));
        },
        list() {
          return Array.from(this.byId.values()).map((sample) => ({
            id: sample.id,
            name: sample.name,
            displayName: sample.displayName,
            owner: sample.owner,
            duration: sample.duration,
            segments: sample.segments,
            refs: sample.refs
          }));
        },
        names() {
          return this.list().map((sample) => sample.name);
        },
        resolve(ref) {
          const parsed = parseSampleRef(ref);
          const sample = this.byName.get(parsed.name) || this.byId.get(parsed.name);
          return sample ? { sample, index: parsed.index } : null;
        },
        play(ref, options = {}) {
          const resolved = this.resolve(ref);
          if (!resolved) return null;
          return resolved.sample.play(resolved.index, options);
        }
      };
      globalThis.__jamSampleRegistry = registry;
      globalThis.jamSamples = registry;
      const s = (ref, options = {}) => registry.play(ref, options);
      s.__jamSampler = true;
      if (!globalThis.s || globalThis.s.__jamSampler) globalThis.s = s;
    } else {
      globalThis.jamSamples = globalThis.__jamSampleRegistry;
      if (!globalThis.s || globalThis.s.__jamSampler) {
        const s = (ref, options = {}) => globalThis.__jamSampleRegistry.play(ref, options);
        s.__jamSampler = true;
        globalThis.s = s;
      }
    }
    return globalThis.__jamSampleRegistry;
  };
  const sampleRegistry = ensureGlobalSampleRegistry();
  const bufferStore = (() => {
    if (typeof globalThis === 'undefined') return null;
    if (!globalThis.__jamHouseVoiceBuffers) globalThis.__jamHouseVoiceBuffers = new Map();
    return globalThis.__jamHouseVoiceBuffers;
  })();
  const clipBuffers = new Map();
  let dragSelection = null;
  let draggingWaveform = false;
  let dragPointerId = null;
  const formatDuration = (duration) => Number.isFinite(duration) ? `${duration.toFixed(1)}s` : 'local only';
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
  const findClip = (id) => state.clipMeta.find((clip) => clip.id === id);
  const selectedClip = () => findClip(state.selectedClipId);
  const selectedBuffer = () => state.selectedClipId ? clipBuffers.get(state.selectedClipId) : null;
  const selectedColor = () => selectedClip()?.color || clipColors[0];
  const sortedSlicesFor = (clipId, buffer = clipBuffers.get(clipId)) => {
    const duration = buffer?.duration;
    const source = Array.isArray(state.clipSlices?.[clipId]) ? state.clipSlices[clipId] : [];
    return source
      .map(Number)
      .filter((time) => Number.isFinite(time) && time > 0.015 && (!Number.isFinite(duration) || time < duration - 0.015))
      .sort((a, b) => a - b);
  };
  const setSlicesFor = (clipId, slices) => {
    const buffer = clipBuffers.get(clipId);
    const duration = buffer?.duration;
    const nextSlices = (slices || [])
      .map(Number)
      .filter((time) => Number.isFinite(time) && time > 0.015 && (!Number.isFinite(duration) || time < duration - 0.015))
      .sort((a, b) => a - b);
    state.clipSlices = { ...state.clipSlices, [clipId]: nextSlices };
    ctx.bus.pubGlobal('voice_clip_slices', state.clipSlices);
    publishSampleRegistry();
  };
  const sliceBoundariesFor = (clipId, buffer) => [0, ...sortedSlicesFor(clipId, buffer), buffer.duration];
  state.clipMeta.forEach((clip) => {
    const stored = bufferStore?.get(clip.id) || bufferStore?.get(sampleNameFor(clip.name, clip.id));
    const buffer = stored?.buffer || stored;
    if (buffer?.duration) {
      clipBuffers.set(clip.id, buffer);
      clip.duration = buffer.duration;
    }
  });
  const segmentRefsFor = (clip, buffer = clipBuffers.get(clip.id)) => {
    const sampleName = sampleNameFor(clip.name, clip.id);
    const segmentCount = buffer ? Math.max(1, sliceBoundariesFor(clip.id, buffer).length - 1) : 0;
    return Array.from({ length: segmentCount }, (_, index) => `${sampleName}:${index}`);
  };
  const syntaxStatusFor = (clip, buffer = clipBuffers.get(clip?.id)) => {
    if (!clip || !buffer) return 'Record a clip';
    const refs = segmentRefsFor(clip, buffer);
    if (refs.length <= 1) return `s("${refs[0]}")`;
    return `s("${refs[0]}") to s("${refs[refs.length - 1]}")`;
  };

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
  if (selectedBuffer()) status = syntaxStatusFor(selectedClip(), selectedBuffer());
  const seenExternalTriggers = new Set();

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

  const playRegisteredSlice = (clipId, index = 0, options = {}) => {
    const buffer = clipBuffers.get(clipId);
    const clip = findClip(clipId);
    if (!buffer || !clip || !state.enabled) return null;
    const boundaries = sliceBoundariesFor(clipId, buffer);
    const segmentCount = Math.max(1, boundaries.length - 1);
    const segmentIndex = Math.abs(Math.floor(Number(index) || 0)) % segmentCount;
    const start = boundaries[segmentIndex] || 0;
    const end = boundaries[segmentIndex + 1] || buffer.duration;
    const speed = Number.isFinite(Number(options.speed ?? options.rate)) ? Number(options.speed ?? options.rate) : 1;
    const gainValue = clamp(Number.isFinite(Number(options.gain)) ? Number(options.gain) : 0.8, 0, 4);
    const release = clamp(Number.isFinite(Number(options.release)) ? Number(options.release) : 0.012, 0.002, 0.25);
    const t = Math.max(Number.isFinite(Number(options.time)) ? Number(options.time) : now(), now() + 0.004);
    const duration = Math.max(0.01, end - start);
    const playDuration = duration / Math.max(0.05, Math.abs(speed));
    const source = ctx.audioCtx.createBufferSource();
    const gain = ctx.audioCtx.createGain();

    source.buffer = buffer;
    source.playbackRate.setValueAtTime(speed, t);
    gain.gain.setValueAtTime(gainValue, t);
    gain.gain.setValueAtTime(gainValue, t + playDuration);
    gain.gain.linearRampToValueAtTime(0.0001, t + playDuration + release);
    source.connect(gain);
    gain.connect(options.destination || output);
    if (options.fx !== false) {
      gain.connect(delaySend);
      gain.connect(reverbSend);
    }
    source.start(t, start, duration);
    source.stop(t + playDuration + release + 0.02);
    source.onended = () => {
      try { source.disconnect(); } catch (e) {}
      try { gain.disconnect(); } catch (e) {}
      if (typeof options.onEnded === 'function') options.onEnded();
    };
    return {
      ref: `${sampleNameFor(clip.name, clip.id)}:${segmentIndex}`,
      stop: (time = now()) => {
        try { source.stop(time); } catch (e) {}
      }
    };
  };

  const sampleSummaries = () => state.clipMeta
    .filter((clip) => clipBuffers.has(clip.id))
    .map((clip) => {
      const buffer = clipBuffers.get(clip.id);
      const refs = segmentRefsFor(clip, buffer);
      return {
        id: clip.id,
        name: sampleNameFor(clip.name, clip.id),
        displayName: clip.name,
        duration: buffer.duration,
        segments: refs.length,
        refs,
        syntax: refs.length <= 1 ? `s("${refs[0]}")` : `s("${refs[0]}")..s("${refs[refs.length - 1]}")`
      };
    });

  const syncSampleRegistry = () => {
    if (!sampleRegistry) return;
    const liveIds = new Set();
    state.clipMeta.forEach((clip) => {
      const buffer = clipBuffers.get(clip.id);
      if (!buffer) return;
      const sampleName = sampleNameFor(clip.name, clip.id);
      const refs = segmentRefsFor(clip, buffer);
      liveIds.add(clip.id);
      bufferStore?.set(clip.id, { buffer, name: sampleName });
      bufferStore?.set(sampleName, { buffer, id: clip.id });
      sampleRegistry.register({
        id: clip.id,
        name: sampleName,
        displayName: clip.name,
        owner: 'elem_house_voice',
        duration: buffer.duration,
        segments: refs.length,
        refs,
        play: (index, options = {}) => playRegisteredSlice(clip.id, index, options),
        get buffer() { return clipBuffers.get(clip.id); },
        get slices() { return sortedSlicesFor(clip.id, clipBuffers.get(clip.id)); }
      });
    });
    sampleRegistry.byId?.forEach((sample, id) => {
      if (sample.owner === 'elem_house_voice' && !liveIds.has(id)) sampleRegistry.unregister(id);
    });
  };

  const publishSampleRegistry = () => {
    syncSampleRegistry();
    ctx.bus.pubGlobal('global:voice_sample_registry', sampleSummaries());
    ctx.bus.pubGlobal('voice_sample_registry', sampleSummaries());
  };

  const publishClipState = () => {
    ctx.bus.pubGlobal('voice_clip_meta', state.clipMeta);
    ctx.bus.pubGlobal('voice_selected_clip', state.selectedClipId);
    ctx.bus.pubGlobal('voice_clip_slices', state.clipSlices);
    publishSampleRegistry();
  };

  const previewBufferRange = (buffer, start, end) => {
    const source = ctx.audioCtx.createBufferSource();
    const gain = ctx.audioCtx.createGain();
    source.buffer = buffer;
    gain.gain.setValueAtTime(0.75, now());
    gain.gain.setTargetAtTime(0.0001, now() + Math.max(0.02, end - start) * 0.9, 0.02);
    source.connect(gain);
    gain.connect(output);
    source.start(now() + 0.004, start, Math.max(0.02, end - start));
    source.stop(now() + Math.max(0.04, end - start) + 0.05);
    setTimeout(() => {
      try { source.disconnect(); } catch (e) {}
      try { gain.disconnect(); } catch (e) {}
    }, Math.max(100, (end - start + 0.1) * 1000));
  };

  const drawClipWaveform = (canvas) => {
    const buffer = selectedBuffer();
    if (!canvas || !buffer) return false;
    const g = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const data = buffer.getChannelData(0);
    const samplesPerPixel = Math.max(1, Math.floor(data.length / width));
    const slices = sortedSlicesFor(state.selectedClipId, buffer);

    g.fillStyle = '#07060a';
    g.fillRect(0, 0, width, height);

    if (dragSelection) {
      const startX = clamp(Math.min(dragSelection.start, dragSelection.end) / buffer.duration * width, 0, width);
      const endX = clamp(Math.max(dragSelection.start, dragSelection.end) / buffer.duration * width, 0, width);
      g.fillStyle = 'rgba(250, 204, 21, 0.24)';
      g.fillRect(startX, 0, Math.max(1, endX - startX), height);
    }

    g.strokeStyle = selectedColor();
    g.lineWidth = 1;
    g.beginPath();
    for (let x = 0; x < width; x += 1) {
      const index = Math.floor(x * data.length / width);
      let min = 1;
      let max = -1;
      for (let j = 0; j < samplesPerPixel; j += 1) {
        const value = data[index + j] || 0;
        if (value < min) min = value;
        if (value > max) max = value;
      }
      const yMin = (1 - max) * 0.5 * height;
      const yMax = (1 - min) * 0.5 * height;
      g.moveTo(x, yMin);
      g.lineTo(x, yMax);
    }
    g.stroke();

    g.strokeStyle = '#facc15';
    g.lineWidth = 1.4;
    slices.forEach((sliceTime) => {
      const x = sliceTime / buffer.duration * width;
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, height);
      g.stroke();
    });

    const boundaries = sliceBoundariesFor(state.selectedClipId, buffer);
    g.fillStyle = '#fce7f3';
    g.font = '9px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    for (let index = 0; index < boundaries.length - 1; index += 1) {
      const startX = boundaries[index] / buffer.duration * width;
      const endX = boundaries[index + 1] / buffer.duration * width;
      const x = clamp((startX + endX) / 2 - 3, 2, width - 8);
      g.fillText(String(index), x, height - 5);
    }

    g.fillStyle = '#fce7f3';
    g.font = '8px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
    g.fillText(`${sampleNameFor(selectedClip()?.name || 'clip')} ${formatDuration(buffer.duration)}`, 5, 10);
    return true;
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
      const name = sampleNameFor(nameInput?.value, `voice_${index}`);
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
      setSlicesFor(id, []);
      if (existingMetaIndex >= 0) state.clipMeta[existingMetaIndex] = meta;
      else state.clipMeta.push(meta);
      state.selectedClipId = id;
      dragSelection = null;
      status = syntaxStatusFor(meta, nextBuffer);
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

    const pitchSet = [0.944, 1, 0.944, 1.059, 0.89, 1];
    const pitch = pitchSet[step % pitchSet.length] * state.rate;
    const boundaries = sliceBoundariesFor(clipId, buffer);
    const sliceCount = Math.max(1, boundaries.length - 1);
    const sliceIndex = Math.floor((step / 8) % sliceCount);
    const sliceStart = boundaries[sliceIndex] || 0;
    const sliceEnd = boundaries[sliceIndex + 1] || buffer.duration;
    const sliceDuration = Math.max(0.02, sliceEnd - sliceStart);
    const offset = state.launch === 'slice'
      ? clamp(sliceStart + randomFor(step, 4) * Math.min(0.025, sliceDuration * 0.12), 0, Math.max(0, buffer.duration - 0.04))
      : 0;
    const maxDuration = state.launch === 'slice' ? sliceDuration * 1.15 : Math.min(buffer.duration, duration * 6.2);
    const playDuration = Math.min(maxDuration, buffer.duration - offset);

    source.buffer = buffer;
    source.playbackRate.setValueAtTime(pitch, t);
    highpass.type = 'highpass';
    highpass.frequency.setValueAtTime(80 + state.drive * 180, t);
    lowpass.type = 'lowpass';
    lowpass.frequency.setValueAtTime(900 + state.tone * 4300, t);
    lowpass.Q.setValueAtTime(2.2 + state.drive * 3.2, t);
    shaper.curve = makeShaper(state.drive);
    shaper.oversample = '4x';
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.42 * velocity, t + 0.04);
    gain.gain.setTargetAtTime(0.0001, t + playDuration * 0.82, 0.09);
    pan.pan.setValueAtTime((randomFor(step, 9) - 0.5) * 0.34, t);

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
      return `<option value="${escapeHtml(clip.id)}" ${clip.id === state.selectedClipId ? 'selected' : ''}>${index + 1}. ${escapeHtml(clip.name)}${local}</option>`;
    }).join('');
    const sourceClip = selectedClip();
    const syntaxText = sourceClip ? syntaxStatusFor(sourceClip) : 'Record a clip';

    dom.innerHTML = `
      <style>
        .sampler {
          width: 260px;
          height: 200px;
          box-sizing: border-box;
          padding: 5px;
          background: #120f16;
          border: 1px solid ${selectedColor()};
          border-radius: 8px;
          color: #f8fafc;
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          overflow: hidden;
          box-shadow: 0 8px 24px rgba(244, 114, 182, 0.2);
        }
        h3 {
          margin: 0 0 2px;
          color: #f9a8d4;
          font-size: 10px;
          text-align: center;
          letter-spacing: 0;
        }
        .scope {
          height: 28px;
          background: #07060a;
          border: 1px solid #3f2636;
          border-radius: 5px;
          overflow: hidden;
          margin-bottom: 2px;
          cursor: crosshair;
          touch-action: none;
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
          margin-bottom: 2px;
        }
        .select-row {
          display: grid;
          grid-template-columns: 1fr 48px 48px;
          gap: 5px;
          margin-bottom: 2px;
        }
        input[type="text"],
        select {
          min-width: 0;
          height: 18px;
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
          height: 18px;
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
          gap: 2px 5px;
          margin-bottom: 2px;
        }
        label {
          display: grid;
          gap: 0;
          color: #e9d5ff;
          font-size: 6px;
        }
        input[type="range"] {
          width: 100%;
          height: 10px;
          accent-color: ${selectedColor()};
        }
        .arrangement {
          display: grid;
          grid-template-columns: repeat(16, 1fr);
          grid-template-rows: repeat(4, 5px);
          gap: 1px;
        }
        .cell {
          height: 5px;
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
          margin-top: 2px;
          color: #f9a8d4;
          font-size: 8px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .syntax {
          margin-bottom: 2px;
          color: #fce7f3;
          font-size: 8px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      </style>
      <div class="sampler">
        <h3>VOICE CLIPS</h3>
        <div class="scope"><canvas id="voice-scope" width="244" height="28"></canvas></div>
        <div class="clip-row">
          <input id="clip-name" type="text" maxlength="16" value="${escapeHtml(selectedClip()?.name || '')}" placeholder="clip name">
          <button class="hot" id="record">${recording ? 'Stop' : 'Record'}</button>
        </div>
        <div class="select-row">
          <select id="clip-select">${clipOptions || '<option value="">No clips</option>'}</select>
          <button id="clear-slices">Clear</button>
          <button id="enabled">${state.enabled ? 'On' : 'Muted'}</button>
        </div>
        <div class="syntax">${escapeHtml(syntaxText)}</div>
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
    dom.querySelector('#clear-slices').addEventListener('click', () => {
      if (!state.selectedClipId) return;
      setSlicesFor(state.selectedClipId, []);
      dragSelection = null;
      status = syntaxStatusFor(selectedClip());
      render();
    });

    const select = dom.querySelector('#clip-select');
    select.addEventListener('change', () => {
      state.selectedClipId = select.value || null;
      dragSelection = null;
      ctx.bus.pubGlobal('voice_selected_clip', state.selectedClipId);
      render();
    });

    const nameInput = dom.querySelector('#clip-name');
    nameInput.addEventListener('change', () => {
      const clip = selectedClip();
      if (!clip) return;
      clip.name = sampleNameFor(nameInput.value || clip.name, clip.id).slice(0, 16) || clip.name;
      status = syntaxStatusFor(clip);
      publishClipState();
      render();
    });

    const canvas = dom.querySelector('#voice-scope');
    const pointerTime = (event) => {
      const buffer = selectedBuffer();
      if (!buffer || !canvas) return 0;
      const rect = canvas.getBoundingClientRect();
      const x = clamp(event.clientX - rect.left, 0, rect.width);
      return x / rect.width * buffer.duration;
    };
    canvas.addEventListener('pointerdown', (event) => {
      const buffer = selectedBuffer();
      if (!buffer || event.button === 2) return;
      event.preventDefault();
      draggingWaveform = true;
      dragPointerId = event.pointerId;
      const time = pointerTime(event);
      dragSelection = { start: time, end: time };
      canvas.setPointerCapture?.(event.pointerId);
      drawClipWaveform(canvas);
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!draggingWaveform || event.pointerId !== dragPointerId || !selectedBuffer()) return;
      dragSelection.end = pointerTime(event);
      drawClipWaveform(canvas);
    });
    canvas.addEventListener('pointerup', (event) => {
      if (!draggingWaveform || event.pointerId !== dragPointerId) return;
      draggingWaveform = false;
      dragPointerId = null;
      const buffer = selectedBuffer();
      if (!buffer || !dragSelection) return;
      dragSelection.end = pointerTime(event);
      const start = Math.min(dragSelection.start, dragSelection.end);
      const end = Math.max(dragSelection.start, dragSelection.end);
      if (end - start < 0.035) {
        const clipId = state.selectedClipId;
        const slices = sortedSlicesFor(clipId, buffer);
        const time = clamp((start + end) / 2, 0.02, buffer.duration - 0.02);
        if (slices.some((slice) => Math.abs(slice - time) < buffer.duration * 0.01)) {
          status = 'Cut already there';
          render();
          return;
        }
        setSlicesFor(clipId, [...slices, time]);
        dragSelection = null;
        status = syntaxStatusFor(selectedClip(), buffer);
        render();
      } else {
        previewBufferRange(buffer, start, end);
        dragSelection = null;
        status = `${start.toFixed(2)}-${end.toFixed(2)}s preview`;
        drawClipWaveform(canvas);
      }
    });
    canvas.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      const buffer = selectedBuffer();
      const clipId = state.selectedClipId;
      const slices = sortedSlicesFor(clipId, buffer);
      if (!buffer || !clipId || slices.length === 0) return;
      const time = pointerTime(event);
      let nearestIndex = 0;
      for (let i = 1; i < slices.length; i += 1) {
        if (Math.abs(slices[i] - time) < Math.abs(slices[nearestIndex] - time)) nearestIndex = i;
      }
      if (Math.abs(slices[nearestIndex] - time) < buffer.duration * 0.04) {
        slices.splice(nearestIndex, 1);
        setSlicesFor(clipId, slices);
        status = syntaxStatusFor(selectedClip(), buffer);
        render();
      }
    });
    canvas.addEventListener('dblclick', (event) => {
      const buffer = selectedBuffer();
      const clipId = state.selectedClipId;
      if (!buffer || !clipId) return;
      const time = pointerTime(event);
      const boundaries = sliceBoundariesFor(clipId, buffer);
      for (let i = 0; i < boundaries.length - 1; i += 1) {
        if (time >= boundaries[i] && time <= boundaries[i + 1]) {
          previewBufferRange(buffer, boundaries[i], boundaries[i + 1]);
          status = `Preview s("${sampleNameFor(selectedClip()?.name, clipId)}:${i}")`;
          drawClipWaveform(canvas);
          break;
        }
      }
    });
    drawClipWaveform(canvas);

    ['rate', 'tone', 'drive', 'echo', 'space'].forEach((key) => {
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
  publishSampleRegistry();

  const handleExternalSampleRequest = (request) => {
    const ref = typeof request === 'string'
      ? request
      : request?.ref || request?.sample || request?.name;
    if (!ref) return;
    const triggerId = request && typeof request === 'object' ? request.id || request.eventId : null;
    if (triggerId) {
      if (seenExternalTriggers.has(triggerId)) return;
      seenExternalTriggers.add(triggerId);
      if (seenExternalTriggers.size > 128) seenExternalTriggers.delete(seenExternalTriggers.values().next().value);
    }
    const parsed = parseSampleRef(ref, Number.isFinite(Number(request?.n)) ? Number(request.n) : 0);
    const clip = state.clipMeta.find((candidate) => sampleNameFor(candidate.name, candidate.id) === parsed.name || candidate.id === parsed.name);
    if (!clip) return;
    const handle = playRegisteredSlice(clip.id, parsed.index, request && typeof request === 'object' ? request : {});
    if (handle) status = `Played s("${handle.ref}")`;
  };

  const unsubscribers = [
    ctx.bus.subGlobal('voice_enabled', (enabled) => {
      state.enabled = Boolean(enabled);
      render();
    }),
    ctx.bus.subGlobal('voice_clip_meta', (clipMeta) => {
      if (!Array.isArray(clipMeta)) return;
      state.clipMeta = clipMeta.slice(0, 16).map((clip, index) => ({
        id: String(clip.id || `clip_${index + 1}`),
        name: sampleNameFor(clip.name, `voice_${index + 1}`).slice(0, 16),
        color: clip.color || clipColors[index % clipColors.length],
        duration: Number(clip.duration) || null
      }));
      if (!state.selectedClipId && state.clipMeta[0]) state.selectedClipId = state.clipMeta[0].id;
      state.clipMeta.forEach((clip) => {
        const stored = bufferStore?.get(clip.id) || bufferStore?.get(sampleNameFor(clip.name, clip.id));
        const buffer = stored?.buffer || stored;
        if (buffer?.duration) {
          clipBuffers.set(clip.id, buffer);
          clip.duration = buffer.duration;
        }
      });
      publishSampleRegistry();
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
    ctx.bus.subGlobal('voice_clip_slices', (clipSlices) => {
      if (!clipSlices || typeof clipSlices !== 'object') return;
      state.clipSlices = Object.fromEntries(Object.entries(clipSlices).map(([clipId, slices]) => [
        clipId,
        Array.isArray(slices) ? slices.map(Number).filter(Number.isFinite).sort((a, b) => a - b) : []
      ]));
      publishSampleRegistry();
      render();
    }),
    ctx.bus.subGlobal('global:voice_play_sample', handleExternalSampleRequest),
    ctx.bus.subGlobal('voice_play_sample', handleExternalSampleRequest),
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
    ...['rate', 'tone', 'drive', 'echo', 'space'].map((key) => ctx.bus.subGlobal(`voice_${key}`, (value) => {
      const number = Number(value);
      if (!Number.isFinite(number)) return;
      state[key] = number;
      const input = dom.querySelector(`#${key}`);
      if (input) input.value = String(number);
      updateFx();
    }))
  ];

  if (!isLaidBackState) {
    state.arrangement = cloneArrangement(initialRelaxedArrangement);
    Object.assign(state, relaxedFx);
    ctx.bus.pubGlobal('voice_arrangement', state.arrangement);
    Object.entries(relaxedFx).forEach(([key, value]) => ctx.bus.pubGlobal(`voice_${key}`, value));
    updateFx();
    render();
  }

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
        if (drawClipWaveform(canvas)) {
          dom.querySelectorAll('.cell').forEach((cell) => {
            cell.classList.toggle('current', Number(cell.dataset.index) === currentStep);
          });
          return;
        }

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
        moodVersion: state.moodVersion,
        clipMeta: state.clipMeta.slice(),
        selectedClipId: state.selectedClipId,
        arrangement: cloneArrangement(state.arrangement),
        clipSlices: Object.fromEntries(Object.entries(state.clipSlices).map(([clipId, slices]) => [
          clipId,
          Array.isArray(slices) ? slices.slice() : []
        ])),
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
