export default function setup(ctx, prevState) {
  const audio = ctx.audioCtx;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;

  const state = {
    running: prevState?.running ?? true,
    rootMidi: finite(prevState?.rootMidi, 62),
    breath: finite(prevState?.breath, 0.5),
    fluteVolume: finite(prevState?.fluteVolume, 0.38),
    drumVolume: finite(prevState?.drumVolume, 0.92),
    sitarVolume: finite(prevState?.sitarVolume, 0.58),
    dholVolume: finite(prevState?.dholVolume, 0.74),
    bagpipeVolume: finite(prevState?.bagpipeVolume, 0.46),
    density: finite(prevState?.density, 0.78),
    swing: finite(prevState?.swing, 0.08)
  };

  let currentStep = -1;
  let pulse = 0;
  let lastTickAt = 0;

  const output = audio.createGain();
  const compressor = audio.createDynamicsCompressor();
  const delay = audio.createDelay(1.2);
  const delayFeedback = audio.createGain();
  const delayTone = audio.createBiquadFilter();
  const delayWet = audio.createGain();

  output.gain.value = 0.86;
  compressor.threshold.value = -18;
  compressor.knee.value = 18;
  compressor.ratio.value = 3.5;
  compressor.attack.value = 0.004;
  compressor.release.value = 0.18;
  delay.delayTime.value = 0.24;
  delayFeedback.gain.value = 0.24;
  delayTone.type = 'lowpass';
  delayTone.frequency.value = 3400;
  delayWet.gain.value = 0.2;

  output.connect(compressor);
  compressor.connect(ctx.audioOut);
  delay.connect(delayTone);
  delayTone.connect(delayFeedback);
  delayFeedback.connect(delay);
  delayTone.connect(delayWet);
  delayWet.connect(output);

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
    }, Math.max(100, seconds * 1000 + 180));
    cleanupTimers.add(timer);
  };

  const midiToFreq = (midi) => 440 * Math.pow(2, (midi + 24 - 69) / 12);

  const noiseBuffer = audio.createBuffer(1, audio.sampleRate, audio.sampleRate);
  const noise = noiseBuffer.getChannelData(0);
  for (let i = 0; i < noise.length; i += 1) {
    noise[i] = Math.random() * 2 - 1;
  }

  const makeNoise = () => {
    const source = audio.createBufferSource();
    source.buffer = noiseBuffer;
    source.loop = true;
    return source;
  };

  const playFlute = (time, midi, velocity, length, pan) => {
    const t = Math.max(time, audio.currentTime + 0.002);
    const freq = midiToFreq(midi);
    const breath = clamp(state.breath, 0, 1);
    const fluteLevel = clamp(state.fluteVolume, 0, 1);

    const tone = audio.createOscillator();
    const air = makeNoise();
    const vibrato = audio.createOscillator();
    const vibratoDepth = audio.createGain();
    const toneGain = audio.createGain();
    const airGain = audio.createGain();
    const filter = audio.createBiquadFilter();
    const airFilter = audio.createBiquadFilter();
    const amp = audio.createGain();
    const panner = typeof audio.createStereoPanner === 'function' ? audio.createStereoPanner() : null;

    tone.type = 'triangle';
    tone.frequency.setValueAtTime(freq, t);
    tone.detune.setValueAtTime(-2, t);
    vibrato.type = 'sine';
    vibrato.frequency.setValueAtTime(4.8 + breath * 1.8, t);
    vibratoDepth.gain.setValueAtTime(4 + breath * 11, t);

    toneGain.gain.setValueAtTime(0.64, t);
    airGain.gain.setValueAtTime(0.012 + breath * 0.05, t);
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(freq * (2.05 + breath * 0.2), t);
    filter.Q.setValueAtTime(6.5 - breath * 2.2, t);
    airFilter.type = 'highpass';
    airFilter.frequency.setValueAtTime(1450 + breath * 1600, t);

    const attack = 0.025 + (1 - breath) * 0.025;
    const peak = 0.18 * velocity * fluteLevel;
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
    amp.gain.setTargetAtTime(peak * 0.72, t + attack, 0.11);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + length);
    if (panner) panner.pan.setValueAtTime(pan, t);

    vibrato.connect(vibratoDepth);
    vibratoDepth.connect(tone.detune);
    tone.connect(toneGain);
    toneGain.connect(filter);
    air.connect(airFilter);
    airFilter.connect(airGain);
    filter.connect(amp);
    airGain.connect(amp);

    if (panner) {
      amp.connect(panner);
      panner.connect(output);
      panner.connect(delay);
    } else {
      amp.connect(output);
      amp.connect(delay);
    }

    tone.start(t);
    air.start(t);
    vibrato.start(t);
    tone.stop(t + length + 0.05);
    air.stop(t + length + 0.05);
    vibrato.stop(t + length + 0.05);
    track(length + 0.08, tone, air, vibrato, vibratoDepth, toneGain, airGain, filter, airFilter, amp, ...(panner ? [panner] : []));
  };

  const playSitar = (time, midi, velocity, length, pan) => {
    const t = Math.max(time, audio.currentTime + 0.002);
    const freq = midiToFreq(midi);
    const sitarLevel = clamp(state.sitarVolume, 0, 1);
    if (sitarLevel <= 0.001) return;

    const main = audio.createOscillator();
    const buzz = audio.createOscillator();
    const pluck = makeNoise();
    const mainGain = audio.createGain();
    const buzzGain = audio.createGain();
    const pluckGain = audio.createGain();
    const body = audio.createBiquadFilter();
    const bridge = audio.createBiquadFilter();
    const amp = audio.createGain();
    const panner = typeof audio.createStereoPanner === 'function' ? audio.createStereoPanner() : null;

    main.type = 'sawtooth';
    buzz.type = 'square';
    main.frequency.setValueAtTime(freq, t);
    buzz.frequency.setValueAtTime(freq * 2.01, t);
    main.detune.setValueAtTime(-5, t);
    buzz.detune.setValueAtTime(7, t);

    body.type = 'bandpass';
    body.frequency.setValueAtTime(freq * 2.7, t);
    body.Q.setValueAtTime(8.5, t);
    bridge.type = 'highpass';
    bridge.frequency.setValueAtTime(1200, t);

    mainGain.gain.setValueAtTime(0.38, t);
    buzzGain.gain.setValueAtTime(0.07 + velocity * 0.08, t);
    pluckGain.gain.setValueAtTime(0.0001, t);
    pluckGain.gain.exponentialRampToValueAtTime(0.08 * velocity * sitarLevel, t + 0.002);
    pluckGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);

    const peak = 0.16 * velocity * sitarLevel;
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + 0.006);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + length);
    if (panner) panner.pan.setValueAtTime(pan, t);

    main.connect(mainGain);
    buzz.connect(buzzGain);
    pluck.connect(bridge);
    bridge.connect(pluckGain);
    mainGain.connect(body);
    buzzGain.connect(body);
    pluckGain.connect(body);
    body.connect(amp);

    if (panner) {
      amp.connect(panner);
      panner.connect(output);
      panner.connect(delay);
    } else {
      amp.connect(output);
      amp.connect(delay);
    }

    main.start(t);
    buzz.start(t);
    pluck.start(t);
    main.stop(t + length + 0.04);
    buzz.stop(t + length + 0.04);
    pluck.stop(t + Math.min(0.08, length));
    track(length + 0.08, main, buzz, pluck, mainGain, buzzGain, pluckGain, body, bridge, amp, ...(panner ? [panner] : []));
  };

  const playBagpipe = (time, midi, velocity, length, pan) => {
    const t = Math.max(time, audio.currentTime + 0.002);
    const level = clamp(state.bagpipeVolume, 0, 1);
    if (level <= 0.001) return;
    const freq = midiToFreq(midi);

    const chanter = audio.createOscillator();
    const reed = audio.createOscillator();
    const droneA = audio.createOscillator();
    const droneB = audio.createOscillator();
    const reedGain = audio.createGain();
    const droneGain = audio.createGain();
    const body = audio.createBiquadFilter();
    const bite = audio.createBiquadFilter();
    const amp = audio.createGain();
    const panner = typeof audio.createStereoPanner === 'function' ? audio.createStereoPanner() : null;

    chanter.type = 'sawtooth';
    reed.type = 'square';
    droneA.type = 'sawtooth';
    droneB.type = 'triangle';
    chanter.frequency.setValueAtTime(freq, t);
    reed.frequency.setValueAtTime(freq * 1.005, t);
    droneA.frequency.setValueAtTime(midiToFreq(state.rootMidi - 24), t);
    droneB.frequency.setValueAtTime(midiToFreq(state.rootMidi - 12), t);
    reed.detune.setValueAtTime(6, t);
    droneA.detune.setValueAtTime(-4, t);
    droneB.detune.setValueAtTime(5, t);

    reedGain.gain.setValueAtTime(0.34 + velocity * 0.18, t);
    droneGain.gain.setValueAtTime(0.14 + level * 0.12, t);
    body.type = 'bandpass';
    body.frequency.setValueAtTime(1150 + velocity * 420, t);
    body.Q.setValueAtTime(4.8, t);
    bite.type = 'highpass';
    bite.frequency.setValueAtTime(560, t);

    const peak = 0.12 * velocity * level;
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + 0.018);
    amp.gain.setTargetAtTime(peak * 0.82, t + 0.04, 0.08);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + length);
    if (panner) panner.pan.setValueAtTime(pan, t);

    chanter.connect(body);
    reed.connect(reedGain);
    reedGain.connect(body);
    droneA.connect(droneGain);
    droneB.connect(droneGain);
    droneGain.connect(bite);
    body.connect(bite);
    bite.connect(amp);

    if (panner) {
      amp.connect(panner);
      panner.connect(output);
      panner.connect(delay);
    } else {
      amp.connect(output);
      amp.connect(delay);
    }

    chanter.start(t);
    reed.start(t);
    droneA.start(t);
    droneB.start(t);
    chanter.stop(t + length + 0.05);
    reed.stop(t + length + 0.05);
    droneA.stop(t + length + 0.05);
    droneB.stop(t + length + 0.05);
    track(length + 0.1, chanter, reed, droneA, droneB, reedGain, droneGain, body, bite, amp, ...(panner ? [panner] : []));
  };

  const playDrum = (time, kind, velocity) => {
    const t = Math.max(time, audio.currentTime + 0.002);
    const drumLevel = clamp(state.drumVolume, 0, 1);
    const hit = clamp(velocity * drumLevel, 0, 1.2);

    const body = audio.createOscillator();
    const bodyGain = audio.createGain();
    const bodyFilter = audio.createBiquadFilter();
    const skin = makeNoise();
    const skinGain = audio.createGain();
    const skinFilter = audio.createBiquadFilter();
    const panner = typeof audio.createStereoPanner === 'function' ? audio.createStereoPanner() : null;

    if (kind === 'low') {
      body.type = 'sine';
      body.frequency.setValueAtTime(138, t);
      body.frequency.exponentialRampToValueAtTime(58, t + 0.13);
      bodyFilter.type = 'lowpass';
      bodyFilter.frequency.setValueAtTime(260, t);
      skinFilter.type = 'bandpass';
      skinFilter.frequency.setValueAtTime(760, t);
      skinFilter.Q.setValueAtTime(3.8, t);
      bodyGain.gain.setValueAtTime(0.0001, t);
      bodyGain.gain.exponentialRampToValueAtTime(0.35 * hit, t + 0.006);
      bodyGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
      skinGain.gain.setValueAtTime(0.0001, t);
      skinGain.gain.exponentialRampToValueAtTime(0.18 * hit, t + 0.004);
      skinGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
      if (panner) panner.pan.setValueAtTime(-0.08, t);
    } else if (kind === 'rim') {
      body.type = 'triangle';
      body.frequency.setValueAtTime(390, t);
      bodyFilter.type = 'bandpass';
      bodyFilter.frequency.setValueAtTime(980, t);
      bodyFilter.Q.setValueAtTime(8, t);
      skinFilter.type = 'highpass';
      skinFilter.frequency.setValueAtTime(2600, t);
      bodyGain.gain.setValueAtTime(0.0001, t);
      bodyGain.gain.exponentialRampToValueAtTime(0.2 * hit, t + 0.003);
      bodyGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      skinGain.gain.setValueAtTime(0.0001, t);
      skinGain.gain.exponentialRampToValueAtTime(0.14 * hit, t + 0.002);
      skinGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
      if (panner) panner.pan.setValueAtTime(0.18, t);
    } else {
      body.type = 'sine';
      body.frequency.setValueAtTime(210, t);
      bodyFilter.type = 'bandpass';
      bodyFilter.frequency.setValueAtTime(420, t);
      bodyFilter.Q.setValueAtTime(5.5, t);
      skinFilter.type = 'highpass';
      skinFilter.frequency.setValueAtTime(4600, t);
      bodyGain.gain.setValueAtTime(0.0001, t);
      bodyGain.gain.exponentialRampToValueAtTime(0.08 * hit, t + 0.004);
      bodyGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
      skinGain.gain.setValueAtTime(0.0001, t);
      skinGain.gain.exponentialRampToValueAtTime(0.12 * hit, t + 0.002);
      skinGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
      if (panner) panner.pan.setValueAtTime(0.34, t);
    }

    body.connect(bodyFilter);
    bodyFilter.connect(bodyGain);
    skin.connect(skinFilter);
    skinFilter.connect(skinGain);

    if (panner) {
      bodyGain.connect(panner);
      skinGain.connect(panner);
      panner.connect(output);
    } else {
      bodyGain.connect(output);
      skinGain.connect(output);
    }

    body.start(t);
    skin.start(t);
    body.stop(t + 0.28);
    skin.stop(t + 0.28);
    track(0.34, body, bodyGain, bodyFilter, skin, skinGain, skinFilter, ...(panner ? [panner] : []));
  };

  const playDhol = (time, kind, velocity) => {
    const t = Math.max(time, audio.currentTime + 0.002);
    const dholLevel = clamp(state.dholVolume, 0, 1);
    if (dholLevel <= 0.001) return;
    const hit = clamp(velocity * dholLevel, 0, 1.3);

    const body = audio.createOscillator();
    const slap = audio.createOscillator();
    const skin = makeNoise();
    const bodyGain = audio.createGain();
    const slapGain = audio.createGain();
    const skinGain = audio.createGain();
    const bodyFilter = audio.createBiquadFilter();
    const slapFilter = audio.createBiquadFilter();
    const skinFilter = audio.createBiquadFilter();
    const panner = typeof audio.createStereoPanner === 'function' ? audio.createStereoPanner() : null;

    if (kind === 'bass') {
      body.type = 'sine';
      body.frequency.setValueAtTime(112, t);
      body.frequency.exponentialRampToValueAtTime(44, t + 0.18);
      slap.type = 'triangle';
      slap.frequency.setValueAtTime(160, t);
      bodyFilter.type = 'lowpass';
      bodyFilter.frequency.setValueAtTime(210, t);
      slapFilter.type = 'bandpass';
      slapFilter.frequency.setValueAtTime(520, t);
      slapFilter.Q.setValueAtTime(4.2, t);
      skinFilter.type = 'bandpass';
      skinFilter.frequency.setValueAtTime(1250, t);
      skinFilter.Q.setValueAtTime(3.5, t);
      bodyGain.gain.setValueAtTime(0.0001, t);
      bodyGain.gain.exponentialRampToValueAtTime(0.46 * hit, t + 0.005);
      bodyGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
      slapGain.gain.setValueAtTime(0.0001, t);
      slapGain.gain.exponentialRampToValueAtTime(0.16 * hit, t + 0.004);
      slapGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
      skinGain.gain.setValueAtTime(0.0001, t);
      skinGain.gain.exponentialRampToValueAtTime(0.18 * hit, t + 0.003);
      skinGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      if (panner) panner.pan.setValueAtTime(-0.28, t);
    } else {
      body.type = 'triangle';
      body.frequency.setValueAtTime(280, t);
      slap.type = 'square';
      slap.frequency.setValueAtTime(520, t);
      bodyFilter.type = 'bandpass';
      bodyFilter.frequency.setValueAtTime(740, t);
      bodyFilter.Q.setValueAtTime(7.2, t);
      slapFilter.type = 'bandpass';
      slapFilter.frequency.setValueAtTime(1400, t);
      slapFilter.Q.setValueAtTime(9.5, t);
      skinFilter.type = 'highpass';
      skinFilter.frequency.setValueAtTime(2800, t);
      bodyGain.gain.setValueAtTime(0.0001, t);
      bodyGain.gain.exponentialRampToValueAtTime(0.14 * hit, t + 0.003);
      bodyGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
      slapGain.gain.setValueAtTime(0.0001, t);
      slapGain.gain.exponentialRampToValueAtTime(0.15 * hit, t + 0.002);
      slapGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.055);
      skinGain.gain.setValueAtTime(0.0001, t);
      skinGain.gain.exponentialRampToValueAtTime(0.12 * hit, t + 0.002);
      skinGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
      if (panner) panner.pan.setValueAtTime(0.26, t);
    }

    body.connect(bodyFilter);
    bodyFilter.connect(bodyGain);
    slap.connect(slapFilter);
    slapFilter.connect(slapGain);
    skin.connect(skinFilter);
    skinFilter.connect(skinGain);

    if (panner) {
      bodyGain.connect(panner);
      slapGain.connect(panner);
      skinGain.connect(panner);
      panner.connect(output);
    } else {
      bodyGain.connect(output);
      slapGain.connect(output);
      skinGain.connect(output);
    }

    body.start(t);
    slap.start(t);
    skin.start(t);
    body.stop(t + 0.38);
    slap.stop(t + 0.16);
    skin.stop(t + 0.16);
    track(0.44, body, slap, skin, bodyGain, slapGain, skinGain, bodyFilter, slapFilter, skinFilter, ...(panner ? [panner] : []));
  };

  const scheduleStep = ({ step, time, duration }) => {
    if (!state.running) return;
    const stepIndex = ((step % 16) + 16) % 16;
    currentStep = stepIndex;
    lastTickAt = performance.now();

    const stepSeconds = clamp(duration || 0.125, 0.06, 0.35);
    const density = clamp(state.density, 0, 1);
    const swingOffset = stepIndex % 2 ? stepSeconds * clamp(state.swing, 0, 0.45) : 0;
    const t = time + swingOffset;
    const root = Math.round(state.rootMidi);
    const flutePattern = [0, 3, 5, 7, 10, 7, 5, 3, 0, 5, 7, 10, 12, 10, 7, 5];
    const sitarPattern = [0, 2, 4, 7, 9, 7, 4, 2, 0, 4, 7, 11, 12, 11, 7, 4];
    const bagpipePattern = [0, 2, 4, 5, 7, 9, 10, 9, 7, 5, 4, 2, 0, 4, 7, 5];
    const fluteSteps = density > 0.7 ? [2, 5, 8, 11, 14] : [2, 8, 14];
    const sitarSteps = density > 0.66 ? [0, 3, 4, 7, 10, 12, 15] : [0, 4, 10, 15];
    const bagpipeSteps = density > 0.62 ? [1, 5, 9, 13] : [1, 9];
    const shouldPlayFlute = state.fluteVolume > 0.02 && fluteSteps.includes(stepIndex);
    const shouldPlaySitar = state.sitarVolume > 0.02 && sitarSteps.includes(stepIndex);
    const shouldPlayBagpipe = state.bagpipeVolume > 0.02 && bagpipeSteps.includes(stepIndex);
    const breath = clamp(state.breath, 0, 1);

    delay.delayTime.setTargetAtTime(stepSeconds * (1.4 + density * 0.9), audio.currentTime, 0.05);
    delayFeedback.gain.setTargetAtTime(0.15 + density * 0.2, audio.currentTime, 0.06);
    delayWet.gain.setTargetAtTime(0.12 + breath * 0.16, audio.currentTime, 0.08);

    if (shouldPlayFlute) {
      const octave = stepIndex >= 10 && density > 0.58 ? 12 : 0;
      const accent = stepIndex % 4 === 0 ? 1 : stepIndex % 2 === 0 ? 0.76 : 0.58;
      const pan = ((stepIndex % 8) - 3.5) / 5.4;
      const length = stepSeconds * (0.78 + breath * 1.05);
      playFlute(t, root + flutePattern[stepIndex] + octave, clamp(accent * (0.72 + breath * 0.35), 0.12, 1.1), length, pan);
    }

    if (shouldPlaySitar) {
      const octave = stepIndex >= 11 ? 12 : 0;
      const accent = stepIndex % 4 === 0 ? 1 : stepIndex % 2 === 0 ? 0.78 : 0.62;
      const pan = 0.22 + ((stepIndex % 4) - 1.5) / 10;
      const length = stepSeconds * (0.52 + density * 0.46);
      playSitar(t + stepSeconds * 0.025, root - 12 + sitarPattern[stepIndex] + octave, accent, length, pan);
    }

    if (shouldPlayBagpipe) {
      const accent = stepIndex === 1 ? 1 : 0.72 + density * 0.2;
      const length = stepSeconds * (2.2 + density * 0.9);
      playBagpipe(t + stepSeconds * 0.035, root + bagpipePattern[stepIndex], accent, length, -0.22);
    }

    const congaLow = [0, 4, 8, 12];
    const congaOpen = [6, 7, 14, 15];
    const clave = [0, 3, 6, 10, 12];
    const campana = density > 0.48 ? [2, 4, 6, 8, 10, 12, 14] : [4, 8, 12];
    const ghost = density > 0.76 ? [1, 5, 9, 13] : [];
    const dholBass = [0, 4, 8, 12];
    const dholSlap = density > 0.54 ? [3, 7, 11, 15] : [7, 15];

    if (congaLow.includes(stepIndex)) {
      playDrum(time, 'low', stepIndex === 0 ? 1.08 : 0.9);
    }
    if (dholBass.includes(stepIndex)) {
      playDhol(time + stepSeconds * 0.02, 'bass', stepIndex === 0 ? 0.98 : 0.76);
    }
    if (congaOpen.includes(stepIndex)) {
      playDrum(t, 'rim', 0.72 + density * 0.22);
    }
    if (dholSlap.includes(stepIndex)) {
      playDhol(t + stepSeconds * 0.04, 'slap', 0.58 + density * 0.24);
    }
    if (clave.includes(stepIndex)) {
      playDrum(time + stepSeconds * 0.015, 'shake', 0.64 + density * 0.28);
    }
    if (campana.includes(stepIndex)) {
      playDrum(t + stepSeconds * 0.05, 'shake', 0.28 + density * 0.25);
    }
    if (ghost.includes(stepIndex)) {
      playDrum(t + stepSeconds * 0.12, 'rim', 0.24 + density * 0.2);
    }

    pulse = Math.max(pulse, stepIndex % 4 === 0 ? 1 : 0.55);
  };

  ctx.domRoot.innerHTML = `
    <style>
      .root {
        box-sizing: border-box;
        height: 100%;
        min-width: 280px;
        padding: 10px 12px;
        background: #08110f;
        color: #dbe9df;
        font: 11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace;
        display: grid;
        grid-template-rows: auto auto auto 1fr;
        gap: 9px;
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
        color: #f6d58f;
        font: 700 12px/1 ui-sans-serif, system-ui, sans-serif;
        letter-spacing: 0;
      }
      button {
        border: 1px solid #5f7f74;
        border-radius: 4px;
        background: #10221d;
        color: #e8f3dc;
        cursor: pointer;
        font: 700 11px/1 ui-sans-serif, system-ui, sans-serif;
        min-width: 34px;
        min-height: 24px;
      }
      button.on {
        background: #c58434;
        border-color: #f6d58f;
        color: #08110f;
      }
      .meters {
        display: grid;
        grid-template-columns: repeat(5, minmax(0, 1fr));
        gap: 6px;
      }
      .meter {
        min-width: 0;
        border: 1px solid #28433a;
        background: #0d1916;
        padding: 6px;
      }
      .meter b {
        display: block;
        color: #92d3b8;
        font: 700 10px/1 ui-sans-serif, system-ui, sans-serif;
        margin-bottom: 5px;
      }
      .bar {
        position: relative;
        height: 7px;
        background: #132620;
        overflow: hidden;
      }
      .bar span {
        position: absolute;
        inset: 0 auto 0 0;
        width: 0%;
        background: linear-gradient(90deg, #92d3b8, #f6d58f);
      }
      .controls {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 7px 10px;
      }
      label {
        display: grid;
        gap: 3px;
        min-width: 0;
        color: #b7c9bc;
      }
      input[type="range"] {
        width: 100%;
        min-width: 0;
      }
      .steps {
        align-self: end;
        display: grid;
        grid-template-columns: repeat(16, minmax(6px, 1fr));
        gap: 3px;
      }
      .step {
        height: 16px;
        border: 1px solid #28433a;
        background: #0d1916;
      }
      .step.beat {
        border-color: #5f7f74;
      }
      .step.active {
        background: #f6d58f;
        border-color: #f6d58f;
        box-shadow: 0 0 10px rgba(246, 213, 143, 0.55);
      }
    </style>
    <div class="root">
      <div class="top">
        <h1>salsa dhol sitar pipes</h1>
        <button id="toggle" type="button" aria-label="toggle playback"></button>
      </div>
      <div class="meters">
        <div class="meter"><b>flute riff</b><div class="bar"><span id="fluteMeter"></span></div></div>
        <div class="meter"><b>percussion</b><div class="bar"><span id="drumMeter"></span></div></div>
        <div class="meter"><b>sitar</b><div class="bar"><span id="sitarMeter"></span></div></div>
        <div class="meter"><b>dhol</b><div class="bar"><span id="dholMeter"></span></div></div>
        <div class="meter"><b>pipes</b><div class="bar"><span id="bagpipeMeter"></span></div></div>
      </div>
      <div class="controls">
        <label>root <input id="root" type="range" min="48" max="74" step="1" value="${state.rootMidi}"></label>
        <label>breath <input id="breath" type="range" min="0" max="1" step="0.001" value="${state.breath}"></label>
        <label>riff <input id="fluteVolume" type="range" min="0" max="1" step="0.001" value="${state.fluteVolume}"></label>
        <label>perc <input id="drumVolume" type="range" min="0" max="1" step="0.001" value="${state.drumVolume}"></label>
        <label>sitar <input id="sitarVolume" type="range" min="0" max="1" step="0.001" value="${state.sitarVolume}"></label>
        <label>dhol <input id="dholVolume" type="range" min="0" max="1" step="0.001" value="${state.dholVolume}"></label>
        <label>pipes <input id="bagpipeVolume" type="range" min="0" max="1" step="0.001" value="${state.bagpipeVolume}"></label>
        <label>density <input id="density" type="range" min="0" max="1" step="0.001" value="${state.density}"></label>
        <label>swing <input id="swing" type="range" min="0" max="0.42" step="0.001" value="${state.swing}"></label>
      </div>
      <div id="steps" class="steps" aria-hidden="true">
        ${Array.from({ length: 16 }, (_, index) => `<span class="step${index % 4 === 0 ? ' beat' : ''}"></span>`).join('')}
      </div>
    </div>
  `;

  const toggleButton = ctx.domRoot.querySelector('#toggle');
  const rootSlider = ctx.domRoot.querySelector('#root');
  const breathSlider = ctx.domRoot.querySelector('#breath');
  const fluteSlider = ctx.domRoot.querySelector('#fluteVolume');
  const drumSlider = ctx.domRoot.querySelector('#drumVolume');
  const sitarSlider = ctx.domRoot.querySelector('#sitarVolume');
  const dholSlider = ctx.domRoot.querySelector('#dholVolume');
  const bagpipeSlider = ctx.domRoot.querySelector('#bagpipeVolume');
  const densitySlider = ctx.domRoot.querySelector('#density');
  const swingSlider = ctx.domRoot.querySelector('#swing');
  const fluteMeter = ctx.domRoot.querySelector('#fluteMeter');
  const drumMeter = ctx.domRoot.querySelector('#drumMeter');
  const sitarMeter = ctx.domRoot.querySelector('#sitarMeter');
  const dholMeter = ctx.domRoot.querySelector('#dholMeter');
  const bagpipeMeter = ctx.domRoot.querySelector('#bagpipeMeter');
  const stepEls = Array.from(ctx.domRoot.querySelectorAll('.step'));

  const syncUi = () => {
    toggleButton.textContent = state.running ? 'II' : '>';
    toggleButton.classList.toggle('on', state.running);
    toggleButton.setAttribute('aria-pressed', String(state.running));
    stepEls.forEach((el, index) => {
      el.classList.toggle('active', state.running && index === currentStep);
    });
    const sinceTick = Math.min(1, (performance.now() - lastTickAt) / 220);
    const decay = 1 - sinceTick;
    pulse *= 0.92;
    fluteMeter.style.width = `${clamp((state.fluteVolume * 0.58 + pulse * 0.42) * 100 * decay, 0, 100)}%`;
    drumMeter.style.width = `${clamp((state.drumVolume * 0.45 + pulse * 0.6) * 100 * decay, 0, 100)}%`;
    sitarMeter.style.width = `${clamp((state.sitarVolume * 0.5 + pulse * 0.5) * 100 * decay, 0, 100)}%`;
    dholMeter.style.width = `${clamp((state.dholVolume * 0.48 + pulse * 0.62) * 100 * decay, 0, 100)}%`;
    bagpipeMeter.style.width = `${clamp((state.bagpipeVolume * 0.5 + pulse * 0.48) * 100 * decay, 0, 100)}%`;
  };

  const onToggle = () => {
    state.running = !state.running;
    if (!state.running) currentStep = -1;
    syncUi();
  };
  const onRoot = () => { state.rootMidi = Number(rootSlider.value); };
  const onBreath = () => { state.breath = Number(breathSlider.value); };
  const onFlute = () => { state.fluteVolume = Number(fluteSlider.value); };
  const onDrum = () => { state.drumVolume = Number(drumSlider.value); };
  const onSitar = () => { state.sitarVolume = Number(sitarSlider.value); };
  const onDhol = () => { state.dholVolume = Number(dholSlider.value); };
  const onBagpipe = () => { state.bagpipeVolume = Number(bagpipeSlider.value); };
  const onDensity = () => { state.density = Number(densitySlider.value); };
  const onSwing = () => { state.swing = Number(swingSlider.value); };

  toggleButton.addEventListener('click', onToggle);
  rootSlider.addEventListener('input', onRoot);
  breathSlider.addEventListener('input', onBreath);
  fluteSlider.addEventListener('input', onFlute);
  drumSlider.addEventListener('input', onDrum);
  sitarSlider.addEventListener('input', onSitar);
  dholSlider.addEventListener('input', onDhol);
  bagpipeSlider.addEventListener('input', onBagpipe);
  densitySlider.addEventListener('input', onDensity);
  swingSlider.addEventListener('input', onSwing);

  const unsubscribeTick = ctx.clock.onTick(scheduleStep);
  const animationTimer = setInterval(syncUi, 33);
  syncUi();

  return {
    update() {},
    getState() {
      return { ...state };
    },
    destroy() {
      clearInterval(animationTimer);
      cleanupTimers.forEach((timer) => clearTimeout(timer));
      cleanupTimers.clear();
      unsubscribeTick();
      toggleButton.removeEventListener('click', onToggle);
      rootSlider.removeEventListener('input', onRoot);
      breathSlider.removeEventListener('input', onBreath);
      fluteSlider.removeEventListener('input', onFlute);
      drumSlider.removeEventListener('input', onDrum);
      sitarSlider.removeEventListener('input', onSitar);
      dholSlider.removeEventListener('input', onDhol);
      bagpipeSlider.removeEventListener('input', onBagpipe);
      densitySlider.removeEventListener('input', onDensity);
      swingSlider.removeEventListener('input', onSwing);
      liveNodes.forEach((node) => {
        try {
          if (typeof node.stop === 'function') node.stop();
        } catch (_) {}
        try {
          if (typeof node.disconnect === 'function') node.disconnect();
        } catch (_) {}
      });
      liveNodes.clear();
      try {
        delay.disconnect();
        delayTone.disconnect();
        delayFeedback.disconnect();
        delayWet.disconnect();
        output.disconnect();
        compressor.disconnect();
      } catch (_) {}
    }
  };
}
