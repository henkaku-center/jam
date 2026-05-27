export default function setup(ctx, prevState) {
  const state = {
    hueShift: Number.isFinite(prevState?.hueShift) ? prevState.hueShift : 0,
    speed: Number.isFinite(prevState?.speed) ? prevState.speed : 1
  };

  ctx.domRoot.innerHTML = `
    <style>
      :host {
        display: block;
        width: 100%;
        height: 100%;
      }

      .cube-shell {
        box-sizing: border-box;
        position: relative;
        width: 360px;
        height: 320px;
        min-width: 180px;
        min-height: 180px;
        overflow: hidden;
        border: 1px solid rgba(94, 234, 212, 0.38);
        border-radius: 8px;
        background: radial-gradient(circle at 50% 45%, #15212a 0%, #05070b 68%);
        box-shadow: 0 18px 40px rgba(0, 0, 0, 0.38), 0 0 34px rgba(45, 212, 191, 0.12);
      }

      canvas {
        display: block;
        width: 100%;
        height: 100%;
      }

      .controls {
        position: absolute;
        left: 10px;
        right: 10px;
        bottom: 10px;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
        padding: 8px;
        border: 1px solid rgba(148, 163, 184, 0.24);
        border-radius: 8px;
        background: rgba(2, 6, 23, 0.72);
        color: #d1fae5;
        font: 10px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
        backdrop-filter: blur(8px);
      }

      label {
        display: grid;
        gap: 4px;
      }

      input {
        width: 100%;
        accent-color: #5eead4;
      }
    </style>
    <div class="cube-shell">
      <canvas id="shader-cube" aria-label="Rotating shader cube"></canvas>
      <div class="controls" data-no-drag>
        <label>
          hue
          <input id="hue" type="range" min="0" max="1" step="0.001" value="${state.hueShift}">
        </label>
        <label>
          speed
          <input id="speed" type="range" min="0" max="2" step="0.01" value="${state.speed}">
        </label>
      </div>
    </div>
  `;

  const canvas = ctx.domRoot.querySelector('#shader-cube');
  const hueInput = ctx.domRoot.querySelector('#hue');
  const speedInput = ctx.domRoot.querySelector('#speed');
  const gl = canvas.getContext('webgl', { antialias: true, alpha: false });

  if (!gl) {
    ctx.domRoot.innerHTML = `
      <style>
        .fallback {
          box-sizing: border-box;
          width: 100%;
          height: 100%;
          display: grid;
          place-items: center;
          border: 1px solid #334155;
          border-radius: 8px;
          background: #060a10;
          color: #e2e8f0;
          font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
        }
      </style>
      <div class="fallback">WebGL unavailable</div>
    `;
    return {};
  }

  const vertexSource = `
    attribute vec3 aPosition;
    attribute vec3 aNormal;

    uniform mat4 uProjection;
    uniform mat4 uModelView;
    uniform mat3 uNormalMatrix;

    varying vec3 vNormal;
    varying vec3 vPosition;

    void main() {
      vec4 worldPosition = uModelView * vec4(aPosition, 1.0);
      vPosition = worldPosition.xyz;
      vNormal = normalize(uNormalMatrix * aNormal);
      gl_Position = uProjection * worldPosition;
    }
  `;

  const fragmentSource = `
    precision highp float;

    uniform float uTime;
    uniform float uHueShift;

    varying vec3 vNormal;
    varying vec3 vPosition;

    vec3 palette(float t) {
      vec3 a = vec3(0.42, 0.48, 0.58);
      vec3 b = vec3(0.42, 0.36, 0.34);
      vec3 c = vec3(0.85, 0.72, 0.62);
      vec3 d = vec3(0.12, 0.35, 0.58);
      return a + b * cos(6.28318 * (c * t + d));
    }

    void main() {
      vec3 normal = normalize(vNormal);
      vec3 lightA = normalize(vec3(0.35, 0.72, 0.58));
      vec3 lightB = normalize(vec3(-0.62, -0.24, 0.74));
      float key = max(dot(normal, lightA), 0.0);
      float rim = pow(1.0 - max(dot(normalize(-vPosition), normal), 0.0), 2.0);
      float fill = max(dot(normal, lightB), 0.0) * 0.35;
      float bands = 0.5 + 0.5 * sin((normal.x + normal.y + normal.z) * 7.0 + uTime * 1.7);
      vec3 color = palette(normal.z * 0.28 + bands * 0.16 + uHueShift);
      color *= 0.18 + key * 0.86 + fill;
      color += rim * vec3(0.45, 0.95, 1.0);
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
  } catch (err) {
    ctx.domRoot.innerHTML = `<pre style="box-sizing:border-box;width:100%;height:100%;white-space:pre-wrap;color:#fecaca;background:#17080a;padding:12px;border-radius:8px">${err.message}</pre>`;
    return {};
  }

  const positions = new Float32Array([
    -1, -1,  1,  1, -1,  1,  1,  1,  1, -1,  1,  1,
    -1, -1, -1, -1,  1, -1,  1,  1, -1,  1, -1, -1,
    -1,  1, -1, -1,  1,  1,  1,  1,  1,  1,  1, -1,
    -1, -1, -1,  1, -1, -1,  1, -1,  1, -1, -1,  1,
     1, -1, -1,  1,  1, -1,  1,  1,  1,  1, -1,  1,
    -1, -1, -1, -1, -1,  1, -1,  1,  1, -1,  1, -1
  ]);

  const normals = new Float32Array([
     0,  0,  1,  0,  0,  1,  0,  0,  1,  0,  0,  1,
     0,  0, -1,  0,  0, -1,  0,  0, -1,  0,  0, -1,
     0,  1,  0,  0,  1,  0,  0,  1,  0,  0,  1,  0,
     0, -1,  0,  0, -1,  0,  0, -1,  0,  0, -1,  0,
     1,  0,  0,  1,  0,  0,  1,  0,  0,  1,  0,  0,
    -1,  0,  0, -1,  0,  0, -1,  0,  0, -1,  0,  0
  ]);

  const indices = new Uint16Array([
     0,  1,  2,  0,  2,  3,
     4,  5,  6,  4,  6,  7,
     8,  9, 10,  8, 10, 11,
    12, 13, 14, 12, 14, 15,
    16, 17, 18, 16, 18, 19,
    20, 21, 22, 20, 22, 23
  ]);

  function bindArrayBuffer(attributeName, data, size) {
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const location = gl.getAttribLocation(program, attributeName);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
    return buffer;
  }

  gl.useProgram(program);
  const positionBuffer = bindArrayBuffer('aPosition', positions, 3);
  const normalBuffer = bindArrayBuffer('aNormal', normals, 3);
  const indexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

  const uniforms = {
    projection: gl.getUniformLocation(program, 'uProjection'),
    modelView: gl.getUniformLocation(program, 'uModelView'),
    normalMatrix: gl.getUniformLocation(program, 'uNormalMatrix'),
    time: gl.getUniformLocation(program, 'uTime'),
    hueShift: gl.getUniformLocation(program, 'uHueShift')
  };

  function mat4Multiply(a, b) {
    const out = new Float32Array(16);
    for (let row = 0; row < 4; row += 1) {
      for (let col = 0; col < 4; col += 1) {
        out[col * 4 + row] =
          a[0 * 4 + row] * b[col * 4 + 0] +
          a[1 * 4 + row] * b[col * 4 + 1] +
          a[2 * 4 + row] * b[col * 4 + 2] +
          a[3 * 4 + row] * b[col * 4 + 3];
      }
    }
    return out;
  }

  function mat4Perspective(fovRadians, aspect, near, far) {
    const f = 1 / Math.tan(fovRadians / 2);
    const rangeInv = 1 / (near - far);
    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (near + far) * rangeInv, -1,
      0, 0, near * far * rangeInv * 2, 0
    ]);
  }

  const mat4Translation = (x, y, z) => new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    x, y, z, 1
  ]);

  function mat4RotateX(angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return new Float32Array([
      1, 0, 0, 0,
      0, c, s, 0,
      0, -s, c, 0,
      0, 0, 0, 1
    ]);
  }

  function mat4RotateY(angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return new Float32Array([
      c, 0, -s, 0,
      0, 1, 0, 0,
      s, 0, c, 0,
      0, 0, 0, 1
    ]);
  }

  function mat4RotateZ(angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return new Float32Array([
      c, s, 0, 0,
      -s, c, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1
    ]);
  }

  const normalMatrixFromModelView = (matrix) => new Float32Array([
    matrix[0], matrix[1], matrix[2],
    matrix[4], matrix[5], matrix[6],
    matrix[8], matrix[9], matrix[10]
  ]);

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(rect.width * dpr));
    const height = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  function render() {
    resizeCanvas();
    const time = performance.now() * 0.001 * state.speed;
    const aspect = canvas.width / canvas.height;
    const projection = mat4Perspective(Math.PI / 4, aspect, 0.1, 100);
    const modelView = mat4Multiply(
      mat4Translation(0, 0, -5.2),
      mat4Multiply(
        mat4RotateY(time * 0.72),
        mat4Multiply(mat4RotateX(time * 0.48), mat4RotateZ(Math.sin(time * 0.31) * 0.18))
      )
    );

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.clearColor(0.01, 0.015, 0.025, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(program);
    gl.uniformMatrix4fv(uniforms.projection, false, projection);
    gl.uniformMatrix4fv(uniforms.modelView, false, modelView);
    gl.uniformMatrix3fv(uniforms.normalMatrix, false, normalMatrixFromModelView(modelView));
    gl.uniform1f(uniforms.time, time);
    gl.uniform1f(uniforms.hueShift, state.hueShift);
    gl.drawElements(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0);
  }

  function onHueInput() {
    state.hueShift = Number(hueInput.value);
    ctx.bus.pubGlobal('shaderCubeHue', state.hueShift);
  }

  function onSpeedInput() {
    state.speed = Number(speedInput.value);
    ctx.bus.pubGlobal('shaderCubeSpeed', state.speed);
  }

  const unsubscribeHue = ctx.bus.subGlobal('shaderCubeHue', value => {
    if (!Number.isFinite(value)) return;
    state.hueShift = value;
    hueInput.value = String(value);
  });
  const unsubscribeSpeed = ctx.bus.subGlobal('shaderCubeSpeed', value => {
    if (!Number.isFinite(value)) return;
    state.speed = value;
    speedInput.value = String(value);
  });

  hueInput.addEventListener('input', onHueInput);
  speedInput.addEventListener('input', onSpeedInput);
  render();

  return {
    update() {
      render();
    },
    getState() {
      return { ...state };
    },
    destroy() {
      hueInput.removeEventListener('input', onHueInput);
      speedInput.removeEventListener('input', onSpeedInput);
      unsubscribeHue();
      unsubscribeSpeed();
      gl.deleteBuffer(positionBuffer);
      gl.deleteBuffer(normalBuffer);
      gl.deleteBuffer(indexBuffer);
      gl.deleteProgram(program);
    }
  };
}
