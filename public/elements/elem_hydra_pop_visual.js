export default function setup(ctx, prevState) {
  const state = {
    speed: Number.isFinite(prevState?.speed) ? prevState.speed : 1.15,
    pop: Number.isFinite(prevState?.pop) ? prevState.pop : 0.82,
    symmetry: Number.isFinite(prevState?.symmetry) ? prevState.symmetry : 7,
    candy: Number.isFinite(prevState?.candy) ? prevState.candy : 0.66
  };

  ctx.domRoot.innerHTML = `
    <style>
      :host {
        display: block;
        width: 100%;
        height: 100%;
      }

      .hydra-pop {
        position: relative;
        box-sizing: border-box;
        width: 100%;
        height: 100%;
        min-width: 280px;
        min-height: 210px;
        overflow: hidden;
        border: 2px solid rgba(255, 255, 255, 0.78);
        border-radius: 8px;
        background: #070812;
        box-shadow:
          0 0 0 2px rgba(255, 44, 160, 0.46),
          0 16px 42px rgba(0, 0, 0, 0.32),
          0 0 38px rgba(0, 217, 255, 0.24);
      }

      canvas {
        display: block;
        width: 100%;
        height: 100%;
      }

      .hud {
        position: absolute;
        left: 10px;
        right: 10px;
        top: 9px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        color: #ffffff;
        pointer-events: none;
        text-shadow: 0 1px 8px rgba(0, 0, 0, 0.55);
      }

      .title {
        min-width: 0;
        font: 700 12px/1.1 ui-monospace, SFMono-Regular, Menlo, monospace;
        text-transform: uppercase;
        letter-spacing: 0;
      }

      .beat {
        width: 42px;
        height: 8px;
        overflow: hidden;
        border: 1px solid rgba(255, 255, 255, 0.66);
        border-radius: 8px;
        background: rgba(7, 8, 18, 0.36);
      }

      .beat-fill {
        width: 0%;
        height: 100%;
        background: linear-gradient(90deg, #ffe84a, #ff2ca0, #00d9ff);
      }

      .controls {
        position: absolute;
        left: 10px;
        right: 10px;
        bottom: 10px;
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 8px;
        padding: 8px;
        border: 1px solid rgba(255, 255, 255, 0.24);
        border-radius: 8px;
        background: rgba(7, 8, 18, 0.62);
        color: #ffffff;
        font: 10px/1.15 ui-monospace, SFMono-Regular, Menlo, monospace;
        backdrop-filter: blur(9px);
      }

      label {
        display: grid;
        gap: 4px;
        min-width: 0;
      }

      input {
        width: 100%;
        min-width: 0;
        accent-color: #ff2ca0;
      }

      @media (max-width: 340px) {
        .controls {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
    </style>
    <div class="hydra-pop">
      <canvas id="hydra-pop-canvas" aria-label="Hydra pop visual"></canvas>
      <div class="hud">
        <div class="title">Hydra Pop</div>
        <div class="beat"><div class="beat-fill" id="beat-fill"></div></div>
      </div>
      <div class="controls" data-no-drag>
        <label>
          speed
          <input id="speed" type="range" min="0.2" max="2.8" step="0.01" value="${state.speed}">
        </label>
        <label>
          pop
          <input id="pop" type="range" min="0" max="1" step="0.001" value="${state.pop}">
        </label>
        <label>
          fold
          <input id="symmetry" type="range" min="3" max="12" step="1" value="${state.symmetry}">
        </label>
        <label>
          candy
          <input id="candy" type="range" min="0" max="1" step="0.001" value="${state.candy}">
        </label>
      </div>
    </div>
  `;

  const canvas = ctx.domRoot.querySelector('#hydra-pop-canvas');
  const beatFill = ctx.domRoot.querySelector('#beat-fill');
  const inputs = {
    speed: ctx.domRoot.querySelector('#speed'),
    pop: ctx.domRoot.querySelector('#pop'),
    symmetry: ctx.domRoot.querySelector('#symmetry'),
    candy: ctx.domRoot.querySelector('#candy')
  };
  const gl = canvas.getContext('webgl', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: false
  });

  if (!gl) {
    ctx.domRoot.innerHTML = `
      <style>
        .fallback {
          box-sizing: border-box;
          width: 100%;
          height: 100%;
          display: grid;
          place-items: center;
          border-radius: 8px;
          background: #070812;
          color: #ffffff;
          font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
        }
      </style>
      <div class="fallback">WebGL unavailable</div>
    `;
    return {
      getState() {
        return { ...state };
      },
      destroy() {}
    };
  }

  const vertexSource = `
    attribute vec2 aPosition;

    void main() {
      gl_Position = vec4(aPosition, 0.0, 1.0);
    }
  `;

  const fragmentSource = `
    precision highp float;

    uniform vec2 uResolution;
    uniform float uTime;
    uniform float uPulse;
    uniform float uKick;
    uniform float uSnare;
    uniform float uHat;
    uniform float uAcid;
    uniform float uPop;
    uniform float uSymmetry;
    uniform float uCandy;

    const float PI = 3.14159265359;
    const float TAU = 6.28318530718;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    mat2 rotate2d(float a) {
      float s = sin(a);
      float c = cos(a);
      return mat2(c, -s, s, c);
    }

    vec2 kaleid(vec2 p, float folds) {
      float r = length(p);
      float a = atan(p.y, p.x);
      float sector = TAU / folds;
      a = abs(mod(a + sector * 0.5, sector) - sector * 0.5);
      return vec2(cos(a), sin(a)) * r;
    }

    float hydraOsc(vec2 p, float frequency, float sync, float offset) {
      vec2 q = p * rotate2d(offset * 0.9);
      return 0.5 + 0.5 * sin((q.x + q.y * sync) * frequency + offset);
    }

    float hydraShape(vec2 p, float sides, float radius, float blur) {
      float a = atan(p.x, p.y) + PI;
      float r = TAU / sides;
      float d = cos(floor(0.5 + a / r) * r - a) * length(p);
      return 1.0 - smoothstep(radius, radius + blur, d);
    }

    float ring(vec2 p, float radius, float width) {
      return 1.0 - smoothstep(width, width + 0.012, abs(length(p) - radius));
    }

    vec3 palette(float x) {
      vec3 pink = vec3(1.0, 0.08, 0.58);
      vec3 yellow = vec3(1.0, 0.92, 0.12);
      vec3 aqua = vec3(0.0, 0.82, 1.0);
      vec3 lime = vec3(0.44, 1.0, 0.18);
      vec3 orange = vec3(1.0, 0.42, 0.05);
      vec3 a = mix(pink, yellow, smoothstep(0.0, 0.28, fract(x)));
      vec3 b = mix(aqua, lime, smoothstep(0.28, 0.64, fract(x)));
      return mix(a, mix(b, orange, 0.22), smoothstep(0.24, 0.92, fract(x)));
    }

    void main() {
      vec2 uv = (gl_FragCoord.xy * 2.0 - uResolution.xy) / min(uResolution.x, uResolution.y);
      vec2 raw = uv;
      float t = uTime;
      float pulse = smoothstep(0.0, 1.0, uPulse);
      float kick = smoothstep(0.0, 1.0, uKick);
      float snare = smoothstep(0.0, 1.0, uSnare);
      float hat = smoothstep(0.0, 1.0, uHat);
      float acid = smoothstep(0.0, 1.0, uAcid);
      float drum = clamp(kick * 0.62 + snare * 0.34 + hat * 0.18 + acid * 0.42, 0.0, 1.0);

      vec2 modulator = vec2(
        hydraOsc(uv + t * (0.07 + acid * 0.035), 6.0 + uCandy * 8.0 + hat * 5.0, 0.7 + acid * 0.35, t * 1.4),
        hydraOsc(uv.yx - t * 0.04, 5.0 + uPop * 9.0 + snare * 4.0, 1.1 + kick * 0.32, -t * 1.1)
      ) - 0.5;

      uv += modulator * (0.18 + uPop * 0.16 + pulse * 0.035 + acid * 0.055);
      uv = kaleid(uv * (1.0 + pulse * 0.035 + kick * 0.075), max(3.0, uSymmetry + floor(snare * 2.0)));
      uv *= rotate2d(t * (0.13 + uCandy * 0.18 + hat * 0.12) + acid * 0.08);

      float oscA = hydraOsc(uv, 13.0 + uPop * 18.0 + acid * 10.0, 0.9 + uCandy * 0.8, t * (2.3 + hat * 0.55));
      float oscB = hydraOsc(uv.yx + modulator * (0.38 + acid * 0.18), 8.0 + uCandy * 13.0 + snare * 6.0, 1.45, -t * 1.8);
      float star = hydraShape(uv * 1.05, 5.0 + floor(uCandy * 4.0 + acid * 2.0), 0.38 + pulse * 0.035 + kick * 0.06, 0.022);
      float flower = hydraShape(kaleid(uv * 1.32 + modulator * 0.16, 6.0 + snare * 2.0), 6.0, 0.43 + acid * 0.04, 0.035);
      float target = ring(raw + modulator * 0.1, 0.44 + pulse * 0.04 + kick * 0.07, 0.022 + uPop * 0.016 + snare * 0.008);

      vec2 dotGrid = fract((raw + modulator * 0.08) * (9.0 + uPop * 15.0 + hat * 11.0)) - 0.5;
      float dots = 1.0 - smoothstep(0.12 + uCandy * 0.05, 0.18 + uCandy * 0.05, length(dotGrid));
      float poster = smoothstep(0.44, 0.58, oscA * 0.64 + oscB * 0.36);
      float ink = smoothstep(0.76, 0.84, abs(oscA - oscB) + star * 0.22 + target * 0.32);
      float confetti = step(0.965 - uPop * 0.02 - hat * 0.018, hash(floor((raw + t * 0.035) * (18.0 + acid * 8.0))));

      vec3 base = palette(oscA * 0.34 + oscB * 0.28 + length(raw) * 0.22 + t * 0.065 + uCandy * 0.2 + acid * 0.16);
      vec3 second = palette(oscB * 0.46 + star * 0.25 + t * 0.11 + 0.36 + snare * 0.08);
      vec3 color = mix(base, second, poster);
      color = mix(color, vec3(1.0, 0.96, 0.16), star * (0.42 + pulse * 0.16 + kick * 0.24));
      color = mix(color, vec3(0.0, 0.90, 1.0), flower * (0.34 + acid * 0.18));
      color = mix(color, vec3(1.0, 0.06, 0.56), snare * 0.22);
      color += dots * vec3(1.0, 1.0, 1.0) * (0.08 + uPop * 0.16 + hat * 0.16);
      color += target * vec3(1.0, 0.1, 0.62) * (0.38 + pulse * 0.22 + kick * 0.34);
      color += confetti * palette(hash(floor(raw * 18.0)) + t * 0.2 + acid * 0.2) * (0.55 + pulse * 0.18 + hat * 0.28);
      color = mix(color, vec3(0.02, 0.015, 0.04), ink * (0.34 + uPop * 0.28));

      float vignette = smoothstep(1.42, 0.18, length(raw));
      color *= 0.83 + vignette * 0.28;
      color += pulse * vec3(0.08, 0.04, 0.13);
      color += drum * vec3(0.1, 0.06, 0.04);
      color += acid * vec3(0.22, 0.42, 0.02) * flower;
      color = pow(max(color, 0.0), vec3(0.78 - uPop * 0.18));

      gl_FragColor = vec4(color, 1.0);
    }
  `;

  function compileShader(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader) || 'Shader compile failed';
      gl.deleteShader(shader);
      throw new Error(message);
    }
    return shader;
  }

  function createProgram() {
    const vertexShader = compileShader(gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = compileShader(gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(program) || 'Shader link failed';
      gl.deleteProgram(program);
      throw new Error(message);
    }
    return program;
  }

  let program;
  try {
    program = createProgram();
  } catch (error) {
    ctx.domRoot.innerHTML = `<pre style="box-sizing:border-box;width:100%;height:100%;white-space:pre-wrap;color:#fecaca;background:#17080a;padding:12px;border-radius:8px">${error.message}</pre>`;
    return {
      getState() {
        return { ...state };
      },
      destroy() {}
    };
  }

  const positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1,
     1, -1,
    -1,  1,
    -1,  1,
     1, -1,
     1,  1
  ]), gl.STATIC_DRAW);

  gl.useProgram(program);
  const positionLocation = gl.getAttribLocation(program, 'aPosition');
  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

  const uniforms = {
    resolution: gl.getUniformLocation(program, 'uResolution'),
    time: gl.getUniformLocation(program, 'uTime'),
    pulse: gl.getUniformLocation(program, 'uPulse'),
    kick: gl.getUniformLocation(program, 'uKick'),
    snare: gl.getUniformLocation(program, 'uSnare'),
    hat: gl.getUniformLocation(program, 'uHat'),
    acid: gl.getUniformLocation(program, 'uAcid'),
    pop: gl.getUniformLocation(program, 'uPop'),
    symmetry: gl.getUniformLocation(program, 'uSymmetry'),
    candy: gl.getUniformLocation(program, 'uCandy')
  };

  let beatPulse = 0;
  const drumPulse = {
    kick: 0,
    snare: 0,
    hat: 0,
    acid: 0
  };
  let destroyed = false;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(rect.width * dpr));
    const height = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    }
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function syncInputs() {
    inputs.speed.value = String(state.speed);
    inputs.pop.value = String(state.pop);
    inputs.symmetry.value = String(state.symmetry);
    inputs.candy.value = String(state.candy);
  }

  function onInput(event) {
    const id = event.currentTarget.id;
    const value = Number(event.currentTarget.value);
    if (!Number.isFinite(value)) return;
    if (id === 'symmetry') {
      state.symmetry = clamp(Math.round(value), 3, 12);
    } else {
      state[id] = value;
    }
  }

  Object.values(inputs).forEach((input) => {
    input.addEventListener('input', onInput);
  });
  syncInputs();

  const unsubscribeClock = ctx.clock.onTick(({ step }) => {
    beatPulse = Math.max(beatPulse, step % 4 === 0 ? 0.68 : 0.3);
  });

  const unsubscribeAcidDrum = ctx.bus.sub('acidDrum:hit', (hit) => {
    if (!hit || typeof hit !== 'object') return;
    const velocity = clamp(Number(hit.velocity) || 0, 0, 1.2);
    if (!velocity) return;

    if (hit.voice === 'kick') {
      drumPulse.kick = Math.max(drumPulse.kick, velocity * 1.12);
      beatPulse = Math.max(beatPulse, velocity);
    } else if (hit.voice === 'snare' || hit.voice === 'clap') {
      drumPulse.snare = Math.max(drumPulse.snare, velocity);
      beatPulse = Math.max(beatPulse, velocity * 0.72);
    } else if (hit.voice === 'hat' || hit.voice === 'openHat') {
      drumPulse.hat = Math.max(drumPulse.hat, velocity * (hit.voice === 'openHat' ? 0.88 : 0.66));
      beatPulse = Math.max(beatPulse, velocity * 0.42);
    } else if (hit.voice === 'acid') {
      drumPulse.acid = Math.max(drumPulse.acid, velocity * (hit.accent ? 1.2 : 0.86));
      beatPulse = Math.max(beatPulse, velocity * 0.58);
    } else if (hit.voice === 'crash' || hit.voice === 'stab' || hit.voice === 'hoover' || hit.voice === 'siren' || hit.voice === 'vox' || hit.voice === 'bleep') {
      drumPulse.acid = Math.max(drumPulse.acid, velocity * 0.72);
      drumPulse.snare = Math.max(drumPulse.snare, velocity * 0.42);
      beatPulse = Math.max(beatPulse, velocity * 0.5);
    }
  });

  const resizeObserver = typeof ResizeObserver === 'function'
    ? new ResizeObserver(resize)
    : null;
  resizeObserver?.observe(canvas);

  function render() {
    if (destroyed) return;
    resize();
    beatPulse *= 0.9;
    drumPulse.kick *= 0.8;
    drumPulse.snare *= 0.74;
    drumPulse.hat *= 0.62;
    drumPulse.acid *= 0.86;
    const meter = Math.max(beatPulse, drumPulse.kick, drumPulse.snare, drumPulse.hat, drumPulse.acid);
    beatFill.style.width = `${Math.round(clamp(meter, 0, 1) * 100)}%`;

    gl.useProgram(program);
    gl.uniform2f(uniforms.resolution, canvas.width, canvas.height);
    gl.uniform1f(uniforms.time, performance.now() * 0.001 * state.speed);
    gl.uniform1f(uniforms.pulse, beatPulse);
    gl.uniform1f(uniforms.kick, drumPulse.kick);
    gl.uniform1f(uniforms.snare, drumPulse.snare);
    gl.uniform1f(uniforms.hat, drumPulse.hat);
    gl.uniform1f(uniforms.acid, drumPulse.acid);
    gl.uniform1f(uniforms.pop, state.pop);
    gl.uniform1f(uniforms.symmetry, state.symmetry);
    gl.uniform1f(uniforms.candy, state.candy);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  render();

  return {
    update() {
      render();
    },
    getState() {
      return { ...state };
    },
    destroy() {
      destroyed = true;
      Object.values(inputs).forEach((input) => {
        input.removeEventListener('input', onInput);
      });
      unsubscribeClock();
      unsubscribeAcidDrum();
      resizeObserver?.disconnect();
      gl.deleteBuffer(positionBuffer);
      gl.deleteProgram(program);
    }
  };
}
