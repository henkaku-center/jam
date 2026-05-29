// Zefiro-controlled orb synth loop.
// Breath queues the loop on the next bar. Lip/mod, tilt, and roll shape
// brightness, orbit/root, and shimmer while the phrase follows the Jam clock.

export default function setup(ctx, prevState) {
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;

  const state = {
    enabled: prevState?.enabled ?? true,
    loopActive: prevState?.loopActive ?? false,
    volume: finite(prevState?.volume, 0.72),
    threshold: finite(prevState?.threshold, 0.16),
    manualBreath: finite(prevState?.manualBreath, 0),
    manualTone: finite(prevState?.manualTone ?? prevState?.manualBright, 0.62),
    manualOrbit: finite(prevState?.manualOrbit ?? prevState?.manualLift, 0.46),
    manualShimmer: finite(prevState?.manualShimmer ?? prevState?.manualVibe, 0.48)
  };

  let midiBreath = null;
  let midiTone = null;
  let midiOrbit = null;
  let midiShimmer = null;
  let previousBreath = 0;
  let armed = true;
  let pendingStart = false;
  let clockStepSeconds = 0.125;
  let currentStep = -1;
  let pulse = 0;

  const audio = ctx.audioCtx;
  const output = audio.createGain();
  const compressor = audio.createDynamicsCompressor();
  const delay = audio.createDelay(1.4);
  const feedback = audio.createGain();
  const delayTone = audio.createBiquadFilter();
  const wet = audio.createGain();

  output.gain.value = 0;
  compressor.threshold.value = -18;
  compressor.knee.value = 18;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.004;
  compressor.release.value = 0.16;
  delay.delayTime.value = 0.24;
  feedback.gain.value = 0.32;
  delayTone.type = 'lowpass';
  delayTone.frequency.value = 4200;
  wet.gain.value = 0.26;

  output.connect(compressor);
  compressor.connect(ctx.audioOut);
  delay.connect(delayTone);
  delayTone.connect(feedback);
  feedback.connect(delay);
  delayTone.connect(wet);
  wet.connect(output);

  const liveNodes = new Set();
  const cleanupTimers = new Set();

  const track = (seconds, ...nodes) => {
    nodes.forEach((node) => liveNodes.add(node));
    const timer = setTimeout(() => {
      cleanupTimers.delete(timer);
      nodes.forEach((node) => {
        try { if (typeof node.disconnect === 'function') node.disconnect(); } catch (_) {}
        liveNodes.delete(node);
      });
    }, Math.max(120, seconds * 1000 + 180));
    cleanupTimers.add(timer);
  };

  const values = () => ({
    breath: clamp(midiBreath ?? state.manualBreath, 0, 1),
    tone: clamp(midiTone ?? state.manualTone, 0, 1),
    orbit: clamp(midiOrbit ?? state.manualOrbit, 0, 1),
    shimmer: clamp(midiShimmer ?? state.manualShimmer, 0, 1)
  });

  const midiToFreq = (midi) => 440 * Math.pow(2, (midi + 24 - 69) / 12);

  const makeDriveCurve = (amount) => {
    const curve = new Float32Array(256);
    for (let i = 0; i < curve.length; i += 1) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * amount);
    }
    return curve;
  };

  const noiseBuffer = (() => {
    const bufferSize = Math.floor(audio.sampleRate * 0.9);
    const buffer = audio.createBuffer(1, bufferSize, audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i += 1) {
      const crackle = Math.random() * 2 - 1;
      data[i] = crackle * (0.76 + Math.random() * 0.24);
    }
    return buffer;
  })();

  const randomFor = (step, salt) => {
    const raw = Math.sin((step + 1) * 131.9 + salt * 313.37) * 43758.5453;
    return raw - Math.floor(raw);
  };

  const playKick = (time, velocity, punch = 1) => {
    const { tone } = values();
    const t = Math.max(time, audio.currentTime + 0.001);
    const osc = audio.createOscillator();
    const click = audio.createOscillator();
    const bodyGain = audio.createGain();
    const clickGain = audio.createGain();
    const shaper = audio.createWaveShaper();

    osc.type = 'sine';
    click.type = 'triangle';
    osc.frequency.setValueAtTime(128 + punch * 22, t);
    osc.frequency.exponentialRampToValueAtTime(42 + tone * 7, t + 0.22);
    click.frequency.setValueAtTime(1120 + tone * 700, t);
    click.frequency.exponentialRampToValueAtTime(92, t + 0.026);
    bodyGain.gain.setValueAtTime(0.0001, t);
    bodyGain.gain.exponentialRampToValueAtTime(0.46 * velocity, t + 0.006);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.32 + punch * 0.06);
    clickGain.gain.setValueAtTime(0.07 * velocity, t);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.034);
    shaper.curve = makeDriveCurve(1.6 + punch * 2.2 + tone * 1.6);
    shaper.oversample = '2x';

    osc.connect(bodyGain);
    bodyGain.connect(shaper);
    shaper.connect(output);
    click.connect(clickGain);
    clickGain.connect(output);
    osc.start(t);
    click.start(t);
    osc.stop(t + 0.44);
    click.stop(t + 0.045);
    track(0.5, osc, click, bodyGain, clickGain, shaper);
  };

  const playSnare = (time, velocity, tight = false) => {
    const { tone, shimmer } = values();
    const t = Math.max(time, audio.currentTime + 0.001);
    const noise = audio.createBufferSource();
    const noiseFilter = audio.createBiquadFilter();
    const noiseGain = audio.createGain();
    const body = audio.createOscillator();
    const bodyGain = audio.createGain();
    const snap = audio.createBiquadFilter();
    const length = tight ? 0.095 : 0.18 + shimmer * 0.06;

    noise.buffer = noiseBuffer;
    noiseFilter.type = 'bandpass';
    noiseFilter.frequency.setValueAtTime(1450 + tone * 1700 + shimmer * 900, t);
    noiseFilter.Q.setValueAtTime(tight ? 1.6 : 0.8, t);
    snap.type = 'highpass';
    snap.frequency.setValueAtTime(1200 + tone * 1800, t);
    noiseGain.gain.setValueAtTime(0.0001, t);
    noiseGain.gain.exponentialRampToValueAtTime((tight ? 0.12 : 0.28) * velocity, t + 0.005);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, t + length);

    body.type = 'triangle';
    body.frequency.setValueAtTime(tight ? 248 : 194, t);
    body.frequency.exponentialRampToValueAtTime(tight ? 190 : 145, t + 0.08);
    bodyGain.gain.setValueAtTime((tight ? 0.035 : 0.07) * velocity, t);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);

    noise.connect(noiseFilter);
    noiseFilter.connect(snap);
    snap.connect(noiseGain);
    noiseGain.connect(output);
    if (!tight) noiseGain.connect(delay);
    body.connect(bodyGain);
    bodyGain.connect(output);
    noise.start(t, 0, length + 0.02);
    body.start(t);
    body.stop(t + 0.14);
    track(length + 0.08, noise, noiseFilter, snap, noiseGain, body, bodyGain);
  };

  const playHat = (time, velocity, open = false) => {
    const { tone, shimmer } = values();
    const t = Math.max(time, audio.currentTime + 0.001);
    const noise = audio.createBufferSource();
    const highpass = audio.createBiquadFilter();
    const gain = audio.createGain();
    const panner = typeof audio.createStereoPanner === 'function' ? audio.createStereoPanner() : null;
    const length = open ? 0.3 + shimmer * 0.18 : 0.045 + shimmer * 0.035;

    noise.buffer = noiseBuffer;
    highpass.type = 'highpass';
    highpass.frequency.setValueAtTime(open ? 4300 + tone * 1300 : 6100 + tone * 2600, t);
    highpass.Q.setValueAtTime(open ? 0.65 : 1.1, t);
    gain.gain.setValueAtTime((open ? 0.105 : 0.045) * velocity, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    if (panner) panner.pan.setValueAtTime(open ? 0.34 : -0.18 + randomFor(Math.round(t * 100), 7) * 0.36, t);

    noise.connect(highpass);
    highpass.connect(gain);
    if (panner) {
      gain.connect(panner);
      panner.connect(output);
    } else {
      gain.connect(output);
    }
    noise.start(t, 0, length + 0.02);
    track(length + 0.08, noise, highpass, gain, ...(panner ? [panner] : []));
  };

  const playRim = (time, velocity) => {
    const { tone } = values();
    const t = Math.max(time, audio.currentTime + 0.001);
    const osc = audio.createOscillator();
    const filter = audio.createBiquadFilter();
    const gain = audio.createGain();
    const panner = typeof audio.createStereoPanner === 'function' ? audio.createStereoPanner() : null;

    osc.type = 'square';
    osc.frequency.setValueAtTime(720 + tone * 420, t);
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(980 + tone * 900, t);
    filter.Q.setValueAtTime(9, t);
    gain.gain.setValueAtTime(0.06 * velocity, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    if (panner) panner.pan.setValueAtTime(-0.42, t);

    osc.connect(filter);
    filter.connect(gain);
    if (panner) {
      gain.connect(panner);
      panner.connect(output);
      panner.connect(delay);
    } else {
      gain.connect(output);
      gain.connect(delay);
    }
    osc.start(t);
    osc.stop(t + 0.09);
    track(0.14, osc, filter, gain, ...(panner ? [panner] : []));
  };

  const playTom = (time, velocity, high = false) => {
    const { orbit } = values();
    const t = Math.max(time, audio.currentTime + 0.001);
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    const filter = audio.createBiquadFilter();
    const startFreq = high ? 210 + orbit * 80 : 132 + orbit * 42;
    const endFreq = high ? 92 + orbit * 38 : 64 + orbit * 24;

    osc.type = 'sine';
    osc.frequency.setValueAtTime(startFreq, t);
    osc.frequency.exponentialRampToValueAtTime(endFreq, t + 0.18);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(high ? 1200 : 820, t);
    filter.Q.setValueAtTime(2.2, t);
    gain.gain.setValueAtTime(0.12 * velocity, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(output);
    gain.connect(delay);
    osc.start(t);
    osc.stop(t + 0.28);
    track(0.34, osc, filter, gain);
  };

  const playShamisenPluck = (time, midi, velocity, length, pan = 0, bend = 0) => {
    const { tone, shimmer } = values();
    const t = Math.max(time, audio.currentTime + 0.001);
    const freq = midiToFreq(midi);
    const stringA = audio.createOscillator();
    const stringB = audio.createOscillator();
    const pick = audio.createBufferSource();
    const body = audio.createBiquadFilter();
    const nasal = audio.createBiquadFilter();
    const pickFilter = audio.createBiquadFilter();
    const drive = audio.createWaveShaper();
    const stringGain = audio.createGain();
    const pickGain = audio.createGain();
    const finalGain = audio.createGain();
    const panner = typeof audio.createStereoPanner === 'function' ? audio.createStereoPanner() : null;
    const decay = clamp(length, 0.08, 0.42);

    stringA.type = 'sawtooth';
    stringB.type = 'square';
    stringA.frequency.setValueAtTime(freq * (1 + bend * 0.012), t);
    stringA.frequency.exponentialRampToValueAtTime(freq * 0.992, t + decay * 0.7);
    stringB.frequency.setValueAtTime(freq * 2.01, t);
    stringB.frequency.exponentialRampToValueAtTime(freq * 1.98, t + decay * 0.48);
    stringA.detune.setValueAtTime(-5 - shimmer * 9, t);
    stringB.detune.setValueAtTime(7 + tone * 12, t);

    pick.buffer = noiseBuffer;
    pickFilter.type = 'highpass';
    pickFilter.frequency.setValueAtTime(2600 + tone * 1800, t);
    pickFilter.Q.setValueAtTime(0.7, t);
    pickGain.gain.setValueAtTime(0.11 * velocity, t);
    pickGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.026);

    body.type = 'bandpass';
    body.frequency.setValueAtTime(760 + tone * 520, t);
    body.Q.setValueAtTime(4.6 + shimmer * 3.4, t);
    nasal.type = 'peaking';
    nasal.frequency.setValueAtTime(1650 + tone * 900, t);
    nasal.Q.setValueAtTime(6.5, t);
    nasal.gain.setValueAtTime(7 + shimmer * 4, t);
    drive.curve = makeDriveCurve(2.4 + tone * 4.2);
    drive.oversample = '2x';

    stringGain.gain.setValueAtTime(0.0001, t);
    stringGain.gain.exponentialRampToValueAtTime(0.12 * velocity, t + 0.004);
    stringGain.gain.exponentialRampToValueAtTime(0.018 * velocity, t + 0.04);
    stringGain.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    finalGain.gain.setValueAtTime(0.88, t);

    stringA.connect(stringGain);
    stringB.connect(stringGain);
    stringGain.connect(body);
    body.connect(nasal);
    nasal.connect(drive);
    pick.connect(pickFilter);
    pickFilter.connect(pickGain);
    pickGain.connect(drive);
    drive.connect(finalGain);
    if (panner) {
      finalGain.connect(panner);
      panner.pan.setValueAtTime(pan, t);
      panner.connect(output);
      panner.connect(delay);
    } else {
      finalGain.connect(output);
      finalGain.connect(delay);
    }

    stringA.start(t);
    stringB.start(t);
    pick.start(t, 0, 0.04);
    stringA.stop(t + decay + 0.04);
    stringB.stop(t + decay + 0.04);
    track(decay + 0.1, stringA, stringB, pick, body, nasal, pickFilter, drive, stringGain, pickGain, finalGain, ...(panner ? [panner] : []));
  };

  const playShamisenStep = (step, time, stepSeconds, root, expression) => {
    const { orbit, shimmer } = values();
    const phraseStep = step % 32;
    const barStep = step % 16;
    const phrase = [0, 3, 5, 7, 10, 12, 10, 7, 5, 3, 0, -2, 0, 5, 7, 10];
    const altPhrase = [0, 5, 7, 10, 12, 15, 12, 10, 7, 5, 3, 0, -2, 0, 3, 5];
    const hits = shimmer > 0.55
      ? [0, 2, 3, 6, 8, 10, 11, 14, 15]
      : [0, 3, 6, 8, 11, 14];
    if (!hits.includes(barStep)) return;

    const selected = shimmer > 0.66 ? altPhrase : phrase;
    const note = root + 12 + selected[barStep] + (phraseStep >= 16 ? 12 : 0);
    const accent = barStep === 0 || barStep === 8 ? 1 : barStep % 3 === 0 ? 0.78 : 0.58;
    const swing = barStep % 2 ? stepSeconds * (0.04 + orbit * 0.08) : 0;
    const length = stepSeconds * (0.7 + shimmer * 0.75);
    const pan = 0.28 - (barStep % 4) * 0.16;
    const velocity = clamp(expression * accent * (0.62 + shimmer * 0.22), 0.08, 0.76);
    const micro = (randomFor(step, 41) - 0.5) * 0.008;

    playShamisenPluck(time + swing + micro, note, velocity, length, pan, orbit - 0.5);
    if (shimmer > 0.72 && [3, 11, 15].includes(barStep)) {
      playShamisenPluck(time + swing + stepSeconds * 0.34, note + 12, velocity * 0.48, stepSeconds * 0.42, -pan, 0.4);
    }
  };

  const playDrumStep = (step, time, stepSeconds, expression) => {
    const { tone, orbit, shimmer } = values();
    const swing = step % 2 ? stepSeconds * (0.02 + orbit * 0.1) : 0;
    const phraseStep = step % 32;
    const barStep = step % 16;
    const variation = shimmer > 0.52 || phraseStep >= 24;
    const breathPush = clamp(0.62 + expression * 0.34, 0.55, 1.05);
    const human = (salt) => (randomFor(step, salt) - 0.5) * 0.006;
    const at = time + swing;

    const kickPattern = [1, 0, 0.22, 0.36, 0, 0.18, 0.68, 0, 0.9, 0, 0.4, 0.16, 0.52, 0, 0.18, 0.42];
    const snarePattern = [0, 0, 0.12, 0.22, 0.86, 0.18, 0, 0.24, 0, 0.14, 0.2, 0.32, 0.94, 0.18, 0.3, 0.46];
    const rimPattern = [0, 0.28, 0, 0, 0, 0, 0.24, 0, 0, 0.18, 0, 0.26, 0, 0, 0.22, 0];
    const tomPattern = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.22, 0, 0, 0.2, 0, 0.42];

    let kickVelocity = kickPattern[barStep];
    if (variation && [23, 27, 30, 31].includes(phraseStep)) kickVelocity = Math.max(kickVelocity, phraseStep === 31 ? 0.74 : 0.36);
    if (kickVelocity) playKick(at + human(2), clamp(kickVelocity * breathPush, 0.06, 1), barStep % 8 === 0 ? 1.12 : 0.78);

    let snareVelocity = snarePattern[barStep];
    if (!variation && snareVelocity < 0.28) snareVelocity *= 0.45;
    if (variation && [14, 15, 30, 31].includes(phraseStep)) snareVelocity = Math.max(snareVelocity, phraseStep % 2 ? 0.56 : 0.38);
    if (snareVelocity) playSnare(at + human(3), clamp(snareVelocity * (0.82 + tone * 0.28), 0.04, 0.98), snareVelocity < 0.38);

    const hatBase = barStep % 2 === 0 ? 0.46 : 0.58;
    const hatAccent = barStep % 4 === 3 ? 1.18 : barStep % 4 === 1 ? 0.86 : 1;
    playHat(at + human(4), clamp(hatBase * hatAccent * (0.78 + shimmer * 0.42), 0.08, 0.85), false);
    if (variation && shimmer > 0.62 && [6, 7, 14, 15].includes(barStep)) {
      playHat(at + stepSeconds * 0.48 + human(5), 0.34 + shimmer * 0.22, false);
    }
    if ([3, 7, 11, 15].includes(barStep) && shimmer > 0.34) {
      playHat(at + stepSeconds * 0.72 + human(6), 0.22 + shimmer * 0.18, false);
    }
    if ([2, 6, 10, 14].includes(barStep)) {
      playHat(at + stepSeconds * (0.38 + orbit * 0.12) + human(7), clamp(0.34 + shimmer * 0.38, 0.16, 0.78), true);
    }

    const rimVelocity = rimPattern[barStep];
    if (rimVelocity && (variation || randomFor(step, 9) > 0.32)) playRim(at + stepSeconds * 0.24 + human(8), rimVelocity * (0.72 + tone * 0.44));

    let tomVelocity = tomPattern[barStep];
    if (variation && phraseStep >= 28 && barStep % 2 === 0) tomVelocity = Math.max(tomVelocity, 0.22 + (barStep === 14 ? 0.2 : 0));
    if (tomVelocity) playTom(at + stepSeconds * 0.52 + human(10), tomVelocity * (0.72 + orbit * 0.48), barStep < 12);
  };

  const playOrbNote = (time, midi, velocity, length, pan = 0, octaveGlow = false) => {
    const { tone, shimmer } = values();
    const t = Math.max(time, audio.currentTime + 0.001);
    const freq = midiToFreq(midi);
    const oscA = audio.createOscillator();
    const oscB = audio.createOscillator();
    const gain = audio.createGain();
    const filter = audio.createBiquadFilter();
    const shaper = audio.createWaveShaper();
    const panner = typeof audio.createStereoPanner === 'function' ? audio.createStereoPanner() : null;

    oscA.type = tone > 0.52 ? 'sawtooth' : 'triangle';
    oscB.type = octaveGlow ? 'sine' : 'square';
    oscA.frequency.setValueAtTime(freq, t);
    oscB.frequency.setValueAtTime(freq * (octaveGlow ? 2 : 1.005), t);
    oscA.detune.setValueAtTime(-4 - shimmer * 7, t);
    oscB.detune.setValueAtTime(5 + shimmer * 11, t);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(720 + tone * 6200 + velocity * 1700, t);
    filter.frequency.exponentialRampToValueAtTime(280 + tone * 1600, t + length);
    filter.Q.setValueAtTime(4 + tone * 10, t);
    shaper.curve = makeDriveCurve(1.1 + tone * 5.5);
    shaper.oversample = '2x';
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.15 * velocity, t + 0.014);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    if (panner) panner.pan.setValueAtTime(pan, t);

    oscA.connect(filter);
    oscB.connect(filter);
    filter.connect(shaper);
    shaper.connect(gain);
    if (panner) {
      gain.connect(panner);
      panner.connect(output);
      panner.connect(delay);
    } else {
      gain.connect(output);
      gain.connect(delay);
    }

    oscA.start(t);
    oscB.start(t);
    oscA.stop(t + length + 0.04);
    oscB.stop(t + length + 0.04);
    track(length + 0.08, oscA, oscB, gain, filter, shaper, ...(panner ? [panner] : []));
  };

  const playOrbBass = (time, midi, velocity, length) => {
    const { tone } = values();
    const t = Math.max(time, audio.currentTime + 0.001);
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    const filter = audio.createBiquadFilter();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(midiToFreq(midi), t);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(180 + tone * 680, t);
    filter.Q.setValueAtTime(2.8, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.16 * velocity, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(output);
    osc.start(t);
    osc.stop(t + length + 0.04);
    track(length + 0.08, osc, gain, filter);
  };

  const activateLoop = () => {
    pendingStart = false;
    state.loopActive = true;
    pulse = 1;
    syncUi();
  };

  const startLoop = () => {
    if (!state.enabled) return;
    pendingStart = true;
    pulse = 0.45;
    syncUi();
  };

  const stopLoop = () => {
    pendingStart = false;
    state.loopActive = false;
    pulse = 0.25;
    syncUi();
  };

  const handleClockTick = ({ step, time, duration }) => {
    if (Number.isFinite(duration) && duration > 0) clockStepSeconds = duration;
    currentStep = step % 16;
    if (pendingStart && currentStep === 0) activateLoop();
    if (!state.enabled || !state.loopActive) return;

    const { breath, tone, orbit, shimmer } = values();
    const root = 45 + Math.round(orbit * 9);
    const phrase = [0, 7, 12, 14, 19, 14, 12, 7, 0, 5, 12, 17, 21, 17, 12, 10];
    const alt = [0, 3, 10, 15, 22, 15, 10, 3, 0, 8, 12, 20, 24, 20, 12, 8];
    const sequence = shimmer > 0.58 ? alt : phrase;
    const stepSeconds = clamp(duration || clockStepSeconds, 0.07, 0.32);
    const expression = clamp(0.52 + breath * 0.62, 0.25, 1.12);
    const accent = currentStep % 4 === 0 ? 1 : currentStep % 2 === 0 ? 0.76 : 0.58;
    const pan = ((currentStep % 8) - 3.5) / 4.5;
    const swing = currentStep % 2 ? stepSeconds * (0.02 + orbit * 0.11) : 0;
    const octaveLift = currentStep >= 12 ? 12 : currentStep >= 8 ? 5 : 0;
    const note = root + sequence[currentStep] + octaveLift;
    const length = stepSeconds * (0.58 + shimmer * 0.82);

    delay.delayTime.setTargetAtTime(stepSeconds * (1.2 + shimmer * 1.25), audio.currentTime, 0.04);
    feedback.gain.setTargetAtTime(0.18 + shimmer * 0.42, audio.currentTime, 0.05);
    delayTone.frequency.setTargetAtTime(1600 + tone * 6200, audio.currentTime, 0.05);

    playOrbNote(time + swing, note, clamp(expression * accent, 0.12, 1), length, pan, currentStep % 4 === 3);
    if (currentStep % 4 === 0) {
      playOrbBass(time + swing, root - 12 + (currentStep === 8 ? 5 : 0), clamp(expression * 0.76, 0.1, 1), stepSeconds * 2.8);
    }
    if (shimmer > 0.66 && currentStep % 4 === 2) {
      playOrbNote(time + swing + stepSeconds * 0.48, note + 12, clamp(expression * 0.38, 0.08, 0.7), stepSeconds * 0.7, -pan, true);
    }
    playShamisenStep(step, time, stepSeconds, root, expression);
    playDrumStep(step, time, stepSeconds, expression);

    pulse = Math.max(pulse, 0.5 + accent * 0.45);
  };

  ctx.domRoot.innerHTML = `
    <style>
      .root {
        box-sizing: border-box;
        height: 100%;
        min-width: 280px;
        padding: 10px 12px;
        background: #06070d;
        color: #e5eef6;
        font: 11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace;
        display: grid;
        grid-template-rows: auto auto auto 1fr;
        gap: 8px;
        overflow: hidden;
      }
      .top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      h1 {
        margin: 0;
        color: #a5f3fc;
        font: 700 12px/1 ui-sans-serif, system-ui, sans-serif;
        letter-spacing: 0;
      }
      .buttons {
        display: flex;
        gap: 5px;
      }
      button {
        border: 1px solid #2563eb;
        background: #0f172a;
        color: #dbeafe;
        border-radius: 4px;
        font: inherit;
        padding: 3px 7px;
        cursor: pointer;
      }
      button.on {
        background: #0e7490;
        border-color: #67e8f9;
      }
      label {
        display: grid;
        grid-template-columns: 72px 1fr 34px;
        align-items: center;
        gap: 7px;
        color: #cbd5e1;
      }
      input[type="range"] {
        width: 100%;
        accent-color: #22d3ee;
      }
      .meter {
        display: grid;
        grid-template-columns: 52px 1fr 38px;
        align-items: center;
        gap: 6px;
        margin-bottom: 3px;
      }
      .bar {
        height: 8px;
        position: relative;
        overflow: hidden;
        border: 1px solid #1e3a5f;
        background: #0f172a;
      }
      .bar span {
        position: absolute;
        inset: 0 auto 0 0;
        width: 0%;
        background: linear-gradient(90deg, #22d3ee, #c084fc, #facc15);
      }
      .src {
        color: #94a3b8;
        text-align: right;
        font-size: 10px;
      }
      .orb {
        align-self: stretch;
        min-height: 58px;
        border: 1px solid #164e63;
        background: radial-gradient(circle at center, #155e75 0%, #312e81 36%, #0f172a 68%);
        display: grid;
        place-items: center;
        overflow: hidden;
      }
      .core {
        width: 48px;
        height: 48px;
        border-radius: 50%;
        background: radial-gradient(circle at 36% 30%, #fef3c7, #22d3ee 38%, #7c3aed 72%);
        box-shadow: 0 0 calc(9px + var(--pulse) * 34px) rgba(34, 211, 238, 0.78);
        transform: scale(calc(0.9 + var(--pulse) * 0.55)) rotate(calc(var(--step) * 24deg));
      }
    </style>
    <div class="root">
      <div class="top">
        <h1>ZEFIRO SHAMI DRUMS</h1>
        <div class="buttons">
          <button id="start" type="button">start</button>
          <button id="enabled" type="button" class="${state.enabled ? 'on' : ''}">${state.enabled ? 'on' : 'off'}</button>
        </div>
      </div>
      <div>
        <label>volume <input id="volume" type="range" min="0" max="1.2" step="0.01" value="${state.volume}"><span id="volumeVal"></span></label>
        <label>trigger <input id="threshold" type="range" min="0.04" max="0.7" step="0.01" value="${state.threshold}"><span id="thresholdVal"></span></label>
      </div>
      <div>
        <label>breath <input id="manualBreath" type="range" min="0" max="1" step="0.001" value="${state.manualBreath}"><span id="breathVal"></span></label>
        <label>tone <input id="manualTone" type="range" min="0" max="1" step="0.001" value="${state.manualTone}"><span id="toneVal"></span></label>
        <label>orbit <input id="manualOrbit" type="range" min="0" max="1" step="0.001" value="${state.manualOrbit}"><span id="orbitVal"></span></label>
        <label>shimmer <input id="manualShimmer" type="range" min="0" max="1" step="0.001" value="${state.manualShimmer}"><span id="shimmerVal"></span></label>
      </div>
      <div>
        <div class="meter"><span>air</span><span class="bar"><span id="breathBar"></span></span><span id="breathSrc" class="src"></span></div>
        <div class="meter"><span>tone</span><span class="bar"><span id="toneBar"></span></span><span id="toneSrc" class="src"></span></div>
        <div class="meter"><span>orbit</span><span class="bar"><span id="orbitBar"></span></span><span id="orbitSrc" class="src"></span></div>
        <div class="meter"><span>shine</span><span class="bar"><span id="shimmerBar"></span></span><span id="shimmerSrc" class="src"></span></div>
        <div class="orb"><div id="core" class="core" style="--pulse:0;--step:0"></div></div>
      </div>
    </div>
  `;

  const $ = (selector) => ctx.domRoot.querySelector(selector);
  const enabledButton = $('#enabled');
  const startButton = $('#start');
  const volumeSlider = $('#volume');
  const thresholdSlider = $('#threshold');
  const sliders = {
    manualBreath: $('#manualBreath'),
    manualTone: $('#manualTone'),
    manualOrbit: $('#manualOrbit'),
    manualShimmer: $('#manualShimmer')
  };
  const valueEls = {
    volume: $('#volumeVal'),
    threshold: $('#thresholdVal'),
    breath: $('#breathVal'),
    tone: $('#toneVal'),
    orbit: $('#orbitVal'),
    shimmer: $('#shimmerVal')
  };
  const bars = {
    breath: $('#breathBar'),
    tone: $('#toneBar'),
    orbit: $('#orbitBar'),
    shimmer: $('#shimmerBar')
  };
  const srcEls = {
    breath: $('#breathSrc'),
    tone: $('#toneSrc'),
    orbit: $('#orbitSrc'),
    shimmer: $('#shimmerSrc')
  };
  const coreEl = $('#core');

  function syncUi() {
    const { breath, tone, orbit, shimmer } = values();
    const targetGain = state.enabled && state.loopActive ? state.volume * clamp(0.56 + breath * 0.7, 0.35, 1.12) : 0;
    output.gain.setTargetAtTime(targetGain, audio.currentTime, 0.04);
    valueEls.volume.textContent = state.volume.toFixed(2);
    valueEls.threshold.textContent = state.threshold.toFixed(2);
    valueEls.breath.textContent = breath.toFixed(2);
    valueEls.tone.textContent = tone.toFixed(2);
    valueEls.orbit.textContent = orbit.toFixed(2);
    valueEls.shimmer.textContent = shimmer.toFixed(2);
    bars.breath.style.width = `${breath * 100}%`;
    bars.tone.style.width = `${tone * 100}%`;
    bars.orbit.style.width = `${orbit * 100}%`;
    bars.shimmer.style.width = `${shimmer * 100}%`;
    srcEls.breath.textContent = midiBreath === null ? 'manual' : 'zefiro';
    srcEls.tone.textContent = midiTone === null ? 'manual' : 'zefiro';
    srcEls.orbit.textContent = midiOrbit === null ? 'manual' : 'zefiro';
    srcEls.shimmer.textContent = midiShimmer === null ? 'manual' : 'zefiro';
    enabledButton.textContent = state.enabled ? 'on' : 'off';
    enabledButton.classList.toggle('on', state.enabled);
    startButton.textContent = state.loopActive ? 'stop' : pendingStart ? 'queued' : 'start';
    startButton.classList.toggle('on', state.loopActive || pendingStart);
    pulse *= state.loopActive || pendingStart ? 0.88 : 0.78;
    coreEl.style.setProperty('--pulse', pulse.toFixed(3));
    coreEl.style.setProperty('--step', String(currentStep < 0 ? 0 : currentStep));
  }

  const scanBreath = () => {
    const { breath } = values();
    const threshold = clamp(state.threshold, 0.04, 0.7);
    const rise = breath - previousBreath;
    if (breath < threshold * 0.52) armed = true;
    if (state.enabled && !state.loopActive && !pendingStart && armed && breath >= threshold && rise > 0.012) {
      startLoop();
      armed = false;
    }
    previousBreath = breath;
    syncUi();
  };

  const onEnabled = () => {
    state.enabled = !state.enabled;
    syncUi();
  };
  const onStart = () => {
    if (state.loopActive || pendingStart) stopLoop();
    else startLoop();
  };
  const onVolume = () => {
    state.volume = Number(volumeSlider.value);
    syncUi();
  };
  const onThreshold = () => {
    state.threshold = Number(thresholdSlider.value);
    syncUi();
  };
  const onManual = (key) => () => {
    state[key] = Number(sliders[key].value);
    syncUi();
  };

  enabledButton.addEventListener('click', onEnabled);
  startButton.addEventListener('click', onStart);
  volumeSlider.addEventListener('input', onVolume);
  thresholdSlider.addEventListener('input', onThreshold);
  const manualHandlers = {
    manualBreath: onManual('manualBreath'),
    manualTone: onManual('manualTone'),
    manualOrbit: onManual('manualOrbit'),
    manualShimmer: onManual('manualShimmer')
  };
  Object.entries(manualHandlers).forEach(([key, handler]) => sliders[key].addEventListener('input', handler));

  const unsubBreath = ctx.bus.subGlobal('global:zefiro:cc11', (value) => {
    if (Number.isFinite(value)) midiBreath = clamp(value, 0, 1);
  });
  const unsubTone = ctx.bus.subGlobal('global:zefiro:cc1', (value) => {
    if (Number.isFinite(value)) midiTone = clamp(value, 0, 1);
  });
  const unsubOrbit = ctx.bus.subGlobal('global:zefiro:cc16', (value) => {
    if (Number.isFinite(value)) midiOrbit = clamp(value, 0, 1);
  });
  const unsubShimmer = ctx.bus.subGlobal('global:zefiro:cc17', (value) => {
    if (Number.isFinite(value)) midiShimmer = clamp(value, 0, 1);
  });
  const unsubscribeClock = ctx.clock.onTick(handleClockTick);
  const scanner = setInterval(scanBreath, 16);
  syncUi();

  return {
    update() {},
    getState() {
      return { ...state };
    },
    destroy() {
      clearInterval(scanner);
      unsubscribeClock();
      unsubBreath();
      unsubTone();
      unsubOrbit();
      unsubShimmer();
      enabledButton.removeEventListener('click', onEnabled);
      startButton.removeEventListener('click', onStart);
      volumeSlider.removeEventListener('input', onVolume);
      thresholdSlider.removeEventListener('input', onThreshold);
      Object.entries(manualHandlers).forEach(([key, handler]) => sliders[key].removeEventListener('input', handler));
      cleanupTimers.forEach((timer) => clearTimeout(timer));
      cleanupTimers.clear();
      for (const node of liveNodes) {
        try { if (typeof node.stop === 'function') node.stop(); } catch (_) {}
        try { if (typeof node.disconnect === 'function') node.disconnect(); } catch (_) {}
      }
      liveNodes.clear();
      try {
        output.disconnect(); compressor.disconnect(); delay.disconnect(); feedback.disconnect();
        delayTone.disconnect(); wet.disconnect();
      } catch (_) {}
    }
  };
}
