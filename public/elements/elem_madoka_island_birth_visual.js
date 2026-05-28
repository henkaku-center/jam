const STATE_VERSION = 'madoka-t0-a2-p5-embed-v1';
const SOURCE_URL = 'https://aps-i.chibatech.dev/examples/madoka-t0-a2/';

export default function setup(ctx, prevState) {
  const state = {
    stateVersion: STATE_VERSION,
    loadedAt: prevState?.loadedAt || Date.now()
  };

  ctx.domRoot.innerHTML = `
    <style>
      :host {
        display: block;
        width: 100%;
        height: 100%;
      }
      .frame-shell {
        position: relative;
        box-sizing: border-box;
        width: 100%;
        height: 100%;
        min-width: 420px;
        min-height: 300px;
        overflow: hidden;
        border-radius: 8px;
        border: 1px solid rgba(148, 163, 184, 0.24);
        background: #000;
      }
      iframe {
        display: block;
        width: 100%;
        height: 100%;
        border: 0;
        background: #000;
      }
      .label {
        position: absolute;
        left: 10px;
        bottom: 9px;
        padding: 5px 7px;
        border-radius: 6px;
        color: rgba(248, 250, 252, 0.78);
        background: rgba(2, 6, 23, 0.48);
        border: 1px solid rgba(148, 163, 184, 0.18);
        font: 10px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        pointer-events: none;
        text-shadow: 0 1px 6px rgba(0, 0, 0, 0.72);
      }
      .reload {
        position: absolute;
        right: 9px;
        bottom: 8px;
        width: 28px;
        height: 24px;
        border: 1px solid rgba(148, 163, 184, 0.28);
        border-radius: 6px;
        color: rgba(248, 250, 252, 0.8);
        background: rgba(2, 6, 23, 0.48);
        font: 15px/1 ui-sans-serif, system-ui, sans-serif;
        cursor: pointer;
      }
      .reload:hover {
        background: rgba(15, 23, 42, 0.68);
      }
    </style>
    <div class="frame-shell">
      <iframe
        id="frame"
        title="APS-I madoka-t0-a2 full p5.js example"
        src="${SOURCE_URL}"
        loading="eager"
        allow="fullscreen"
        referrerpolicy="no-referrer-when-downgrade"
        sandbox="allow-scripts allow-same-origin allow-pointer-lock"
      ></iframe>
      <div class="label">full p5.js madoka-t0-a2</div>
      <button class="reload" id="reload" type="button" title="Reload p5 scene">↻</button>
    </div>
  `;

  const frame = ctx.domRoot.querySelector('#frame');
  const reload = ctx.domRoot.querySelector('#reload');

  const onReload = () => {
    state.loadedAt = Date.now();
    frame.src = `${SOURCE_URL}?jamReload=${state.loadedAt}`;
  };

  reload.addEventListener('click', onReload);

  return {
    update() {},
    getState() {
      return { ...state };
    },
    destroy() {
      reload.removeEventListener('click', onReload);
      frame.src = 'about:blank';
    }
  };
}
