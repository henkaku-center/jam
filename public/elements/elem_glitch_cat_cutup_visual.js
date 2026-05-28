const STATE_VERSION = 'glitch-cat-cutup-v1';

const CAT_SCENES = [
  'https://placecats.com/neo/720/480',
  'https://placecats.com/millie/720/480',
  'https://placecats.com/bella/720/480',
  'https://placecats.com/g/720/480',
  'https://placecats.com/720/480',
  'https://placecats.com/poppy/720/480'
];

export default function setup(ctx, prevState) {
  const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  const state = {
    stateVersion: STATE_VERSION,
    speed: finite(prevState?.speed, 0.72),
    glitch: finite(prevState?.glitch, 0.88),
    smear: finite(prevState?.smear, 0.58)
  };

  let frameTimer = 0;
  let raf = 0;
  let sceneIndex = 0;
  let altIndex = 2;
  let frame = 0;

  ctx.domRoot.innerHTML = `
    <style>
      :host {
        display: block;
        width: 100%;
        height: 100%;
      }

      .cat-glitch {
        position: relative;
        width: 100%;
        height: 100%;
        min-width: 260px;
        min-height: 180px;
        overflow: hidden;
        background: #050505;
        border-radius: 8px;
        border: 1px solid rgba(236, 72, 153, 0.55);
        isolation: isolate;
        font: 11px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }

      .scene,
      .rgb,
      .slice {
        position: absolute;
        inset: 0;
        background-size: cover;
        background-position: center;
        will-change: transform, filter, opacity, clip-path;
      }

      .scene {
        filter: contrast(1.22) saturate(1.1) brightness(0.92);
        transform: scale(1.035);
      }

      .scene.alt {
        mix-blend-mode: lighten;
        opacity: 0;
        filter: contrast(1.7) saturate(0.35) invert(1);
      }

      .rgb {
        pointer-events: none;
        opacity: 0.42;
        mix-blend-mode: screen;
      }

      .rgb.red {
        filter: sepia(1) saturate(8) hue-rotate(302deg);
      }

      .rgb.cyan {
        filter: sepia(1) saturate(8) hue-rotate(132deg);
      }

      .slice {
        opacity: 0.95;
        mix-blend-mode: hard-light;
        filter: contrast(1.55) saturate(1.6);
      }

      .static,
      .scan,
      .counter {
        position: absolute;
        pointer-events: none;
      }

      .static {
        inset: 0;
        opacity: calc(0.18 + var(--noise, 0) * 0.18);
        mix-blend-mode: screen;
        background:
          repeating-radial-gradient(circle at 20% 30%, rgba(255,255,255,0.22) 0 1px, transparent 1px 3px),
          repeating-linear-gradient(0deg, rgba(255,255,255,0.06) 0 1px, transparent 1px 4px);
        background-size: 13px 11px, 100% 4px;
        transform: translate3d(var(--static-x, 0px), var(--static-y, 0px), 0);
      }

      .scan {
        inset: 0;
        z-index: 8;
        opacity: 0.42;
        background:
          linear-gradient(transparent 0 48%, rgba(255, 255, 255, 0.16) 49%, transparent 52%),
          repeating-linear-gradient(0deg, rgba(0,0,0,0.36) 0 1px, transparent 1px 3px);
        transform: translateY(var(--scan-y, 0%));
        mix-blend-mode: overlay;
      }

      .counter {
        right: 8px;
        bottom: 7px;
        z-index: 12;
        color: rgba(255, 255, 255, 0.72);
        text-shadow: 1px 0 #ef4444, -1px 0 #22d3ee;
      }

      .cat-glitch.burst .scene {
        filter: contrast(2.1) saturate(0.25) brightness(1.25);
      }

      .cat-glitch.burst .scene.alt {
        opacity: 0.64;
      }
    </style>
    <div class="cat-glitch" id="root">
      <div class="scene" id="main"></div>
      <div class="scene alt" id="alt"></div>
      <div class="rgb red" id="red"></div>
      <div class="rgb cyan" id="cyan"></div>
      <div id="slices"></div>
      <div class="static" id="static"></div>
      <div class="scan"></div>
      <div class="counter" id="counter"></div>
    </div>
  `;

  const root = ctx.domRoot.querySelector('#root');
  const main = ctx.domRoot.querySelector('#main');
  const alt = ctx.domRoot.querySelector('#alt');
  const red = ctx.domRoot.querySelector('#red');
  const cyan = ctx.domRoot.querySelector('#cyan');
  const slices = ctx.domRoot.querySelector('#slices');
  const staticLayer = ctx.domRoot.querySelector('#static');
  const counter = ctx.domRoot.querySelector('#counter');

  const pickScene = (offset = 0) => CAT_SCENES[(sceneIndex + offset + CAT_SCENES.length) % CAT_SCENES.length];
  const setBackground = (element, url) => {
    element.style.backgroundImage = `url("${url}")`;
  };

  const randomScene = () => CAT_SCENES[Math.floor(Math.random() * CAT_SCENES.length)];

  const renderSlices = () => {
    const count = 7 + Math.round(state.glitch * 10);
    const pieces = [];
    for (let i = 0; i < count; i += 1) {
      const y = Math.random() * 96;
      const h = 2 + Math.random() * (5 + state.glitch * 11);
      const x = (Math.random() - 0.5) * (24 + state.glitch * 86);
      const scale = 1.02 + Math.random() * 0.05;
      const hue = Math.round((Math.random() - 0.5) * 70);
      const image = Math.random() < state.glitch ? randomScene() : pickScene();
      pieces.push(`<div class="slice" style="
        clip-path: inset(${y}% 0 ${Math.max(0, 100 - y - h)}% 0);
        background-image: url('${image}');
        transform: translate3d(${x.toFixed(1)}px, ${(Math.random() - 0.5) * 8}px, 0) scale(${scale.toFixed(3)});
        filter: hue-rotate(${hue}deg) contrast(${(1.25 + Math.random() * 1.2).toFixed(2)}) saturate(${(0.55 + Math.random() * 2.4).toFixed(2)});
      "></div>`);
    }
    slices.innerHTML = pieces.join('');
  };

  const cut = () => {
    frame += 1;
    const jump = Math.random() < 0.58 + state.glitch * 0.3;
    if (jump) sceneIndex = Math.floor(Math.random() * CAT_SCENES.length);
    else sceneIndex = (sceneIndex + 1) % CAT_SCENES.length;
    altIndex = Math.floor(Math.random() * CAT_SCENES.length);

    const mainUrl = pickScene();
    const altUrl = CAT_SCENES[altIndex];
    setBackground(main, mainUrl);
    setBackground(alt, altUrl);
    setBackground(red, mainUrl);
    setBackground(cyan, altUrl);

    const blast = Math.random() < state.glitch * 0.55;
    root.classList.toggle('burst', blast);
    const smear = state.smear;
    const redX = (Math.random() - 0.5) * (8 + smear * 42);
    const cyanX = (Math.random() - 0.5) * (8 + smear * 52);
    const skew = (Math.random() - 0.5) * state.glitch * 9;
    main.style.transform = `translate3d(${(Math.random() - 0.5) * state.glitch * 20}px, ${(Math.random() - 0.5) * state.glitch * 10}px, 0) scale(${(1.02 + Math.random() * 0.08).toFixed(3)}) skewX(${skew.toFixed(2)}deg)`;
    alt.style.transform = `translate3d(${(-redX).toFixed(1)}px, ${(Math.random() - 0.5) * 18}px, 0) scale(1.06)`;
    red.style.transform = `translate3d(${redX.toFixed(1)}px, 0, 0) scale(1.035)`;
    cyan.style.transform = `translate3d(${cyanX.toFixed(1)}px, ${(Math.random() - 0.5) * 12}px, 0) scale(1.04)`;
    counter.textContent = `CAT//${String(frame % 10000).padStart(4, '0')}`;
    renderSlices();

    clearTimeout(frameTimer);
    const interval = 42 + (1 - state.speed) * 130 + Math.random() * 46;
    frameTimer = setTimeout(cut, interval);
  };

  const animate = () => {
    const noise = Math.random();
    staticLayer.style.setProperty('--noise', noise.toFixed(3));
    staticLayer.style.setProperty('--static-x', `${Math.round((Math.random() - 0.5) * 14)}px`);
    staticLayer.style.setProperty('--static-y', `${Math.round((Math.random() - 0.5) * 10)}px`);
    root.style.setProperty('--scan-y', `${((performance.now() * 0.04) % 120 - 10).toFixed(1)}%`);
    raf = requestAnimationFrame(animate);
  };

  CAT_SCENES.forEach((url) => {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
  });

  cut();
  animate();

  return {
    update() {},
    getState() {
      return { ...state };
    },
    destroy() {
      clearTimeout(frameTimer);
      cancelAnimationFrame(raf);
      slices.innerHTML = '';
    }
  };
}
