export default function setup(ctx, prevState) {
  const state = {
    enabled: prevState?.enabled ?? true,
    value: Number.isFinite(prevState?.value) ? prevState.value : 0
  };

  ctx.domRoot.innerHTML = `
    <style>
      .template {
        box-sizing: border-box;
        height: 100%;
        padding: 12px;
        background: #081018;
        color: #d1fae5;
        font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      label {
        display: grid;
        gap: 6px;
      }
      input {
        width: 100%;
      }
    </style>
    <div class="template">
      <label>
        value
        <input id="value" type="range" min="0" max="1" step="0.001" value="${state.value}">
      </label>
      <div id="readout"></div>
    </div>
  `;

  const readout = ctx.domRoot.querySelector('#readout');
  const slider = ctx.domRoot.querySelector('#value');
  const gain = ctx.audioCtx.createGain();
  gain.gain.value = 0;
  gain.connect(ctx.audioOut);

  const render = () => {
    readout.textContent = `value=${state.value.toFixed(3)}`;
  };

  const onInput = () => {
    state.value = Number(slider.value);
    ctx.bus.pubGlobal('value', state.value);
    render();
  };

  slider.addEventListener('input', onInput);
  const unsubscribeGlobal = ctx.bus.subGlobal('value', (value) => {
    if (!Number.isFinite(value)) return;
    state.value = value;
    slider.value = String(value);
    render();
  });
  const unsubscribeTick = ctx.clock.onTick(({ step }) => {
    ctx.bus.pub('step', step);
  });

  render();

  return {
    update() {},
    getState() {
      return { ...state };
    },
    destroy() {
      slider.removeEventListener('input', onInput);
      unsubscribeGlobal();
      unsubscribeTick();
      gain.disconnect();
    }
  };
}
