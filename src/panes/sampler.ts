import { getAudioContext, registerSound } from '@strudel/webaudio';
import { SignalBus } from '../bus';
import { makePaneDom, PaneState, setStatus } from './base';

// --- Vocoder (16-band channel vocoder) ---

const BAND_FREQS = [
  100, 160, 250, 400, 630, 1000, 1600, 2500,
  4000, 5000, 6300, 7500, 8500, 10000, 12000, 14000,
];
const BAND_Q = 8;

class Vocoder {
  private ac: AudioContext;
  private carrier: OscillatorNode;
  private output: GainNode;
  private micSource: MediaStreamAudioSourceNode | null = null;
  private bands: { mod: BiquadFilterNode; carr: BiquadFilterNode; vca: GainNode; rect: WaveShaperNode; env: BiquadFilterNode }[] = [];
  private stream: MediaStream | null = null;

  constructor(ac: AudioContext) {
    this.ac = ac;
    this.output = ac.createGain();
    this.output.gain.value = 1.5;
    this.carrier = ac.createOscillator();
    this.carrier.type = 'sawtooth';
    this.carrier.frequency.value = 110;
    this.carrier.start();

    const absCurve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) absCurve[i] = Math.abs((i - 512) / 512);

    for (const freq of BAND_FREQS) {
      const mod = ac.createBiquadFilter();
      mod.type = 'bandpass'; mod.frequency.value = freq; mod.Q.value = BAND_Q;

      const rect = ac.createWaveShaper();
      rect.curve = absCurve;

      const env = ac.createBiquadFilter();
      env.type = 'lowpass'; env.frequency.value = 30;

      const carr = ac.createBiquadFilter();
      carr.type = 'bandpass'; carr.frequency.value = freq; carr.Q.value = BAND_Q;

      const vca = ac.createGain();
      vca.gain.value = 0;

      mod.connect(rect).connect(env).connect(vca.gain);
      this.carrier.connect(carr).connect(vca).connect(this.output);

      this.bands.push({ mod, carr, vca, rect, env });
    }
  }

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.micSource = this.ac.createMediaStreamSource(this.stream);
    for (const b of this.bands) this.micSource.connect(b.mod);
    this.output.connect(this.ac.destination);
  }

  stop(): void {
    this.micSource?.disconnect();
    this.output.disconnect();
    this.stream?.getTracks().forEach(t => t.stop());
    this.micSource = null;
    this.stream = null;
  }

  setFreq(hz: number): void {
    this.carrier.frequency.setTargetAtTime(hz, this.ac.currentTime, 0.02);
  }

  setGain(g: number): void {
    this.output.gain.setTargetAtTime(g, this.ac.currentTime, 0.02);
  }

  destroy(): void {
    this.stop();
    this.carrier.stop();
    this.carrier.disconnect();
    for (const b of this.bands) {
      b.mod.disconnect(); b.carr.disconnect(); b.vca.disconnect();
      b.rect.disconnect(); b.env.disconnect();
    }
  }
}

// --- Waveform drawing ---

