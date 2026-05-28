export default function setup(ctx, prevState) {
  const state = {
    speed: Number.isFinite(prevState?.speed) ? prevState.speed : 1.05,
    intensity: Number.isFinite(prevState?.intensity) ? prevState.intensity : 0.96,
    hue: Number.isFinite(prevState?.hue) ? prevState.hue : 0.92
  };

  ctx.domRoot.innerHTML = `
    <style>
      :host {
        display: block;
        width: 100%;
        height: 100%;
      }

      .psychedelic {
        position: relative;
        width: 100%;
        height: 100%;
        min-width: 220px;
        min-height: 160px;
        overflow: hidden;
        border-radius: 8px;
        background:
          radial-gradient(circle at 18% 20%, rgba(255, 235, 59, 0.45), transparent 30%),
          radial-gradient(circle at 78% 24%, rgba(0, 229, 255, 0.42), transparent 32%),
          radial-gradient(circle at 52% 82%, rgba(255, 64, 169, 0.45), transparent 36%),
          #120020;
        border: 2px solid rgba(255, 244, 96, 0.82);
        box-shadow: 0 0 24px rgba(0, 229, 255, 0.24), 0 0 52px rgba(255, 64, 169, 0.2);
      }

      .psychedelic::after {
        content: "";
        position: absolute;
        inset: 0;
        pointer-events: none;
        background:
          linear-gradient(90deg, rgba(255, 255, 255, 0.09) 1px, transparent 1px),
          linear-gradient(0deg, rgba(255, 255, 255, 0.07) 1px, transparent 1px);
        background-size: 24px 24px;
        mix-blend-mode: screen;
        opacity: 0.48;
      }

      canvas {
        display: block;
        width: 100%;
        height: 100%;
      }
    </style>
    <div class="psychedelic">
      <canvas id="psychedelic-canvas" aria-label="Psychedelic kaleidoscope visual"></canvas>
    </div>
  `;

  const canvas = ctx.domRoot.querySelector('#psychedelic-canvas');
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
          background: #09090f;
          color: #f5d0fe;
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
    uniform float uHue;
    uniform float uIntensity;

    vec3 palette(float t) {
      vec3 a = vec3(0.66, 0.58, 0.60);
      vec3 b = vec3(0.54, 0.48, 0.46);
      vec3 c = vec3(1.08, 0.76, 0.62);
      vec3 d = vec3(0.02, 0.28, 0.58);
      return a + b * cos(6.2831853 * (c * t + d));
    }

    float stripe(float value, float width) {
      float wave = abs(fract(value) - 0.5);
      return 1.0 - smoothstep(0.0, width, wave);
    }

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    void main() {
      vec2 uv = (gl_FragCoord.xy * 2.0 - uResolution.xy) / min(uResolution.x, uResolution.y);
      vec2 original = uv;
      float t = uTime;
      float pulse = smoothstep(0.0, 1.0, uPulse);

      float radius = length(uv);
      float angle = atan(uv.y, uv.x);
      float folds = 8.0 + floor(3.0 * sin(t * 0.2 + uHue * 6.2831853));
      float sector = 6.2831853 / folds;
      angle = abs(mod(angle + t * 0.24, sector) - sector * 0.5);
      uv = vec2(cos(angle), sin(angle)) * radius;

      vec2 p = uv;
      for (int i = 0; i < 5; i += 1) {
        float safeDot = max(dot(p, p), 0.075);
        p = abs(p) / safeDot - vec2(0.68 + 0.05 * sin(t * 0.52), 0.54 + pulse * 0.055);
        p *= mat2(0.78, -0.63, 0.63, 0.78);
      }

      float rings = sin(radius * (34.0 + pulse * 12.0) - t * 5.2);
      float waves = sin(p.x * 3.8 + t * 2.1) + sin(p.y * 5.0 - t * 1.6);
      float lace = sin((p.x + p.y) * 8.4 + rings * 2.0 + t * 1.05);
      float ink = smoothstep(-0.78, 0.88, waves * 0.42 + lace * 0.34 + rings * 0.24);
      float sunburst = stripe(angle / sector + radius * 1.35 - t * 0.08, 0.18);
      float candyRing = stripe(radius * 5.2 - t * 0.42 + pulse * 0.38, 0.15);
      float bubbleGrid = stripe(p.x * 1.8 + sin(p.y * 3.0 + t) * 0.2, 0.12)
        * stripe(p.y * 1.8 + cos(p.x * 3.0 - t) * 0.2, 0.12);

      float grain = hash(gl_FragCoord.xy + floor(t * 24.0)) - 0.5;
      float glow = 0.055 / max(0.05, abs(lace) + radius * 0.07);
      vec3 color = palette(uHue + radius * 0.42 + ink * 0.3 + t * 0.045);
      vec3 pink = vec3(1.0, 0.05, 0.68);
      vec3 yellow = vec3(1.0, 0.93, 0.12);
      vec3 aqua = vec3(0.0, 0.86, 1.0);
      color = mix(color, pink, sunburst * 0.48);
      color = mix(color, yellow, candyRing * 0.44);
      color = mix(color, aqua, bubbleGrid * 0.5);
      color *= 0.54 + ink * 0.92 + pulse * 0.38;
      color += glow * vec3(0.3, 0.96, 1.0);
      color += vec3(0.95, 0.2, 1.0) * smoothstep(0.96, 0.1, length(p)) * 0.18;
      color += grain * 0.025;

      float vignette = smoothstep(1.68, 0.18, length(original));
      color *= 0.88 + vignette * 0.22;
      color = pow(max(color, 0.0), vec3(0.68 + (1.0 - uIntensity) * 0.2));

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
    ctx.domRoot.innerHTML = `<pre style="box-sizing:border-box;width:100%;height:100%;white-space:pre-wrap;color:#fecaca;background:#190711;padding:12px;border-radius:8px">${error.message}</pre>`;
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
    hue: gl.getUniformLocation(program, 'uHue'),
    intensity: gl.getUniformLocation(program, 'uIntensity')
  };

  let beatPulse = 0;
  let destroyed = false;

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(rect.width * dpr));
    const height = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
    }
  };

  const unsubscribeClock = ctx.clock.onTick(({ step }) => {
    beatPulse = step % 4 === 0 ? 1 : 0.62;
    state.hue = (state.hue + 0.013) % 1;
  });

  const resizeObserver = typeof ResizeObserver === 'function'
    ? new ResizeObserver(resize)
    : null;
  resizeObserver?.observe(canvas);

  function render() {
    if (destroyed) return;
    resize();
    beatPulse *= 0.91;
    const time = performance.now() * 0.001 * state.speed;
    gl.useProgram(program);
    gl.uniform2f(uniforms.resolution, canvas.width, canvas.height);
    gl.uniform1f(uniforms.time, time);
    gl.uniform1f(uniforms.pulse, beatPulse);
    gl.uniform1f(uniforms.hue, state.hue);
    gl.uniform1f(uniforms.intensity, state.intensity);
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
      unsubscribeClock();
      resizeObserver?.disconnect();
      gl.deleteBuffer(positionBuffer);
      gl.deleteProgram(program);
    }
  };
}
