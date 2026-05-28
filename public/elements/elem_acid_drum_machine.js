const STATE_VERSION = 'acid-drum-machine-v2';

export default function setup(ctx, prevState) {
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;

  const state = {
    stateVersion: STATE_VERSION,
    running: prevState?.running ?? true,
    volume: finite(prevState?.volume, 0.78),
    drive: finite(prevState?.drive, 0.58),
    squelch: finite(prevState?.squelch, 0.72),
    decay: finite(prevState?.decay, 0.54),
    rave: finite(prevState?.rave, 0.64),
    shuffle: finite(prevState?.shuffle, 0.38),
    pattern: Number.isInteger(prevState?.pattern) ? clamp(prevState.pattern, 0, 2) : 0
  };

  const audio = ctx.audioCtx;
  const master = audio.createGain();
  const drumBus = audio.createGain();
  const acidBus = audio.createGain();
  const raveBus = audio.createGain();
  const shaper = audio.createWaveShaper();
  const compressor = audio.createDynamicsCompressor();
  const delay = audio.createDelay(0.8);
  const feedback = audio.createGain();
  const delayTone = audio.createBiquadFilter();
  const wet = audio.createGain();

  master.gain.value = state.running ? state.volume : 0;
  drumBus.gain.value = 0.92;
  acidBus.gain.value = 0.42;
  raveBus.gain.value = 0.34;
  compressor.threshold.value = -17;
  compressor.knee.value = 14;
  compressor.ratio.value = 4.5;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.14;
  delay.delayTime.value = 0.18;
  feedback.gain.value = 0.22;
  delayTone.type = 'lowpass';
  delayTone.frequency.value = 3400;
  wet.gain.value = 0.18;

  drumBus.connect(shaper);
  acidBus.connect(shaper);
  raveBus.connect(shaper);
  shaper.connect(master);
  acidBus.connect(delay);
  raveBus.connect(delay);
  delay.connect(delayTone);
  delayTone.connect(feedback);
  feedback.connect(delay);
  delayTone.connect(wet);
  wet.connect(master);
  master.connect(compressor);
  compressor.connect(ctx.audioOut);

  const liveNodes = new Set();
  const cleanupTimers = new Set();
  let currentStep = -1;
  let clockStepSeconds = 0.125;
  let destroyed = false;

  const patterns = [
    {
      name: 'classic',
      kick: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0.8, 0, 1, 0, 0.7, 0],
      snare: [0, 0, 0, 0, 0.78, 0, 0, 0, 0, 0, 0, 0, 0.82, 0, 0, 0],
      clap: [0, 0, 0, 0, 0.38, 0, 0, 0, 0, 0, 0, 0, 0.45, 0, 0.3, 0],
      hat: [0.38, 0.22, 0.36, 0.2, 0.42, 0.22, 0.32, 0.24, 0.4, 0.2, 0.36, 0.22, 0.45, 0.22, 0.34, 0.28],
      acid: [36, null, 43, 36, null, 48, null, 46, 36, null, 43, null, 39, null, 46, 48],
      crash: [1, 0, 0, 0, 0, 0, 0, 0, 0.55, 0, 0, 0, 0, 0, 0, 0],
      stab: [48, null, null, null, null, null, null, null, 55, null, null, null, null, null, null, null],
      hoover: [null, null, null, null, null, null, null, null, null, null, null, null, 48, null, null, null],
      siren: [null, null, null, null, null, null, 1, null, null, null, null, null, null, null, null, 0.7],
      vox: [null, null, null, 'hey', null, null, 'uh', null, null, null, null, 'hey', null, 'uh', null, null],
      bleep: [72, null, 75, null, null, 70, null, 79, 72, null, null, 82, null, 75, null, null]
    },
    {
      name: 'warehouse',
      kick: [1, 0, 0.45, 0, 1, 0, 0, 0.35, 1, 0, 0.5, 0, 1, 0.25, 0, 0.45],
      snare: [0, 0, 0, 0, 0.86, 0, 0, 0.22, 0, 0, 0, 0, 0.9, 0, 0, 0],
      clap: [0, 0, 0, 0, 0.52, 0.16, 0, 0, 0, 0, 0, 0, 0.56, 0.18, 0, 0.22],
      hat: [0.34, 0.3, 0.42, 0.26, 0.36, 0.32, 0.48, 0.26, 0.34, 0.3, 0.46, 0.24, 0.38, 0.32, 0.5, 0.28],
      acid: [36, 36, null, 43, 39, null, 46, null, 36, null, 48, 46, null, 43, 39, null],
      crash: [1, 0, 0, 0, 0, 0, 0.38, 0, 0.58, 0, 0, 0, 0, 0, 0, 0.42],
      stab: [48, null, null, 55, null, null, null, null, 51, null, null, 58, null, null, null, null],
      hoover: [null, null, null, null, null, null, null, null, null, null, null, null, 43, null, null, null],
      siren: [null, null, null, null, null, null, 1, null, null, null, null, null, null, null, null, 1],
      vox: [null, 'uh', null, null, 'hey', null, null, 'uh', null, null, 'hey', null, null, 'uh', null, null],
      bleep: [75, null, null, 79, null, 82, null, null, 75, null, 70, null, 87, null, null, 82]
    },
    {
      name: 'breaker',
      kick: [1, 0, 0, 0.55, 0, 0.8, 0, 0, 1, 0, 0.42, 0, 0, 0.75, 0.35, 0],
      snare: [0, 0, 0, 0, 0.88, 0, 0, 0, 0, 0, 0, 0.22, 0.86, 0, 0, 0],
      clap: [0, 0, 0, 0, 0.4, 0, 0.24, 0, 0, 0, 0, 0, 0.46, 0, 0.26, 0],
      hat: [0.34, 0.28, 0.2, 0.48, 0.38, 0.25, 0.5, 0.2, 0.34, 0.28, 0.44, 0.22, 0.4, 0.24, 0.58, 0.3],
      acid: [36, null, 36, 43, null, 39, 46, null, 36, 43, null, 48, 46, null, 39, 43],
      crash: [1, 0, 0, 0.35, 0, 0, 0, 0, 0.62, 0, 0.42, 0, 0, 0, 0, 0.48],
      stab: [48, null, 55, null, null, 46, null, null, null, 58, null, null, null, null, null, null],
      hoover: [null, null, null, null, null, null, null, null, null, null, null, null, 48, null, null, null],
      siren: [null, null, null, null, null, null, null, 0.9, null, null, null, null, null, null, 1, null],
      vox: [null, null, 'uh', null, 'hey', null, null, null, null, 'uh', null, null, 'hey', null, 'uh', null],
      bleep: [72, 75, null, null, 79, null, 70, null, 72, null, 82, null, null, 75, null, 79]
    }
  ];

  const makeDriveCurve = () => {
    const amount = 1.4 + state.drive * 8;
    const curve = new Float32Array(512);
    for (let i = 0; i < curve.length; i += 1) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * amount) * (0.78 + state.drive * 0.14);
    }
    return curve;
  };

  const makeNoiseBuffer = () => {
    const buffer = audio.createBuffer(1, Math.floor(audio.sampleRate * 0.45), audio.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i += 1) {
      last = last * 0.16 + (Math.random() * 2 - 1) * 0.84;
      data[i] = last;
    }
    return buffer;
  };

  const noiseBuffer = makeNoiseBuffer();

  const track = (seconds, ...nodes) => {
    nodes.forEach((node) => liveNodes.add(node));
    const timer = setTimeout(() => {
      cleanupTimers.delete(timer);
      nodes.forEach((node) => {
        try { if (typeof node.disconnect === 'function') node.disconnect(); } catch (_) {}
        liveNodes.delete(node);
      });
    }, Math.max(120, seconds * 1000 + 220));
    cleanupTimers.add(timer);
  };

  const midiToFreq = (midi) => 440 * Math.pow(2, (midi - 69) / 12);

  const playKick = (time, velocity) => {
    const t = Math.max(time, audio.currentTime + 0.001);
    const length = 0.18 + state.decay * 0.24;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    const click = audio.createBufferSource();
    const clickGain = audio.createGain();
    const clickFilter = audio.createBiquadFilter();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(118 + velocity * 35, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + length);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.9 * velocity, t + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);

    click.buffer = noiseBuffer;
    clickFilter.type = 'highpass';
    clickFilter.frequency.value = 5200;
    clickGain.gain.setValueAtTime(0.18 * velocity, t);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.018);

    osc.connect(gain);
    gain.connect(drumBus);
    click.connect(clickFilter);
    clickFilter.connect(clickGain);
    clickGain.connect(drumBus);
    osc.start(t);
    osc.stop(t + length + 0.04);
    click.start(t);
    click.stop(t + 0.04);
    track(length + 0.08, osc, gain, click, clickGain, clickFilter);
  };

  const playSnare = (time, velocity) => {
    const t = Math.max(time, audio.currentTime + 0.001);
    const length = 0.1 + state.decay * 0.16;
    const noise = audio.createBufferSource();
    const noiseFilter = audio.createBiquadFilter();
    const noiseGain = audio.createGain();
    const body = audio.createOscillator();
    const bodyGain = audio.createGain();

    noise.buffer = noiseBuffer;
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.value = 1700 + state.squelch * 900;
    noiseFilter.Q.value = 0.7;
    noiseGain.gain.setValueAtTime(0.0001, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.45 * velocity, t + 0.006);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, t + length);

    body.type = 'triangle';
    body.frequency.setValueAtTime(178, t);
    body.frequency.exponentialRampToValueAtTime(132, t + 0.08);
    bodyGain.gain.setValueAtTime(0.0001, t);
    bodyGain.gain.exponentialRampToValueAtTime(0.16 * velocity, t + 0.008);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);

    noise.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(drumBus);
    body.connect(bodyGain);
    bodyGain.connect(drumBus);
    noise.start(t);
    noise.stop(t + length + 0.03);
    body.start(t);
    body.stop(t + 0.16);
    track(length + 0.08, noise, noiseFilter, noiseGain, body, bodyGain);
  };

  const playClap = (time, velocity) => {
    const t = Math.max(time, audio.currentTime + 0.001);
    const filter = audio.createBiquadFilter();
    const output = audio.createGain();
    filter.type = 'bandpass';
    filter.frequency.value = 1450;
    filter.Q.value = 1.1;
    output.connect(drumBus);
    filter.connect(output);

    [0, 0.014, 0.028].forEach((offset, index) => {
      const src = audio.createBufferSource();
      const gain = audio.createGain();
      src.buffer = noiseBuffer;
      gain.gain.setValueAtTime(0.0001, t + offset);
      gain.gain.exponentialRampToValueAtTime((0.19 - index * 0.035) * velocity, t + offset + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + offset + 0.055 + state.decay * 0.03);
      src.connect(gain);
      gain.connect(filter);
      src.start(t + offset);
      src.stop(t + offset + 0.12);
      track(0.18, src, gain);
    });
    track(0.2, filter, output);
  };

  const playHat = (time, velocity, open = false) => {
    const t = Math.max(time, audio.currentTime + 0.001);
    const length = open ? 0.16 + state.decay * 0.18 : 0.035 + state.decay * 0.05;
    const src = audio.createBufferSource();
    const filter = audio.createBiquadFilter();
    const gain = audio.createGain();

    src.buffer = noiseBuffer;
    filter.type = 'highpass';
    filter.frequency.value = 6200 + state.squelch * 2800;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime((open ? 0.15 : 0.105) * velocity, t + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(drumBus);
    src.start(t);
    src.stop(t + length + 0.03);
    track(length + 0.08, src, filter, gain);
  };

  const playCrash = (time, velocity) => {
    const t = Math.max(time, audio.currentTime + 0.001);
    const length = 0.55 + state.decay * 0.5;
    const src = audio.createBufferSource();
    const high = audio.createBiquadFilter();
    const peak = audio.createBiquadFilter();
    const gain = audio.createGain();

    src.buffer = noiseBuffer;
    high.type = 'highpass';
    high.frequency.value = 4200;
    peak.type = 'peaking';
    peak.frequency.value = 7800;
    peak.Q.value = 1.7;
    peak.gain.value = 8 + state.rave * 7;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.2 * velocity * state.rave, t + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    src.connect(high);
    high.connect(peak);
    peak.connect(gain);
    gain.connect(raveBus);
    src.start(t);
    src.stop(t + length + 0.04);
    track(length + 0.08, src, high, peak, gain);
  };

  const playAcid = (time, midi, velocity, accent) => {
    const t = Math.max(time, audio.currentTime + 0.001);
    const length = clockStepSeconds * (0.62 + state.decay * 0.48);
    const freq = midiToFreq(midi);
    const osc = audio.createOscillator();
    const sub = audio.createOscillator();
    const filter = audio.createBiquadFilter();
    const gain = audio.createGain();

    osc.type = 'sawtooth';
    sub.type = 'square';
    osc.frequency.setValueAtTime(freq, t);
    sub.frequency.setValueAtTime(freq * 0.5, t);
    osc.detune.setValueAtTime(accent ? 8 : -5, t);
    filter.type = 'lowpass';
    filter.Q.setValueAtTime(8 + state.squelch * 16, t);
    filter.frequency.setValueAtTime(360 + state.squelch * 5400 + accent * 1500, t);
    filter.frequency.exponentialRampToValueAtTime(130 + state.squelch * 620, t + length);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime((accent ? 0.38 : 0.23) * velocity, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);

    osc.connect(filter);
    sub.connect(filter);
    filter.connect(gain);
    gain.connect(acidBus);
    osc.start(t);
    sub.start(t);
    osc.stop(t + length + 0.05);
    sub.stop(t + length + 0.05);
    track(length + 0.1, osc, sub, filter, gain);
  };

  const playRaveStab = (time, rootMidi, velocity, wide = false) => {
    const t = Math.max(time, audio.currentTime + 0.001);
    const length = clockStepSeconds * (1.25 + state.decay * 0.9);
    const chord = [0, 7, 10, 15];
    const filter = audio.createBiquadFilter();
    const gain = audio.createGain();
    const panner = typeof audio.createStereoPanner === 'function' ? audio.createStereoPanner() : null;
    const nodes = [filter, gain];

    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(760 + state.squelch * 2600, t);
    filter.frequency.exponentialRampToValueAtTime(260 + state.squelch * 700, t + length);
    filter.Q.setValueAtTime(2.4 + state.rave * 5.5, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.17 * velocity * state.rave, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    if (panner) {
      panner.pan.setValueAtTime(wide ? -0.55 : 0.42, t);
      nodes.push(panner);
    }

    chord.forEach((interval, index) => {
      const osc = audio.createOscillator();
      osc.type = index % 2 ? 'square' : 'sawtooth';
      osc.frequency.setValueAtTime(midiToFreq(rootMidi + interval), t);
      osc.detune.setValueAtTime((index - 1.5) * (9 + state.rave * 11), t);
      osc.connect(filter);
      osc.start(t);
      osc.stop(t + length + 0.05);
      nodes.push(osc);
    });

    filter.connect(gain);
    if (panner) {
      gain.connect(panner);
      panner.connect(raveBus);
    } else {
      gain.connect(raveBus);
    }
    track(length + 0.12, ...nodes);
  };

  const playHoover = (time, rootMidi, velocity) => {
    const t = Math.max(time, audio.currentTime + 0.001);
    const length = clockStepSeconds * (2.6 + state.rave * 1.4);
    const filter = audio.createBiquadFilter();
    const gain = audio.createGain();
    const nodes = [filter, gain];

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(600 + state.squelch * 900, t);
    filter.frequency.linearRampToValueAtTime(2400 + state.squelch * 3600, t + length * 0.55);
    filter.frequency.exponentialRampToValueAtTime(380 + state.squelch * 900, t + length);
    filter.Q.setValueAtTime(3.5 + state.rave * 7, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.16 * velocity * state.rave, t + 0.04);
    gain.gain.setValueAtTime(0.15 * velocity * state.rave, t + length * 0.66);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);

    [-18, -7, 0, 7, 19].forEach((offset, index) => {
      const osc = audio.createOscillator();
      osc.type = index % 2 ? 'sawtooth' : 'square';
      osc.frequency.setValueAtTime(midiToFreq(rootMidi + offset), t);
      osc.detune.setValueAtTime((index - 2) * (12 + state.rave * 10), t);
      osc.detune.linearRampToValueAtTime((2 - index) * (18 + state.rave * 16), t + length);
      osc.connect(filter);
      osc.start(t);
      osc.stop(t + length + 0.05);
      nodes.push(osc);
    });

    filter.connect(gain);
    gain.connect(raveBus);
    track(length + 0.14, ...nodes);
  };

  const playSiren = (time, velocity, rising = true) => {
    const t = Math.max(time, audio.currentTime + 0.001);
    const length = clockStepSeconds * (1.7 + state.rave);
    const osc = audio.createOscillator();
    const filter = audio.createBiquadFilter();
    const gain = audio.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(rising ? 520 : 1180, t);
    osc.frequency.exponentialRampToValueAtTime(rising ? 1420 : 430, t + length);
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(rising ? 900 : 1600, t);
    filter.frequency.linearRampToValueAtTime(rising ? 2800 : 650, t + length);
    filter.Q.value = 8 + state.rave * 10;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.11 * velocity * state.rave, t + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(raveBus);
    osc.start(t);
    osc.stop(t + length + 0.05);
    track(length + 0.1, osc, filter, gain);
  };

  const playVox = (time, word, velocity) => {
    const t = Math.max(time, audio.currentTime + 0.001);
    const length = word === 'hey' ? 0.16 : 0.105;
    const source = audio.createBufferSource();
    const tone = audio.createOscillator();
    const vowel = audio.createBiquadFilter();
    const bite = audio.createBiquadFilter();
    const gain = audio.createGain();

    source.buffer = noiseBuffer;
    tone.type = 'sawtooth';
    tone.frequency.setValueAtTime(word === 'hey' ? 220 : 164, t);
    tone.frequency.exponentialRampToValueAtTime(word === 'hey' ? 155 : 118, t + length);
    vowel.type = 'bandpass';
    vowel.frequency.setValueAtTime(word === 'hey' ? 980 : 620, t);
    vowel.Q.value = 5 + state.rave * 8;
    bite.type = 'bandpass';
    bite.frequency.value = word === 'hey' ? 2600 : 1300;
    bite.Q.value = 3;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.13 * velocity * state.rave, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);

    source.connect(vowel);
    tone.connect(vowel);
    vowel.connect(bite);
    bite.connect(gain);
    gain.connect(raveBus);
    source.start(t);
    tone.start(t);
    source.stop(t + length + 0.03);
    tone.stop(t + length + 0.03);
    track(length + 0.08, source, tone, vowel, bite, gain);
  };

  const playBleep = (time, midi, velocity) => {
    const t = Math.max(time, audio.currentTime + 0.001);
    const length = 0.075 + state.decay * 0.08;
    const carrier = audio.createOscillator();
    const mod = audio.createOscillator();
    const modGain = audio.createGain();
    const filter = audio.createBiquadFilter();
    const gain = audio.createGain();

    carrier.type = 'sine';
    carrier.frequency.setValueAtTime(midiToFreq(midi), t);
    mod.type = 'sine';
    mod.frequency.setValueAtTime(midiToFreq(midi + 19), t);
    modGain.gain.setValueAtTime(80 + state.rave * 260, t);
    filter.type = 'bandpass';
    filter.frequency.value = midiToFreq(midi) * 2.2;
    filter.Q.value = 7 + state.squelch * 8;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.1 * velocity * (0.35 + state.rave), t + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);

    mod.connect(modGain);
    modGain.connect(carrier.frequency);
    carrier.connect(filter);
    filter.connect(gain);
    gain.connect(raveBus);
    carrier.start(t);
    mod.start(t);
    carrier.stop(t + length + 0.03);
    mod.stop(t + length + 0.03);
    track(length + 0.08, carrier, mod, modGain, filter, gain);
  };

  const syncAudio = () => {
    shaper.curve = makeDriveCurve();
    shaper.oversample = '2x';
    master.gain.setTargetAtTime(state.running ? state.volume : 0, audio.currentTime, 0.02);
    acidBus.gain.setTargetAtTime(0.25 + state.squelch * 0.34, audio.currentTime, 0.04);
    raveBus.gain.setTargetAtTime(0.08 + state.rave * 0.44, audio.currentTime, 0.04);
    wet.gain.setTargetAtTime(0.08 + state.squelch * 0.12 + state.rave * 0.16, audio.currentTime, 0.04);
    feedback.gain.setTargetAtTime(0.1 + state.drive * 0.14 + state.rave * 0.12, audio.currentTime, 0.04);
  };

  const handleTick = ({ step, time, duration }) => {
    if (destroyed) return;
    if (Number.isFinite(duration) && duration > 0) clockStepSeconds = duration;
    currentStep = ((step % 16) + 16) % 16;
    render();
    if (!state.running) return;

    const pattern = patterns[state.pattern] || patterns[0];
    const swing = currentStep % 2 ? clockStepSeconds * state.shuffle * 0.22 : 0;
    const t = time + swing;
    const accent = currentStep % 4 === 0 ? 1 : 0;

    delay.delayTime.setTargetAtTime(clockStepSeconds * (1.2 + state.shuffle * 0.8), audio.currentTime, 0.03);

    if (pattern.kick[currentStep]) playKick(t, pattern.kick[currentStep] * (accent ? 1.08 : 0.9));
    if (pattern.snare[currentStep]) playSnare(t, pattern.snare[currentStep]);
    if (pattern.clap[currentStep]) playClap(t + 0.004, pattern.clap[currentStep]);
    if (pattern.hat[currentStep]) playHat(t, pattern.hat[currentStep], currentStep % 8 === 6 || currentStep === 15);
    if (pattern.acid[currentStep] !== null) {
      playAcid(t + clockStepSeconds * 0.018, pattern.acid[currentStep], 0.75 + accent * 0.25, Boolean(accent));
    }
    if (state.rave > 0.02) {
      if (pattern.crash[currentStep]) playCrash(t, pattern.crash[currentStep]);
      if (pattern.stab[currentStep] !== null) {
        playRaveStab(t + clockStepSeconds * 0.04, pattern.stab[currentStep], 0.75 + accent * 0.2, currentStep >= 8);
      }
      if (pattern.hoover[currentStep] !== null && state.rave > 0.35) {
        playHoover(t, pattern.hoover[currentStep], 0.55 + state.rave * 0.35);
      }
      if (pattern.siren[currentStep]) {
        playSiren(t, pattern.siren[currentStep], currentStep < 12);
      }
      if (pattern.vox[currentStep]) {
        playVox(t + clockStepSeconds * 0.02, pattern.vox[currentStep], 0.72);
      }
      if (pattern.bleep[currentStep] !== null) {
        playBleep(t + clockStepSeconds * 0.015, pattern.bleep[currentStep], currentStep % 4 === 0 ? 1 : 0.68);
      }
    }
  };

  ctx.domRoot.innerHTML = `
    <style>
      :host { display: block; height: 100%; }
      .acid {
        box-sizing: border-box;
        height: 100%;
        min-width: 280px;
        min-height: 220px;
        padding: 10px;
        display: grid;
        grid-template-rows: auto auto auto 1fr;
        gap: 9px;
        overflow: hidden;
        color: #eef2ff;
        background:
          linear-gradient(135deg, rgba(9, 10, 12, 0.98), rgba(15, 19, 18, 0.98) 54%, rgba(22, 18, 13, 0.98)),
          repeating-linear-gradient(90deg, rgba(251, 191, 36, 0.08) 0 1px, transparent 1px 18px);
        border: 1px solid rgba(250, 204, 21, 0.5);
        border-radius: 8px;
        font: 11px/1.25 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }
      .top {
        min-width: 0;
        display: grid;
        grid-template-columns: 1fr auto;
        align-items: center;
        gap: 8px;
      }
      h2 {
        margin: 0;
        color: #fde68a;
        font: 700 13px/1 ui-sans-serif, system-ui, sans-serif;
        letter-spacing: 0;
      }
      .sub {
        margin-top: 2px;
        color: #94a3b8;
        font-size: 9px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      button,
      select,
      input {
        font: inherit;
      }
      button {
        height: 28px;
        min-width: 50px;
        color: #0f172a;
        background: #facc15;
        border: 1px solid rgba(254, 240, 138, 0.72);
        border-radius: 5px;
        cursor: pointer;
      }
      button.off {
        color: #cbd5e1;
        background: rgba(15, 23, 42, 0.8);
        border-color: rgba(148, 163, 184, 0.42);
      }
      .controls {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px 10px;
      }
      label {
        min-width: 0;
        display: grid;
        grid-template-columns: 52px minmax(0, 1fr) 34px;
        align-items: center;
        gap: 6px;
        color: #cbd5e1;
      }
      input[type="range"] {
        width: 100%;
        min-width: 0;
        accent-color: #facc15;
      }
      .pattern {
        display: grid;
        grid-template-columns: 52px minmax(0, 1fr);
        align-items: center;
        gap: 6px;
        color: #cbd5e1;
      }
      select {
        min-width: 0;
        height: 24px;
        color: #fefce8;
        background: rgba(2, 6, 23, 0.72);
        border: 1px solid rgba(250, 204, 21, 0.36);
        border-radius: 5px;
      }
      .grid {
        min-height: 0;
        display: grid;
        grid-template-rows: repeat(11, minmax(0, 1fr));
        gap: 4px;
      }
      .row {
        min-height: 0;
        display: grid;
        grid-template-columns: 36px repeat(16, minmax(8px, 1fr));
        gap: 3px;
        align-items: stretch;
      }
      .name {
        color: #94a3b8;
        display: grid;
        align-items: center;
        font-size: 9px;
      }
      .cell {
        min-width: 0;
        border: 1px solid rgba(148, 163, 184, 0.2);
        background: rgba(15, 23, 42, 0.82);
        border-radius: 3px;
        opacity: 0.48;
      }
      .cell.on.kick { background: #f43f5e; border-color: rgba(251, 113, 133, 0.74); }
      .cell.on.snare { background: #22d3ee; border-color: rgba(103, 232, 249, 0.72); }
      .cell.on.hat { background: #eab308; border-color: rgba(254, 240, 138, 0.68); }
      .cell.on.acid { background: #84cc16; border-color: rgba(190, 242, 100, 0.72); }
      .cell.on.clap { background: #a78bfa; border-color: rgba(196, 181, 253, 0.72); }
      .cell.on.crash { background: #f97316; border-color: rgba(253, 186, 116, 0.72); }
      .cell.on.stab { background: #38bdf8; border-color: rgba(125, 211, 252, 0.72); }
      .cell.on.hoover { background: #fb7185; border-color: rgba(251, 113, 133, 0.72); }
      .cell.on.siren { background: #facc15; border-color: rgba(254, 240, 138, 0.72); }
      .cell.on.vox { background: #f472b6; border-color: rgba(249, 168, 212, 0.72); }
      .cell.on.bleep { background: #2dd4bf; border-color: rgba(94, 234, 212, 0.72); }
      .cell.play {
        opacity: 1;
        transform: translateY(-1px);
        box-shadow: 0 0 10px rgba(250, 204, 21, 0.62);
      }
    </style>
    <div class="acid">
      <div class="top">
        <div>
          <h2>Acid Drum</h2>
          <div class="sub">80s warehouse techno step machine</div>
        </div>
        <button id="run" type="button"></button>
      </div>
      <div class="controls">
        <label>vol <input id="volume" type="range" min="0" max="1.2" step="0.01"><span id="volumeVal"></span></label>
        <label>drive <input id="drive" type="range" min="0" max="1" step="0.01"><span id="driveVal"></span></label>
        <label>squelch <input id="squelch" type="range" min="0" max="1" step="0.01"><span id="squelchVal"></span></label>
        <label>decay <input id="decay" type="range" min="0" max="1" step="0.01"><span id="decayVal"></span></label>
        <label>club <input id="rave" type="range" min="0" max="1" step="0.01"><span id="raveVal"></span></label>
      </div>
      <div class="pattern">
        <span>mode</span>
        <select id="pattern">
          <option value="0">basement</option>
          <option value="1">warehouse</option>
          <option value="2">detroit</option>
        </select>
      </div>
      <div id="grid" class="grid"></div>
    </div>
  `;

  const $ = (selector) => ctx.domRoot.querySelector(selector);
  const runButton = $('#run');
  const gridEl = $('#grid');
  const patternSelect = $('#pattern');
  const sliders = {
    volume: $('#volume'),
    drive: $('#drive'),
    squelch: $('#squelch'),
    decay: $('#decay'),
    rave: $('#rave')
  };
  const values = {
    volume: $('#volumeVal'),
    drive: $('#driveVal'),
    squelch: $('#squelchVal'),
    decay: $('#decayVal'),
    rave: $('#raveVal')
  };

  const renderGrid = () => {
    const pattern = patterns[state.pattern] || patterns[0];
    const rows = [
      ['kick', 'kick', pattern.kick],
      ['snare', 'snare', pattern.snare],
      ['clap', 'clap', pattern.clap],
      ['hat', 'hat', pattern.hat],
      ['acid', 'acid', pattern.acid],
      ['crash', 'crash', pattern.crash],
      ['stab', 'stab', pattern.stab],
      ['hoover', 'hoover', pattern.hoover],
      ['siren', 'siren', pattern.siren],
      ['vox', 'vox', pattern.vox],
      ['bleep', 'bleep', pattern.bleep]
    ];
    gridEl.innerHTML = rows.map(([label, className, row]) => `
      <div class="row">
        <div class="name">${label}</div>
        ${row.map((value, index) => `<div class="cell ${className} ${value ? 'on' : ''} ${index === currentStep ? 'play' : ''}"></div>`).join('')}
      </div>
    `).join('');
  };

  const render = () => {
    runButton.textContent = state.running ? 'stop' : 'play';
    runButton.classList.toggle('off', !state.running);
    patternSelect.value = String(state.pattern);
    Object.entries(sliders).forEach(([key, input]) => {
      if (input.value !== String(state[key])) input.value = String(state[key]);
      values[key].textContent = state[key].toFixed(2);
    });
    renderGrid();
  };

  const onRun = () => {
    state.running = !state.running;
    syncAudio();
    render();
  };

  const onPattern = () => {
    state.pattern = clamp(Number(patternSelect.value), 0, patterns.length - 1);
    render();
  };

  const sliderHandlers = Object.fromEntries(Object.keys(sliders).map((key) => [key, () => {
    state[key] = Number(sliders[key].value);
    syncAudio();
    render();
  }]));

  runButton.addEventListener('click', onRun);
  patternSelect.addEventListener('change', onPattern);
  Object.entries(sliderHandlers).forEach(([key, handler]) => sliders[key].addEventListener('input', handler));

  const unsubscribeClock = ctx.clock.onTick(handleTick);
  syncAudio();
  render();

  return {
    update() {},
    getState() {
      return { ...state };
    },
    destroy() {
      destroyed = true;
      unsubscribeClock();
      runButton.removeEventListener('click', onRun);
      patternSelect.removeEventListener('change', onPattern);
      Object.entries(sliderHandlers).forEach(([key, handler]) => sliders[key].removeEventListener('input', handler));
      cleanupTimers.forEach((timer) => clearTimeout(timer));
      cleanupTimers.clear();
      for (const node of liveNodes) {
        try { if (typeof node.stop === 'function') node.stop(); } catch (_) {}
        try { if (typeof node.disconnect === 'function') node.disconnect(); } catch (_) {}
      }
      liveNodes.clear();
      try {
        master.disconnect(); drumBus.disconnect(); acidBus.disconnect(); raveBus.disconnect(); shaper.disconnect();
        compressor.disconnect(); delay.disconnect(); feedback.disconnect(); delayTone.disconnect(); wet.disconnect();
      } catch (_) {}
    }
  };
}