function drawWaveform(
  canvas: HTMLCanvasElement,
  buffer: AudioBuffer | null,
  slices: number[],
  recLevel?: number,
) {
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width;
  const h = canvas.height;
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, w, h);

  if (!buffer) {
    if (recLevel !== undefined) {
      ctx.fillStyle = '#e76e55';
      const barH = recLevel * h;
      ctx.fillRect(0, h - barH, w, barH);
    }
    ctx.fillStyle = '#555';
    ctx.font = '10px monospace';
    ctx.fillText(recLevel !== undefined ? 'recording...' : 'no recording', 8, h / 2);
    return;
  }

  const data = buffer.getChannelData(0);
  const step = Math.max(1, Math.floor(data.length / w));
  ctx.strokeStyle = '#92cc41';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x < w; x++) {
    const idx = Math.floor(x * data.length / w);
    let min = 1, max = -1;
    for (let j = 0; j < step; j++) {
      const v = data[idx + j] ?? 0;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    const yMin = ((1 - max) / 2) * h;
    const yMax = ((1 - min) / 2) * h;
    ctx.moveTo(x, yMin);
    ctx.lineTo(x, yMax);
  }
  ctx.stroke();

  ctx.strokeStyle = '#e76e55';
  ctx.lineWidth = 2;
  for (const s of slices) {
    const x = (s / buffer.duration) * w;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
}

// --- Register slices with Strudel ---

function registerSlices(name: string, buffer: AudioBuffer, sliceTimes: number[]) {
  const boundaries = [0, ...sliceTimes.sort((a, b) => a - b), buffer.duration];

  registerSound(name, (t: number, value: any, onEnded: () => void) => {
    const ac = getAudioContext();
    const n = Math.abs(Math.floor(value.n ?? 0)) % (boundaries.length - 1);
    const start = boundaries[n];
    const end = boundaries[n + 1];
    const dur = end - start;

    const source = ac.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = value.speed ?? 1;

    const gain = ac.createGain();
    const vol = value.gain ?? 0.8;
    gain.gain.setValueAtTime(vol, t);

    source.connect(gain);
    source.start(t, start, dur);

    const playDur = dur / (source.playbackRate.value || 1);
    const release = value.release ?? 0.01;
    gain.gain.setValueAtTime(vol, t + playDur);
    gain.gain.linearRampToValueAtTime(0, t + playDur + release);
    source.stop(t + playDur + release + 0.01);

    source.onended = () => {
      gain.disconnect();
      onEnded();
    };

    return { node: gain, stop: (time: number) => source.stop(time) };
  }, { type: 'sample' });
}

// --- Preview a slice ---

function previewSlice(buffer: AudioBuffer, start: number, end: number) {
  const ac = getAudioContext();
  const source = ac.createBufferSource();
  source.buffer = buffer;
  const gain = ac.createGain();
  gain.gain.value = 0.8;
  source.connect(gain).connect(ac.destination);
  source.start(ac.currentTime, start, end - start);
}

// --- Mount the pane ---

export function mountSamplerPane(
  state: PaneState,
  parent: HTMLElement,
  bus: SignalBus,
): () => void {
  if (!state.data.has('sampleName')) state.data.set('sampleName', 'mic');
  if (!state.data.has('mode')) state.data.set('mode', 'sampler');

  const { root, body, footer, onClose } = makePaneDom(state, 'SAMPLER');

  // --- Controls row ---
  const controls = document.createElement('div');
  controls.className = 'sampler-controls';

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.value = state.data.get('sampleName');
  nameInput.className = 'sampler-name';
  nameInput.placeholder = 'sample name';
  nameInput.addEventListener('change', () => {
    state.data.set('sampleName', nameInput.value || 'mic');
  });

  const recBtn = document.createElement('button');
  recBtn.className = 'pane-btn sampler-rec';
  recBtn.textContent = 'REC';

  const modeBtn = document.createElement('button');
  modeBtn.className = 'pane-btn';
  modeBtn.textContent = 'VOCODER';

  controls.appendChild(nameInput);
  controls.appendChild(recBtn);
  controls.appendChild(modeBtn);
  body.appendChild(controls);

  // --- Waveform canvas ---
  const canvas = document.createElement('canvas');
  canvas.className = 'sampler-waveform';
  canvas.width = 380;
  canvas.height = 100;
  body.appendChild(canvas);

  // --- Slice info ---
  const sliceInfo = document.createElement('div');
  sliceInfo.className = 'sampler-slice-info';
  sliceInfo.textContent = 'click waveform to slice · right-click to remove';
  body.appendChild(sliceInfo);

  // --- Vocoder controls (hidden by default) ---
  const vocoderControls = document.createElement('div');
  vocoderControls.className = 'sampler-vocoder-controls';
  vocoderControls.style.display = 'none';

  const freqLabel = document.createElement('div');
  freqLabel.className = 'widget-value';
  freqLabel.textContent = 'carrier = 110 Hz';

  const freqSlider = document.createElement('input');
  freqSlider.type = 'range';
  freqSlider.className = 'widget-slider';
  freqSlider.min = '40';
  freqSlider.max = '880';
  freqSlider.value = '110';

  const gainLabel = document.createElement('div');
  gainLabel.className = 'widget-value';
  gainLabel.textContent = 'gain = 1.5';

  const gainSlider = document.createElement('input');
  gainSlider.type = 'range';
  gainSlider.className = 'widget-slider';
  gainSlider.min = '0';
  gainSlider.max = '3';
  gainSlider.step = '0.1';
  gainSlider.value = '1.5';

  vocoderControls.appendChild(freqLabel);
  vocoderControls.appendChild(freqSlider);
  vocoderControls.appendChild(gainLabel);
  vocoderControls.appendChild(gainSlider);
  body.appendChild(vocoderControls);

  // --- State ---
  let recording = false;
  let mediaRecorder: MediaRecorder | null = null;
  let audioBuffer: AudioBuffer | null = null;
  let slices: number[] = [];
  let analyser: AnalyserNode | null = null;
  let vocoder: Vocoder | null = null;
  let vocoderActive = false;
  let animFrame = 0;

  // --- Recording ---
  async function startRecording() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ac = getAudioContext();
    const micSource = ac.createMediaStreamSource(stream);
    analyser = ac.createAnalyser();
    analyser.fftSize = 256;
    micSource.connect(analyser);

    const chunks: Blob[] = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      micSource.disconnect();
      analyser = null;

      const blob = new Blob(chunks, { type: 'audio/webm' });
      const arrayBuf = await blob.arrayBuffer();
      audioBuffer = await ac.decodeAudioData(arrayBuf);
      slices = [];

      const name = nameInput.value || 'mic';
      registerSlices(name, audioBuffer, slices);
      drawWaveform(canvas, audioBuffer, slices);
      setStatus(footer, `registered s("${name}") · ${audioBuffer.duration.toFixed(1)}s`, true);
    };
    mediaRecorder.start();
    recording = true;
    recBtn.textContent = 'STOP';
    recBtn.classList.add('active');
    setStatus(footer, 'recording...');

    function drawLevel() {
      if (!recording || !analyser) return;
      const data = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(data);
      const level = data.reduce((a, b) => a + b, 0) / (data.length * 255);
      drawWaveform(canvas, null, [], level);
      animFrame = requestAnimationFrame(drawLevel);
    }
    drawLevel();
  }

  function stopRecording() {
    recording = false;
    recBtn.textContent = 'REC';
    recBtn.classList.remove('active');
    cancelAnimationFrame(animFrame);
    mediaRecorder?.stop();
    mediaRecorder = null;
  }

  recBtn.addEventListener('click', () => {
    if (recording) stopRecording();
    else startRecording().catch(e => setStatus(footer, 'mic error: ' + e.message));
  });

  // --- Slicing (click on waveform) ---
  canvas.addEventListener('click', (e) => {
    if (!audioBuffer) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const t = (x / canvas.width) * audioBuffer.duration;
    slices.push(t);
    slices.sort((a, b) => a - b);

    const name = nameInput.value || 'mic';
    registerSlices(name, audioBuffer, slices);
    drawWaveform(canvas, audioBuffer, slices);
    setStatus(footer, `${slices.length} slices · s("${name}:0") to s("${name}:${slices.length}")`, true);
  });

  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!audioBuffer || slices.length === 0) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const t = (x / canvas.width) * audioBuffer.duration;
    const nearest = slices.reduce((best, s, i) =>
      Math.abs(s - t) < Math.abs(slices[best] - t) ? i : best, 0);
    if (Math.abs(slices[nearest] - t) < audioBuffer.duration * 0.03) {
      slices.splice(nearest, 1);
      const name = nameInput.value || 'mic';
      registerSlices(name, audioBuffer, slices);
      drawWaveform(canvas, audioBuffer, slices);
    }
  });

  // double-click to preview a slice
  canvas.addEventListener('dblclick', (e) => {
    if (!audioBuffer) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const t = (x / canvas.width) * audioBuffer.duration;
    const boundaries = [0, ...slices.sort((a, b) => a - b), audioBuffer.duration];
    for (let i = 0; i < boundaries.length - 1; i++) {
      if (t >= boundaries[i] && t < boundaries[i + 1]) {
        previewSlice(audioBuffer, boundaries[i], boundaries[i + 1]);
        setStatus(footer, `preview :${i}`, true);
        break;
      }
    }
  });

  // --- Vocoder toggle ---
  modeBtn.addEventListener('click', async () => {
    if (vocoderActive) {
      vocoder?.stop();
      vocoderActive = false;
      modeBtn.textContent = 'VOCODER';
      vocoderControls.style.display = 'none';
      canvas.style.display = '';
      sliceInfo.style.display = '';
      setStatus(footer, 'vocoder off');
    } else {
      try {
        const ac = getAudioContext();
        await ac.resume();
        if (!vocoder) vocoder = new Vocoder(ac);
        await vocoder.start();
        vocoderActive = true;
        modeBtn.textContent = 'VOC OFF';
        vocoderControls.style.display = '';
        canvas.style.display = 'none';
        sliceInfo.style.display = 'none';
        setStatus(footer, 'vocoder on · speak into mic', true);
      } catch (e: any) {
        setStatus(footer, 'vocoder error: ' + e.message);
      }
    }
  });

  freqSlider.addEventListener('input', () => {
    const hz = Number(freqSlider.value);
    vocoder?.setFreq(hz);
    freqLabel.textContent = `carrier = ${hz} Hz`;
    bus.set('vocoder', hz);
  });

  gainSlider.addEventListener('input', () => {
    const g = Number(gainSlider.value);
    vocoder?.setGain(g);
    gainLabel.textContent = `gain = ${g.toFixed(1)}`;
  });

  // bus can control vocoder carrier frequency
  const unsubBus = bus.on('vocoder', (v) => {
    if (vocoder && vocoderActive) {
      vocoder.setFreq(v);
      freqSlider.value = String(Math.round(v));
      freqLabel.textContent = `carrier = ${Math.round(v)} Hz`;
    }
  });

  // --- Sync name from Yjs ---
  state.data.observe(() => {
    const n = state.data.get('sampleName');
    if (n && n !== nameInput.value) nameInput.value = n;
  });

  drawWaveform(canvas, null, []);
  setStatus(footer, 'press REC to record · VOCODER for live voice');
  parent.appendChild(root);

  let closed = false;
  onClose(() => {
    if (closed) return;
    closed = true;
    stopRecording();
    vocoder?.destroy();
    cancelAnimationFrame(animFrame);
    unsubBus();
    root.remove();
    state.data.set('_deleted', true);
  });

  return () => onClose(() => {});
}
