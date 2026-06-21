import { expect, test } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const workspacePath = path.join(repoRoot, 'workspace_layout.json');
const elementsDir = path.join(repoRoot, 'public/elements');

const hostHydrateBudgetMs = Number(process.env.JAM_HOST_HYDRATE_BUDGET_MS || 15_000);
const controllerHydrateBudgetMs = Number(process.env.JAM_CONTROLLER_HYDRATE_BUDGET_MS || 15_000);
const controllerSyncBudgetMs = Number(process.env.JAM_CONTROLLER_SYNC_BUDGET_MS || 2_000);
const appBaseURL = process.env.JAM_BASE_URL || `http://127.0.0.1:${process.env.PORT || '3100'}`;

let fileSnapshot;
let expectedElementCount;

async function snapshotMutableWorkspaceFiles() {
  const entries = await fs.readdir(elementsDir);
  const files = [workspacePath, ...entries.map((entry) => path.join(elementsDir, entry))];
  const snapshot = new Map();

  for (const file of files) {
    try {
      snapshot.set(file, await fs.readFile(file));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  return snapshot;
}

async function restoreMutableWorkspaceFiles(snapshot) {
  const currentElementFiles = (await fs.readdir(elementsDir)).map((entry) => path.join(elementsDir, entry));
  const originalFiles = new Set(snapshot.keys());

  for (const file of currentElementFiles) {
    if (!originalFiles.has(file)) {
      await fs.rm(file, { force: true });
    }
  }

  for (const [file, contents] of snapshot) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, contents);
  }
}

async function readExpectedElementCount() {
  const workspace = JSON.parse(await fs.readFile(workspacePath, 'utf8'));
  return Object.keys(workspace).length;
}

function connectTerminalAndReadBanner() {
  const wsUrl = appBaseURL.replace(/^http/, 'ws') + '/agent-terminal';
  const socket = new WebSocket(wsUrl);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error('timed out waiting for terminal banner'));
    }, 5000);

    socket.on('message', (raw) => {
      try {
        const message = JSON.parse(raw.toString());
        if (message.type !== 'data') return;
        const match = String(message.data).match(/jam test terminal (\d+)/);
        if (!match) return;
        clearTimeout(timeout);
        resolve({ socket, pid: match[1] });
      } catch (error) {
        clearTimeout(timeout);
        socket.close();
        reject(error);
      }
    });

    socket.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

function collectBrowserFailures(page) {
  const failures = [];

  page.on('pageerror', (error) => {
    failures.push(`pageerror: ${error.message}`);
  });

  page.on('console', (message) => {
    const text = message.text();
    const isKnownNoise =
      /Yjs was already imported/.test(text) ||
      /favicon\.ico/.test(text) ||
      /Failed to load resource: the server responded with a status of 404 \(Not Found\)/.test(text) ||
      /GL Driver Message.*GPU stall due to ReadPixels/.test(text);

    if ((message.type() === 'error' || message.type() === 'warning') && !isKnownNoise) {
      failures.push(`${message.type()}: ${text}`);
    }
  });

  page.on('response', (response) => {
    const status = response.status();
    const url = response.url();
    if (status >= 400 && !url.endsWith('/favicon.ico')) {
      failures.push(`http ${status}: ${url}`);
    }
  });

  return failures;
}

async function installPerfObserver(page) {
  await page.addInitScript(() => {
    window.__jamLongTasks = [];
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__jamLongTasks.push({
            name: entry.name,
            startTime: entry.startTime,
            duration: entry.duration
          });
        }
      });
      observer.observe({ type: 'longtask', buffered: true });
    } catch {
      window.__jamLongTasksUnsupported = true;
    }
  });
}

async function joinWorkspace(page, mode, expectedCount = expectedElementCount) {
  const startedAt = Date.now();
  await installPerfObserver(page);
  const audioQuery = mode === 'host' ? '?audio=on' : '';
  await page.goto(`${appBaseURL}/${audioQuery}#test-${mode}-${Date.now()}`, { waitUntil: 'domcontentloaded' });

  await page.locator('#join-host-btn').click();

  await expect(page.locator('#autoplay-overlay')).toHaveClass(/hidden/);
  await expect(page.locator('#app')).not.toHaveClass(/hidden/);

  await expect
    .poll(() => page.evaluate(() => window.activeElements?.size ?? 0), {
      message: 'workspace elements should be hydrated',
      timeout: 12_000
    })
    .toBe(expectedCount);

  await expect(page.locator('.canvas-element-wrapper')).toHaveCount(expectedCount);

  const hydrateMs = Date.now() - startedAt;
  const metrics = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const resources = performance.getEntriesByType('resource');
    const compileCalls = resources.filter((entry) => entry.name.includes('/api/compile'));

    return {
      navigation: nav
        ? {
            domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd - nav.startTime),
            loadMs: Math.round(nav.loadEventEnd - nav.startTime)
          }
        : null,
      compileCallCount: compileCalls.length,
      slowestCompileCallMs: Math.round(Math.max(0, ...compileCalls.map((entry) => entry.duration))),
      longTaskCount: window.__jamLongTasks?.length ?? 0,
      maxLongTaskMs: Math.round(Math.max(0, ...(window.__jamLongTasks || []).map((entry) => entry.duration))),
      longTasksUnsupported: Boolean(window.__jamLongTasksUnsupported)
    };
  });

  return { hydrateMs, metrics };
}

async function readCenteredCameraState(page) {
  return page.evaluate(() => {
    const layouts = [...window.elementsMap.values()];
    const bounds = layouts.reduce((acc, layout) => {
      const x = Number(layout.x);
      const y = Number(layout.y);
      const width = Number.isFinite(Number(layout.width)) ? Number(layout.width) : 260;
      const height = Number.isFinite(Number(layout.height)) ? Number(layout.height) : 200;
      return {
        left: Math.min(acc.left, x),
        top: Math.min(acc.top, y),
        right: Math.max(acc.right, x + Math.max(1, width)),
        bottom: Math.max(acc.bottom, y + Math.max(1, height))
      };
    }, { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });

    const viewport = document.querySelector('#canvas-viewport');
    const viewportWidth = viewport.clientWidth || window.innerWidth;
    const viewportHeight = viewport.clientHeight || window.innerHeight;
    const boundsWidth = Math.max(1, bounds.right - bounds.left);
    const boundsHeight = Math.max(1, bounds.bottom - bounds.top);
    const padding = 96;
    const expectedZoom = Math.max(0.08, Math.min(
      2.5,
      Math.max(1, viewportWidth - padding * 2) / boundsWidth,
      Math.max(1, viewportHeight - padding * 2) / boundsHeight
    ));
    const centerX = (bounds.left + bounds.right) / 2;
    const centerY = (bounds.top + bounds.bottom) / 2;
    const expectedX = viewportWidth / 2 - centerX * expectedZoom;
    const expectedY = viewportHeight / 2 - centerY * expectedZoom;

    return {
      actualX: Math.round(window.__jamCamera?.x ?? 0),
      actualY: Math.round(window.__jamCamera?.y ?? 0),
      actualZoom: Number((window.__jamCamera?.zoom ?? 1).toFixed(2)),
      expectedX: Math.round(expectedX),
      expectedY: Math.round(expectedY),
      expectedZoom: Number(expectedZoom.toFixed(2))
    };
  });
}

async function openAddElementMenu(page, position = { x: 420, y: 260 }) {
  await page.evaluate(({ x, y }) => {
    const viewport = document.querySelector('#canvas-viewport');
    if (!viewport) throw new Error('missing canvas viewport');
    const rect = viewport.getBoundingClientRect();
    viewport.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      button: 2,
      buttons: 2,
      clientX: rect.left + x,
      clientY: rect.top + y
    }));
  }, position);
  await expect(page.locator('#add-element-menu')).not.toHaveClass(/hidden/);
}

async function addElementFromMenu(page, kind, position = { x: 420, y: 260 }) {
  await openAddElementMenu(page, position);
  await page.locator(`#add-element-menu [data-add-element="${kind}"]`).click();
}

function expectCameraCentered(result) {
  expect(result.actualX).toBeCloseTo(result.expectedX, 0);
  expect(result.actualY).toBeCloseTo(result.expectedY, 0);
  expect(result.actualZoom).toBe(result.expectedZoom);
}

async function setFirstSynthFrequency(page, value) {
  return page.evaluate((nextValue) => {
    for (const host of document.querySelectorAll('.element-shadow-container')) {
      const root = host.shadowRoot;
      const slider = root?.querySelector('#freq-slider');
      if (!slider) continue;

      slider.value = String(nextValue);
      slider.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      return true;
    }

    return false;
  }, value);
}

async function readSynthFrequencies(page) {
  return page.evaluate(() => {
    const values = [];

    for (const host of document.querySelectorAll('.element-shadow-container')) {
      const root = host.shadowRoot;
      const slider = root?.querySelector('#freq-slider');
      const label = root?.querySelector('#freq-val');
      if (slider) {
        values.push({ value: slider.value, label: label?.textContent || '' });
      }
    }

    return values;
  });
}

test.beforeAll(async () => {
  fileSnapshot = await snapshotMutableWorkspaceFiles();
  expectedElementCount = await readExpectedElementCount();
});

test.afterAll(async () => {
  await restoreMutableWorkspaceFiles(fileSnapshot);
});

test('Agent workspace API reloads hand-authored elements without codegen overwrite', async ({ request }) => {
  const id = `elem_hand_${Date.now()}`;
  const publicPath = `/elements/${id}_visual.js`;
  const diskPath = path.join(elementsDir, `${id}_visual.js`);
  const marker = `HAND_AUTHORED_${Date.now()}`;
  const source = `export default function setup(ctx) {
  ctx.domRoot.innerHTML = '<div>${marker}</div>';
  return { getState() { return { marker: '${marker}' }; }, destroy() {} };
}
`;

  await fs.writeFile(diskPath, source, 'utf8');

  try {
    const addResponse = await request.post('/api/workspace/elements', {
      data: {
        id,
        filePath: publicPath,
        type: 'visual',
        prompt: 'hand-authored visual that should not be overwritten',
        authored: 'hand',
        x: 64,
        y: 96,
        width: 240,
        height: 160
      }
    });
    await expect(addResponse).toBeOK();

    const compileResponse = await request.post('/api/compile', {
      data: {
        prompt: 'replace this with a drum step sequencer',
        elementId: id,
        filePath: publicPath,
        prevState: {},
        forceCompile: true,
        authored: 'hand'
      }
    });
    await expect(compileResponse).toBeOK();
    const compiled = await compileResponse.json();
    expect(compiled.rawCode).toContain(marker);
    expect(await fs.readFile(diskPath, 'utf8')).toContain(marker);

    const reloadResponse = await request.post(`/api/workspace/elements/${id}/reload`);
    await expect(reloadResponse).toBeOK();
    const reload = await reloadResponse.json();
    expect(reload.layout.authored).toBe('hand');
    expect(reload.layout.reloadToken).toBeGreaterThan(0);

    const stateResponse = await request.get('/api/workspace/state');
    await expect(stateResponse).toBeOK();
    const state = await stateResponse.json();
    expect(state.elements.some((element) => element.id === id && element.authored === 'hand')).toBe(true);
  } finally {
    await request.delete(`/api/workspace/elements/${id}`);
  }
});

test('Agent terminal creates an independent PTY per browser connection', async () => {
  const first = await connectTerminalAndReadBanner();
  const second = await connectTerminalAndReadBanner();

  try {
    expect(first.pid).not.toBe(second.pid);
  } finally {
    first.socket.close();
    second.socket.close();
  }
});

test('Host workspace hydrates within the startup performance budget', async ({ page }, testInfo) => {
  const browserFailures = collectBrowserFailures(page);
  const result = await joinWorkspace(page, 'host');

  await testInfo.attach('host-startup-metrics.json', {
    contentType: 'application/json',
    body: JSON.stringify(result, null, 2)
  });

  const terminalBounds = await page.evaluate(() => {
    const rect = document.querySelector('#agent-terminal')?.getBoundingClientRect();
    return {
      left: rect?.left ?? -1,
      top: rect?.top ?? -1,
      width: rect?.width ?? 0,
      height: rect?.height ?? 0,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight
    };
  });
  expect(terminalBounds).toMatchObject({
    left: 0,
    top: 0,
    width: terminalBounds.viewportWidth,
    height: terminalBounds.viewportHeight
  });

  expect(result.hydrateMs).toBeLessThan(hostHydrateBudgetMs);
  expect(result.metrics.slowestCompileCallMs).toBeLessThan(5_000);
  expect(result.metrics.maxLongTaskMs).toBeLessThan(1_000);
  expect(browserFailures).toEqual([]);
});

test('Normal mode pan and zoom keep a global audio mix', async ({ page }) => {
  const browserFailures = collectBrowserFailures(page);
  await joinWorkspace(page, 'host');

  await page.mouse.move(640, 400);
  await page.mouse.wheel(0, -900);
  await page.mouse.down();
  await page.mouse.move(240, 160, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  const mix = await page.evaluate(() => [...window.activeElements.values()].map((element) => ({
    id: element.id,
    volume: element.audioVolumeNode?.gain.value ?? null,
    pan: element.audioPannerNode?.pan.value ?? null,
    cutoff: element.audioFilterNode?.frequency.value ?? null,
    visible: element.domWrapper.style.visibility !== 'hidden'
  })));

  expect(mix.length).toBe(expectedElementCount);
  expect(mix.every((element) => element.volume === null || element.volume > 0.85)).toBe(true);
  expect(mix.every((element) => element.pan === null || Math.abs(element.pan) < 0.1)).toBe(true);
  expect(mix.every((element) => element.cutoff === null || element.cutoff > 15_000)).toBe(true);
  expect(mix.some((element) => element.visible)).toBe(true);
  expect(browserFailures).toEqual([]);
});

test('Initial workspace view starts centered on current element bounds', async ({ page }) => {
  await joinWorkspace(page, 'controller');

  let result;
  await expect
    .poll(async () => {
      result = await readCenteredCameraState(page);
      return Math.abs(result.actualX - result.expectedX) <= 1 &&
        Math.abs(result.actualY - result.expectedY) <= 1 &&
        result.actualZoom === result.expectedZoom;
    }, {
      message: 'initial camera should settle centered on element bounds',
      timeout: 3_000
    })
    .toBe(true);
  expectCameraCentered(result);
});

test('Center Cam frames the bounding box of current workspace elements', async ({ page, request }) => {
  await joinWorkspace(page, 'controller');
  const suffix = Date.now();
  const ids = [`elem_center_a_${suffix}`, `elem_center_b_${suffix}`];

  try {
    for (const [index, id] of ids.entries()) {
      const response = await request.post('/api/workspace/elements', {
        data: {
          id,
          filePath: '/elements/_template_element.js',
          type: 'tool',
          prompt: 'center camera regression fixture',
          authored: 'hand',
          x: index === 0 ? -1800 : 2600,
          y: index === 0 ? -900 : 1400,
          width: index === 0 ? 320 : 420,
          height: index === 0 ? 240 : 300
        }
      });
      await expect(response).toBeOK();
    }

    await expect
      .poll(() => page.evaluate((expectedIds) => expectedIds.every(id => window.activeElements.has(id)), ids), {
        message: 'center camera fixtures should hydrate',
        timeout: 5_000
      })
      .toBe(true);

    await page.mouse.move(640, 400);
    await page.mouse.wheel(0, -900);
    await page.mouse.down();
    await page.mouse.move(160, 140, { steps: 6 });
    await page.mouse.up();
    await page.evaluate(() => window.__jamCenterCamera?.());

    const result = await readCenteredCameraState(page);
    expectCameraCentered(result);
    expect(result.actualX).not.toBe(0);
    expect(result.actualY).not.toBe(0);
  } finally {
    await Promise.all(ids.map(id => request.delete(`/api/workspace/elements/${id}`)));
  }
});

test('Element wrapper keeps layout width while dragging near viewport edge', async ({ page, request }) => {
  await joinWorkspace(page, 'controller');
  const id = `elem_drag_width_${Date.now()}`;
  const position = await page.evaluate(() => {
    const rect = document.querySelector('#canvas-viewport').getBoundingClientRect();
    const camera = window.__jamCamera || { x: 0, y: 0, zoom: 1 };
    return {
      x: Math.round((260 - rect.left - camera.x) / camera.zoom),
      y: Math.round((220 - rect.top - camera.y) / camera.zoom)
    };
  });

  try {
    const response = await request.post('/api/workspace/elements', {
      data: {
        id,
        filePath: '/elements/elem_drum_machine.js',
        type: 'audio',
        prompt: 'drag width regression drum machine',
        authored: 'hand',
        x: position.x,
        y: position.y,
        width: 520,
        height: 340
      }
    });
    await expect(response).toBeOK();

    await expect
      .poll(() => page.evaluate((elementId) => window.activeElements.has(elementId), id), {
        message: 'drag width fixture should hydrate',
        timeout: 8_000
      })
      .toBe(true);

    const before = await page.evaluate((elementId) => {
      const element = window.activeElements.get(elementId);
      const rect = element.domWrapper.getBoundingClientRect();
      return {
        rectWidth: rect.width,
        styleWidth: getComputedStyle(element.domWrapper).width,
        layoutWidth: window.elementsMap.get(elementId)?.width || 0
      };
    }, id);
    expect(before.layoutWidth).toBe(520);
    expect(Number.parseFloat(before.styleWidth)).toBeCloseTo(520, 0);

    const box = await page.locator(`#wrapper-${id}`).boundingBox();
    expect(box).toBeTruthy();
    await page.mouse.move(box.x + 18, box.y + 18);
    await page.mouse.down();
    await page.mouse.move(1160, box.y + 28, { steps: 12 });
    await page.mouse.up();

    const after = await page.evaluate((elementId) => {
      const element = window.activeElements.get(elementId);
      const rect = element.domWrapper.getBoundingClientRect();
      return {
        rectWidth: rect.width,
        styleWidth: getComputedStyle(element.domWrapper).width,
        layoutWidth: window.elementsMap.get(elementId)?.width || 0
      };
    }, id);
    expect(after.layoutWidth).toBe(520);
    expect(Number.parseFloat(after.styleWidth)).toBeCloseTo(520, 0);
    expect(after.rectWidth).toBeCloseTo(before.rectWidth, 0);
  } finally {
    await request.delete(`/api/workspace/elements/${id}`);
  }
});

test('Viewport context menu adds element types at the clicked location', async ({ page, request }) => {
  await joinWorkspace(page, 'controller');
  const beforeIds = await page.evaluate(() => [...window.elementsMap.keys()]);
  const clickPosition = { x: 360, y: 290 };

  await openAddElementMenu(page, clickPosition);
  await expect(page.locator('#add-element-menu [data-add-element]')).toHaveCount(4);

  const expectedPosition = await page.evaluate(({ x, y }) => {
    const rect = document.querySelector('#canvas-viewport').getBoundingClientRect();
    const camera = window.__jamCamera || { x: 0, y: 0, zoom: 1 };
    return {
      x: Math.round((x - rect.left - camera.x) / camera.zoom),
      y: Math.round((y - rect.top - camera.y) / camera.zoom)
    };
  }, clickPosition);

  await page.locator('#add-element-menu [data-add-element="visual"]').click();

  await expect
    .poll(() => page.evaluate((knownIds) => {
      for (const [id, layout] of window.elementsMap.entries()) {
        if (!knownIds.includes(id)) return { id, layout };
      }
      return null;
    }, beforeIds), {
      message: 'context menu should create an element',
      timeout: 5_000
    })
    .not.toBeNull();

  const createdElement = await page.evaluate((knownIds) => {
    for (const [id, layout] of window.elementsMap.entries()) {
      if (!knownIds.includes(id)) return { id, layout };
    }
    return null;
  }, beforeIds);

  try {
    expect(createdElement.layout).toMatchObject({
      type: 'visual',
      filePath: '/elements/_template_element.js',
      x: expectedPosition.x,
      y: expectedPosition.y
    });
  } finally {
    if (createdElement?.id) await request.delete(`/api/workspace/elements/${createdElement.id}`);
  }
});

test('Arrow keys do not pan the workspace camera', async ({ page }) => {
  await joinWorkspace(page, 'controller');

  const before = await page.evaluate(() => ({
    x: Math.round(window.__jamCamera?.x ?? 0),
    y: Math.round(window.__jamCamera?.y ?? 0),
    zoom: Number((window.__jamCamera?.zoom ?? 1).toFixed(2))
  }));
  await page.locator('#canvas-viewport').click({ position: { x: 16, y: 16 } });
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('w');
  await page.keyboard.press('a');
  await page.keyboard.press('s');
  await page.keyboard.press('d');
  await page.waitForTimeout(100);
  const after = await page.evaluate(() => ({
    x: Math.round(window.__jamCamera?.x ?? 0),
    y: Math.round(window.__jamCamera?.y ?? 0),
    zoom: Number((window.__jamCamera?.zoom ?? 1).toFixed(2))
  }));

  expect(after).toEqual(before);
});

test('Caps Lock controls focus mode and Tab remains available to editors', async ({ page }) => {
  await joinWorkspace(page, 'controller');

  const focusOverlay = page.locator('#focus-overlay');
  await expect(focusOverlay).toHaveClass(/hidden/);

  await page.keyboard.press('Tab');
  await expect(focusOverlay).toHaveClass(/hidden/);

  await page.keyboard.down('CapsLock');
  await expect(focusOverlay).not.toHaveClass(/hidden/);
  await page.keyboard.up('CapsLock');
  await expect(focusOverlay).toHaveClass(/hidden/);
});

test('Ctrl+Backspace deletes only the selected element when terminal is not focused', async ({ page, request }) => {
  const id = `elem_delete_${Date.now()}`;
  const publicPath = `/elements/${id}_visual.js`;
  await fs.writeFile(path.join(elementsDir, `${id}_visual.js`), `export default function setup(ctx) {
  ctx.domRoot.innerHTML = '<div style="padding:12px;color:white">delete shortcut target</div>';
  return { destroy() {} };
}
`, 'utf8');

  const addResponse = await request.post('/api/workspace/elements', {
    data: {
      id,
      filePath: publicPath,
      type: 'visual',
      prompt: 'delete shortcut test',
      authored: 'hand',
      x: 40,
      y: 40,
      width: 220,
      height: 120
    }
  });
  await expect(addResponse).toBeOK();

  try {
    await joinWorkspace(page, 'controller', expectedElementCount + 1);

    await page.locator(`#wrapper-${id}`).click({ position: { x: 10, y: 10 } });
    await expect(page.locator(`#wrapper-${id}`)).toHaveClass(/active-focus/);

    await page.locator('.xterm-helper-textarea').focus();
    await page.keyboard.press('Backspace');
    await expect(page.locator(`#wrapper-${id}`)).toHaveCount(1);

    await page.locator('#canvas-viewport').click({ position: { x: 12, y: 12 } });
    await page.locator(`#wrapper-${id}`).click({ position: { x: 10, y: 10 } });
    await page.keyboard.press('Backspace');
    await expect(page.locator(`#wrapper-${id}`)).toHaveCount(1);
    await page.keyboard.press('Delete');
    await expect(page.locator(`#wrapper-${id}`)).toHaveCount(1);
    await page.keyboard.press('Control+Backspace');

    await expect
      .poll(() => page.evaluate((elementId) => window.elementsMap?.has(elementId) ?? true, id), {
        message: 'selected element should be removed by Ctrl+Backspace',
        timeout: 3_000
      })
      .toBe(false);
    await expect(page.locator(`#wrapper-${id}`)).toHaveCount(0);
  } finally {
    await request.delete(`/api/workspace/elements/${id}`);
  }
});

test('Strudel launcher creates a clocked jam element instead of a floating REPL', async ({ page, request }) => {
  const browserFailures = collectBrowserFailures(page);
  await joinWorkspace(page, 'host');

  await expect(page.locator('#strudel-window')).toHaveCount(0);
  await expect(page.locator('strudel-repl')).toHaveCount(0);

  const beforeIds = await page.evaluate(() => [...window.elementsMap.keys()]);
  await addElementFromMenu(page, 'strudel', { x: 460, y: 260 });

  await expect
    .poll(() => page.evaluate((knownIds) => {
      for (const [id, layout] of window.elementsMap.entries()) {
        if (!knownIds.includes(id) && layout.type === 'strudel' && layout.filePath === '/elements/strudel_clocked_element.js') {
          return id;
        }
      }
      return '';
    }, beforeIds), {
      message: 'strudel launcher should create a normal workspace element',
      timeout: 5_000
    })
    .not.toBe('');

  const created = await page.evaluate((knownIds) => {
    for (const [id, layout] of window.elementsMap.entries()) {
      if (!knownIds.includes(id) && layout.type === 'strudel' && layout.filePath === '/elements/strudel_clocked_element.js') {
        return { id, layout };
      }
    }
    return null;
  }, beforeIds);

  try {
    expect(created?.id).toBeTruthy();
    await expect(page.locator('.canvas-element-wrapper')).toHaveCount(expectedElementCount + 1);
    const editorChrome = await page.evaluate((id) => {
      const element = window.activeElements.get(id);
      const root = element?.domWrapper.querySelector('.element-shadow-container')?.shadowRoot;
      return {
        hasEditor: Boolean(root?.querySelector('#editor')),
        hasRunButton: Boolean(root?.querySelector('#run')),
        hasGain: Boolean(root?.querySelector('#gain')),
        hasStatus: Boolean(root?.querySelector('#status')),
        hasLineGutter: Boolean(root?.querySelector('.cm-gutters'))
      };
    }, created.id);
    expect(editorChrome).toEqual({
      hasEditor: true,
      hasRunButton: false,
      hasGain: false,
      hasStatus: false,
      hasLineGutter: false
    });

    const inputCursorStyles = await page.evaluate((id) => {
      const element = window.activeElements.get(id);
      const root = element?.domWrapper.querySelector('.element-shadow-container')?.shadowRoot;
      return {
        terminalFocusZone: getComputedStyle(document.querySelector('#agent-terminal-focus-zone')).cursor,
        strudelWrapper: getComputedStyle(element.domWrapper).cursor,
        strudelEditor: getComputedStyle(root.querySelector('#editor')).cursor,
        strudelCodeMirror: getComputedStyle(root.querySelector('.cm-editor')).cursor
      };
    }, created.id);
    expect(inputCursorStyles).toEqual({
      terminalFocusZone: 'text',
      strudelWrapper: 'text',
      strudelEditor: 'text',
      strudelCodeMirror: 'text'
    });

    const inactiveEditorStyle = await page.evaluate((id) => {
      const element = window.activeElements.get(id);
      const root = element?.domWrapper.querySelector('.element-shadow-container')?.shadowRoot;
      const view = root?.querySelector('#editor')?.cmView;
      if (!element || !root || !view) throw new Error('missing Strudel editor');
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: 'note("c3").s("sawtooth")' },
        selection: { anchor: 0, head: 0 }
      });
      element.domWrapper.classList.add('active-focus');
      view.contentDOM.blur();
      const cursor = root.querySelector('.cm-cursor');
      const cursorStyle = getComputedStyle(cursor);
      return {
        wrapperOutlineDisplay: getComputedStyle(element.domWrapper, '::after').display,
        editorOutline: getComputedStyle(root.querySelector('.cm-editor')).outlineStyle,
        activeLineBackground: getComputedStyle(root.querySelector('.cm-activeLine')).backgroundColor,
        cursorDisplay: cursorStyle.display,
        cursorBorderWidth: cursorStyle.borderLeftWidth,
        cursorBorderColor: cursorStyle.borderLeftColor,
        cursorBackground: cursorStyle.backgroundColor,
        cursorBackdropFilter: cursorStyle.backdropFilter || cursorStyle.webkitBackdropFilter,
        cursorAnimationName: cursorStyle.animationName
      };
    }, created.id);
    expect(inactiveEditorStyle.wrapperOutlineDisplay).toBe('none');
    expect(inactiveEditorStyle.editorOutline).toBe('none');
    expect(inactiveEditorStyle.activeLineBackground).toBe('rgba(0, 0, 0, 0)');
    expect(inactiveEditorStyle.cursorDisplay).toBe('block');
    expect(inactiveEditorStyle.cursorBorderWidth).toBe('1px');
    expect(inactiveEditorStyle.cursorBorderColor).toBe('rgb(103, 232, 249)');
    expect(inactiveEditorStyle.cursorBackground).toBe('rgba(0, 0, 0, 0)');
    expect(inactiveEditorStyle.cursorBackdropFilter).toBe('none');
    expect(inactiveEditorStyle.cursorAnimationName).toBe('none');

    await page.evaluate((id) => {
      const root = window.activeElements
        .get(id)
        ?.domWrapper.querySelector('.element-shadow-container')
        ?.shadowRoot;
      const view = root?.querySelector('#editor')?.cmView;
      if (!view) throw new Error('missing Strudel editor');
      view.focus();
    }, created.id);

    await expect
      .poll(() => page.evaluate((id) => {
        const root = window.activeElements
          .get(id)
          ?.domWrapper.querySelector('.element-shadow-container')
          ?.shadowRoot;
        const editor = root?.querySelector('.cm-editor');
        const activeLine = root?.querySelector('.cm-activeLine');
        const cursor = root?.querySelector('.cm-cursor');
        const overlay = document.querySelector(`[data-strudel-cursor-overlay="${id}"]`);
        const activeLineHandle = document.querySelector(`[data-strudel-active-line-handle="${id}"]`);
        const line = root?.querySelector('.cm-line');
        const token = root?.querySelector('.cm-line span');
        const tokenColors = [...(root?.querySelectorAll('.cm-line span') || [])]
          .map(node => getComputedStyle(node).color)
          .filter(Boolean);
        const cursorStyle = cursor ? getComputedStyle(cursor) : null;
        const overlayStyle = overlay ? getComputedStyle(overlay) : null;
        const activeLineStyle = activeLine ? getComputedStyle(activeLine) : null;
        const activeLineHandleStyle = activeLineHandle ? getComputedStyle(activeLineHandle) : null;
        const cursorRect = cursor?.getBoundingClientRect();
        const overlayRect = overlay?.getBoundingClientRect();
        const activeLineRect = activeLine?.getBoundingClientRect();
        const activeLineHandleRect = activeLineHandle?.getBoundingClientRect();
        const textNode = root ? findTextNode(root.querySelector('.cm-line')) : null;
        let charWidth = 0;
        let textLeftOffset = 0;
        if (textNode) {
          const range = document.createRange();
          range.setStart(textNode, 0);
          range.setEnd(textNode, Math.min(1, textNode.textContent.length));
          const textRect = range.getBoundingClientRect();
          charWidth = textRect.width;
          textLeftOffset = activeLineRect ? textRect.left - activeLineRect.left : 0;
          range.detach?.();
        }
        return {
          isFocused: editor?.classList.contains('cm-focused') || false,
          editorOutline: editor ? getComputedStyle(editor).outlineStyle : '',
          activeLineBackground: activeLine ? getComputedStyle(activeLine).backgroundColor : '',
          activeLinePosition: activeLineStyle?.position || '',
          activeLineMarkerText: activeLineHandle?.textContent || '',
          activeLineMarkerPosition: activeLineHandleStyle?.position || '',
          activeLineMarkerDisplay: activeLineHandleStyle?.display || '',
          activeLineMarkerColor: activeLineHandleStyle?.color || '',
          activeLineMarkerCursor: activeLineHandleStyle?.cursor || '',
          activeLineMarkerLeftOffset: activeLineRect && activeLineHandleRect ? activeLineHandleRect.left - activeLineRect.left : 0,
          textLeftOffset,
          editorColor: editor ? getComputedStyle(editor).color : '',
          lineColor: line ? getComputedStyle(line).color : '',
          tokenColor: token ? getComputedStyle(token).color : '',
          hasSyntaxHighlighting: new Set(tokenColors).size > 1,
          usesTerminalSyntaxPalette: tokenColors.includes('rgb(103, 232, 249)') &&
            tokenColors.includes('rgb(167, 243, 208)'),
          usesDefaultStrudelPalette: tokenColors.includes('rgb(199, 146, 234)') ||
            tokenColors.includes('rgb(195, 232, 141)'),
          lineTextShadow: line ? getComputedStyle(line).textShadow : '',
          cursorWidth: cursorRect?.width || 0,
          cursorHeight: cursorRect?.height || 0,
          charWidth,
          cursorDisplay: cursorStyle?.display || '',
          cursorBorderLeftWidth: cursorStyle?.borderLeftWidth || '',
          cursorBackground: cursorStyle?.backgroundColor || '',
          cursorBlendMode: cursorStyle?.mixBlendMode || '',
          cursorBackdropFilter: cursorStyle?.backdropFilter || cursorStyle?.webkitBackdropFilter || '',
          cursorAnimationName: cursorStyle?.animationName || '',
          overlayDisplay: overlayStyle?.display || '',
          overlayBackground: overlayStyle?.backgroundColor || '',
          overlayBlendMode: overlayStyle?.mixBlendMode || '',
          overlayAnimationName: overlayStyle?.animationName || '',
          overlayWidth: overlayRect?.width || 0,
          overlayHeight: overlayRect?.height || 0
        };

        function findTextNode(node) {
          if (!node) return null;
          if (node.nodeType === Node.TEXT_NODE && node.textContent.length) return node;
          for (const child of node.childNodes) {
            const found = findTextNode(child);
            if (found) return found;
          }
          return null;
        }
      }, created.id), {
        message: 'focused Strudel editor should show only active-line and block-cursor cues',
        timeout: 3_000
      })
      .toMatchObject({
        isFocused: true,
        editorOutline: 'none',
        activeLineBackground: 'rgba(22, 78, 99, 0.5)',
        activeLinePosition: 'relative',
        activeLineMarkerText: '❯',
        activeLineMarkerPosition: 'fixed',
        activeLineMarkerDisplay: 'block',
        activeLineMarkerColor: 'rgb(103, 232, 249)',
        activeLineMarkerCursor: 'move',
        editorColor: 'rgb(209, 250, 229)',
        lineColor: 'rgb(209, 250, 229)',
        hasSyntaxHighlighting: true,
        usesTerminalSyntaxPalette: true,
        usesDefaultStrudelPalette: false,
        lineTextShadow: 'none',
        cursorDisplay: 'block',
        cursorBorderLeftWidth: '0px',
        cursorBackground: 'rgba(0, 0, 0, 0)',
        cursorBlendMode: 'normal',
        cursorBackdropFilter: 'none',
        cursorAnimationName: 'none',
        overlayBackground: 'rgb(255, 255, 255)',
        overlayBlendMode: 'difference',
        overlayAnimationName: 'jam-strudel-cursor-bar-blink'
      });

    const activeLineMarkerMetrics = await page.evaluate((id) => {
      const root = window.activeElements
        .get(id)
        ?.domWrapper.querySelector('.element-shadow-container')
        ?.shadowRoot;
      const activeLine = root?.querySelector('.cm-activeLine');
      const marker = document.querySelector(`[data-strudel-active-line-handle="${id}"]`);
      const textNode = findTextNode(activeLine);
      const lineRect = activeLine?.getBoundingClientRect();
      const markerRect = marker?.getBoundingClientRect();
      let textLeftOffset = 0;
      if (textNode && lineRect) {
        const range = document.createRange();
        range.setStart(textNode, 0);
        range.setEnd(textNode, Math.min(1, textNode.textContent.length));
        textLeftOffset = range.getBoundingClientRect().left - lineRect.left;
        range.detach?.();
      }
      return {
        markerLeftOffset: lineRect && markerRect ? markerRect.left - lineRect.left : 0,
        textLeftOffset
      };

      function findTextNode(node) {
        if (!node) return null;
        if (node.nodeType === Node.TEXT_NODE && node.textContent.length) return node;
        for (const child of node.childNodes) {
          const found = findTextNode(child);
          if (found) return found;
        }
        return null;
      }
    }, created.id);
    expect(activeLineMarkerMetrics.markerLeftOffset).toBeLessThan(0);
    expect(Math.abs(activeLineMarkerMetrics.textLeftOffset)).toBeLessThan(1);

    const markerDragStart = await page.evaluate((id) => {
      const element = window.activeElements.get(id);
      const root = element?.domWrapper.querySelector('.element-shadow-container')?.shadowRoot;
      const marker = document.querySelector(`[data-strudel-active-line-handle="${id}"]`);
      const rect = marker?.getBoundingClientRect();
      const layout = window.elementsMap.get(id);
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        layoutX: layout?.x || 0,
        layoutY: layout?.y || 0,
        code: root?.querySelector('#editor')?.cmView?.state.doc.toString() || ''
      };
    }, created.id);

    await page.mouse.move(markerDragStart.x, markerDragStart.y);
    await expect
      .poll(() => page.evaluate((id) => {
        return document.querySelector(`[data-strudel-active-line-handle="${id}"]`)?.textContent || '';
      }, created.id), {
        message: 'active-line marker should switch to move glyph on hover',
        timeout: 1_000
      })
      .toBe('✥');

    await page.mouse.down();
    await page.mouse.move(markerDragStart.x + 88, markerDragStart.y + 42, { steps: 8 });
    await page.mouse.up();

    const markerDragEnd = await page.evaluate((id) => {
      const root = window.activeElements
        .get(id)
        ?.domWrapper.querySelector('.element-shadow-container')
        ?.shadowRoot;
      const layout = window.elementsMap.get(id);
      return {
        layoutX: layout?.x || 0,
        layoutY: layout?.y || 0,
        code: root?.querySelector('#editor')?.cmView?.state.doc.toString() || ''
      };
    }, created.id);
    expect(markerDragEnd.layoutX).toBeGreaterThan(markerDragStart.layoutX + 40);
    expect(markerDragEnd.layoutY).toBeGreaterThan(markerDragStart.layoutY + 15);
    expect(markerDragEnd.code).toBe(markerDragStart.code);

    await page.mouse.move(markerDragStart.x + 220, markerDragStart.y + 140, { steps: 6 });
    await page.waitForTimeout(100);
    const markerDragAfterRelease = await page.evaluate((id) => {
      const layout = window.elementsMap.get(id);
      return {
        layoutX: layout?.x || 0,
        layoutY: layout?.y || 0
      };
    }, created.id);
    expect(markerDragAfterRelease.layoutX).toBe(markerDragEnd.layoutX);
    expect(markerDragAfterRelease.layoutY).toBe(markerDragEnd.layoutY);

    const focusedCursorSize = await page.evaluate((id) => {
      const root = window.activeElements
        .get(id)
        ?.domWrapper.querySelector('.element-shadow-container')
        ?.shadowRoot;
      const cursor = root?.querySelector('.cm-cursor');
      const textNode = findTextNode(root?.querySelector('.cm-line'));
      const cursorRect = cursor?.getBoundingClientRect();
      const overlayRect = document
        .querySelector(`[data-strudel-cursor-overlay="${id}"]`)
        ?.getBoundingClientRect();
      const range = document.createRange();
      range.setStart(textNode, 0);
      range.setEnd(textNode, Math.min(1, textNode.textContent.length));
      const charRect = range.getBoundingClientRect();
      range.detach?.();
      return {
        width: cursorRect?.width || 0,
        height: Math.max(cursorRect?.height || 0, overlayRect?.height || 0),
        charWidth: charRect.width
      };

      function findTextNode(node) {
        if (!node) return null;
        if (node.nodeType === Node.TEXT_NODE && node.textContent.length) return node;
        for (const child of node.childNodes) {
          const found = findTextNode(child);
          if (found) return found;
        }
        return null;
      }
    }, created.id);
    expect(focusedCursorSize.width).toBeCloseTo(focusedCursorSize.charWidth, 0);
    expect(focusedCursorSize.height).toBeGreaterThan(8);

    await expect
      .poll(() => page.evaluate((id) => {
        const element = window.activeElements.get(id);
        const root = element?.domWrapper.querySelector('.element-shadow-container')?.shadowRoot;
        const view = root?.querySelector('#editor')?.cmView;
        if (!view) throw new Error('missing Strudel editor');
        view.dispatch({ selection: { anchor: 0, head: 4 } });
        view.focus();

        const editor = root.querySelector('.cm-editor');
        const nativeSelection = root.querySelector('.cm-selectionBackground');
        const selectionOverlay = document.querySelector(`[data-strudel-selection-overlay="${id}"]`);
        const selectionRect = selectionOverlay?.querySelector('.jam-strudel-document-selection-rect');
        const cursorOverlay = document.querySelector(`[data-strudel-cursor-overlay="${id}"]`);
        const nativeSelectionStyle = nativeSelection ? getComputedStyle(nativeSelection) : null;
        const selectionOverlayStyle = selectionOverlay ? getComputedStyle(selectionOverlay) : null;
        const selectionRectStyle = selectionRect ? getComputedStyle(selectionRect) : null;
        const selectionRectBox = selectionRect?.getBoundingClientRect();
        const cursorOverlayStyle = cursorOverlay ? getComputedStyle(cursorOverlay) : null;
        return {
          isFocused: editor.classList.contains('cm-focused'),
          nativeSelectionBackground: nativeSelectionStyle?.backgroundColor || '',
          cursorOverlayDisplay: cursorOverlayStyle?.display || '',
          selectionOverlayDisplay: selectionOverlayStyle?.display || '',
          selectionRectCount: selectionOverlay?.children.length || 0,
          selectionRectBackground: selectionRectStyle?.backgroundColor || '',
          selectionRectBlendMode: selectionRectStyle?.mixBlendMode || '',
          selectionRectWidth: selectionRectBox?.width || 0,
          selectionRectHeight: selectionRectBox?.height || 0
        };
      }, created.id), {
        message: 'Strudel text selection should render as a document-level inversion overlay',
        timeout: 3_000
      })
      .toMatchObject({
        isFocused: true,
        nativeSelectionBackground: 'rgba(0, 0, 0, 0)',
        cursorOverlayDisplay: 'none',
        selectionOverlayDisplay: 'block',
        selectionRectCount: 1,
        selectionRectBackground: 'rgb(255, 255, 255)',
        selectionRectBlendMode: 'difference'
      });

    const selectionOverlaySize = await page.evaluate((id) => {
      const selectionRect = document
        .querySelector(`[data-strudel-selection-overlay="${id}"]`)
        ?.querySelector('.jam-strudel-document-selection-rect')
        ?.getBoundingClientRect();
      return {
        width: selectionRect?.width || 0,
        height: selectionRect?.height || 0
      };
    }, created.id);
    expect(selectionOverlaySize.width).toBeGreaterThan(focusedCursorSize.charWidth * 2);
    expect(selectionOverlaySize.height).toBeGreaterThan(8);

    await expect
      .poll(() => page.evaluate((id) => {
        const element = window.activeElements.get(id);
        const layout = window.elementsMap.get(id);
        const root = element?.domWrapper.querySelector('.element-shadow-container')?.shadowRoot;
        const editor = root?.querySelector('#editor');
        const scroller = root?.querySelector('.cm-scroller');
        return {
          wrapperOverflow: getComputedStyle(element.domWrapper).overflow,
          editorOverflow: editor ? getComputedStyle(editor).overflow : '',
          scrollerOverflow: scroller ? getComputedStyle(scroller).overflow : '',
          width: layout?.width || 0,
          height: layout?.height || 0
        };
      }, created.id), {
        message: 'Strudel editor should float without scroll containers',
        timeout: 5_000
      })
      .toMatchObject({
        wrapperOverflow: 'visible',
        editorOverflow: 'visible',
        scrollerOverflow: 'visible'
      });

    expect(created.layout.prompt).toBe('');
    const hasEvalButton = await page.evaluate((id) => {
      const element = window.activeElements.get(id);
      return Boolean(element?.domWrapper.querySelector('.element-shadow-container')?.shadowRoot?.querySelector('#eval'));
    }, created.id);
    expect(hasEvalButton).toBe(false);

    await page.evaluate((id) => {
      const element = window.activeElements.get(id);
      const root = element?.domWrapper.querySelector('.element-shadow-container')?.shadowRoot;
      const code = root?.querySelector('#code');
      if (!code) throw new Error('missing Strudel code editor');
      code.value = 'note("<c3 e3 g3>").s("sawtooth").gain(0.2).jux(rev)\n// this deliberately long line keeps the floating editor wide enough to prove it grows with code content';
      code.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    }, created.id);

    await expect
      .poll(() => page.evaluate((id) => ({
        source: window.__jamStrudelRuntimeDebug?.sources?.[id] || '',
        draftCode: window.activeElements
          .get(id)
          ?.runtime
          ?.getState?.()
          ?.draftCode || ''
      }), created.id), {
        message: 'typing should update the draft without auto-evaluating Strudel',
        timeout: 3_000
      })
      .toMatchObject({ draftCode: 'note("<c3 e3 g3>").s("sawtooth").gain(0.2).jux(rev)\n// this deliberately long line keeps the floating editor wide enough to prove it grows with code content' });

    await expect
      .poll(() => page.evaluate((id) => {
        const layout = window.elementsMap.get(id);
        const root = window.activeElements
          .get(id)
          ?.domWrapper.querySelector('.element-shadow-container')
          ?.shadowRoot;
        const editor = root?.querySelector('#editor');
        if (!layout || !editor) return false;
        return layout.width > 360 &&
          layout.height > 20 &&
          layout.width >= editor.scrollWidth &&
          layout.height >= editor.scrollHeight;
      }, created.id), {
        message: 'Strudel layout should grow to fit code content',
        timeout: 5_000
      })
      .toBe(true);

    const sourceBeforeEval = await page.evaluate((id) => window.__jamStrudelRuntimeDebug?.sources?.[id] || '', created.id);
    expect(sourceBeforeEval).not.toContain('<c3 e3 g3>');

    await page.evaluate((id) => {
      const code = window.activeElements
        .get(id)
        ?.domWrapper.querySelector('.element-shadow-container')
        ?.shadowRoot
        ?.querySelector('#code');
      code.value = 'note("<c3 e3 g3>").s("sawtooth").gain(0.2).jux(rev)';
      code.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    }, created.id);

    await page.evaluate((id) => {
      const element = window.activeElements.get(id);
      const code = element?.domWrapper
        .querySelector('.element-shadow-container')
        ?.shadowRoot
        ?.querySelector('#code');
      code?.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        ctrlKey: true,
        bubbles: true,
        composed: true,
        cancelable: true
      }));
    }, created.id);

    await expect
      .poll(() => page.evaluate((id) => ({
        active: window.__jamStrudelRuntimeDebug?.activeElementIds?.includes(id) || false,
        lastError: window.__jamStrudelRuntimeDebug?.lastError || '',
        source: window.__jamStrudelRuntimeDebug?.sources?.[id] || ''
      }), created.id), {
        message: 'official Strudel syntax should evaluate into the shared runtime',
        timeout: 8_000
      })
      .toMatchObject({ active: true, lastError: '', source: 'note("<c3 e3 g3>").s("sawtooth").gain(0.2).jux(rev)' });

    await page.evaluate((id) => {
      const code = window.activeElements
        .get(id)
        ?.domWrapper.querySelector('.element-shadow-container')
        ?.shadowRoot
        ?.querySelector('#code');
      code.value = 'note("c3").s("sawtooth")\n\nnote("e3").s("sawtooth")';
      code.selectionStart = code.value.indexOf('note("e3")') + 2;
      code.selectionEnd = code.selectionStart;
      code.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      code.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        ctrlKey: true,
        bubbles: true,
        composed: true,
        cancelable: true
      }));
    }, created.id);

    await expect
      .poll(() => page.evaluate((id) => window.__jamStrudelRuntimeDebug?.sources?.[id] || '', created.id), {
        message: 'Ctrl+Enter should evaluate the current block',
        timeout: 8_000
      })
      .toBe('note("e3").s("sawtooth")');

    await page.evaluate((id) => {
      const code = window.activeElements
        .get(id)
        ?.domWrapper.querySelector('.element-shadow-container')
        ?.shadowRoot
        ?.querySelector('#code');
      code.value = 'note("c3").s("sawtooth")\nnote("g3").s("sawtooth")';
      code.selectionStart = code.value.indexOf('note("g3")') + 2;
      code.selectionEnd = code.selectionStart;
      code.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      code.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        shiftKey: true,
        bubbles: true,
        composed: true,
        cancelable: true
      }));
    }, created.id);

    await expect
      .poll(() => page.evaluate((id) => window.__jamStrudelRuntimeDebug?.sources?.[id] || '', created.id), {
        message: 'Shift+Enter should evaluate the current line',
        timeout: 8_000
      })
      .toBe('note("g3").s("sawtooth")');

    await page.evaluate((id) => {
      const code = window.activeElements
        .get(id)
        ?.domWrapper.querySelector('.element-shadow-container')
        ?.shadowRoot
        ?.querySelector('#code');
      code.value = 'note("a3").s("sawtooth").gain(0.1)';
      code.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      code.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        altKey: true,
        bubbles: true,
        composed: true,
        cancelable: true
      }));
    }, created.id);

    await expect
      .poll(() => page.evaluate((id) => window.__jamStrudelRuntimeDebug?.sources?.[id] || '', created.id), {
        message: 'Alt+Enter should evaluate the whole editor',
        timeout: 8_000
      })
      .toBe('note("a3").s("sawtooth").gain(0.1)');

    await page.evaluate((id) => {
      const code = window.activeElements
        .get(id)
        ?.domWrapper.querySelector('.element-shadow-container')
        ?.shadowRoot
        ?.querySelector('#code');
      code.dispatchEvent(new KeyboardEvent('keydown', {
        key: '.',
        code: 'Period',
        ctrlKey: true,
        bubbles: true,
        composed: true,
        cancelable: true
      }));
    }, created.id);

    await expect
      .poll(() => page.evaluate((id) => ({
        active: window.__jamStrudelRuntimeDebug?.activeElementIds?.includes(id) || false,
        running: window.activeElements
          .get(id)
          ?.runtime
          ?.getState?.()
          ?.running ?? true
      }), created.id), {
        message: 'Modifier+period should silence the Strudel element',
        timeout: 8_000
      })
      .toMatchObject({ active: false, running: false });
    expect(browserFailures).toEqual([]);
  } finally {
    if (created?.id) await request.delete(`/api/workspace/elements/${created.id}`);
  }
});

test('Visible Strudel editor keybindings evaluate real keyboard input', async ({ page, request }) => {
  const browserFailures = collectBrowserFailures(page);
  await joinWorkspace(page, 'host');
  const beforeIds = await page.evaluate(() => [...window.elementsMap.keys()]);

  await addElementFromMenu(page, 'strudel', { x: 460, y: 260 });

  await expect
    .poll(() => page.evaluate((knownIds) => {
      for (const [id, layout] of window.elementsMap.entries()) {
        if (!knownIds.includes(id) && layout.type === 'strudel' && layout.filePath === '/elements/strudel_clocked_element.js') {
          return id;
        }
      }
      return '';
    }, beforeIds), {
      message: 'Strudel element should be added',
      timeout: 8_000
    })
    .not.toBe('');

  const id = await page.evaluate((knownIds) => {
    for (const [elementId, layout] of window.elementsMap.entries()) {
      if (!knownIds.includes(elementId) && layout.type === 'strudel') return elementId;
    }
    return '';
  }, beforeIds);

  try {
    await expect
      .poll(() => page.evaluate((elementId) => window.activeElements.has(elementId), id), {
        message: 'Strudel element should hydrate',
        timeout: 8_000
      })
      .toBe(true);

    const setVisibleEditorCode = async (source, cursorNeedle = '') => {
      await page.evaluate(({ elementId, source, cursorNeedle }) => {
        const view = window.activeElements
          .get(elementId)
          ?.domWrapper.querySelector('.element-shadow-container')
          ?.shadowRoot
          ?.querySelector('#editor')
          ?.cmView;
        if (!view) throw new Error('missing CodeMirror view');
        const cursor = cursorNeedle ? source.indexOf(cursorNeedle) + 2 : source.length;
        view.dispatch({
          changes: { from: 0, to: view.state.doc.length, insert: source },
          selection: { anchor: cursor, head: cursor }
        });
        view.focus();
      }, { elementId: id, source, cursorNeedle });
    };

    await setVisibleEditorCode('note("a3").s("sawtooth").gain(0.1)');
    await page.keyboard.press('Alt+Enter');
    await expect
      .poll(() => page.evaluate((elementId) => window.__jamStrudelRuntimeDebug?.sources?.[elementId] || '', id), {
        message: 'Alt+Enter should evaluate the whole visible editor',
        timeout: 8_000
      })
      .toBe('note("a3").s("sawtooth").gain(0.1)');

    await setVisibleEditorCode('note("c3").s("sawtooth")\n\nnote("e3").s("sawtooth")', 'note("e3")');
    await page.keyboard.press('Control+Enter');
    await expect
      .poll(() => page.evaluate((elementId) => window.__jamStrudelRuntimeDebug?.sources?.[elementId] || '', id), {
        message: 'Ctrl+Enter should evaluate the current visible-editor block',
        timeout: 8_000
      })
      .toBe('note("e3").s("sawtooth")');

    await setVisibleEditorCode('note("c3").s("sawtooth")\nnote("g3").s("sawtooth")', 'note("g3")');
    await page.keyboard.press('Shift+Enter');
    await expect
      .poll(() => page.evaluate((elementId) => window.__jamStrudelRuntimeDebug?.sources?.[elementId] || '', id), {
        message: 'Shift+Enter should evaluate the current visible-editor line',
        timeout: 8_000
      })
      .toBe('note("g3").s("sawtooth")');

    expect(browserFailures).toEqual([]);
  } finally {
    if (id) await request.delete(`/api/workspace/elements/${id}`);
  }
});

test('Strudel editors share live code and remote selections across clients', async ({ browser, request }) => {
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const observerContext = await browser.newContext();
  const hostPage = await hostContext.newPage();
  const guestPage = await guestContext.newPage();
  const observerPage = await observerContext.newPage();
  const hostFailures = collectBrowserFailures(hostPage);
  const guestFailures = collectBrowserFailures(guestPage);
  const observerFailures = collectBrowserFailures(observerPage);
  let createdId = '';

  try {
    await joinWorkspace(hostPage, 'host');
    await joinWorkspace(guestPage, 'controller');
    await joinWorkspace(observerPage, 'observer');
    const beforeIds = await hostPage.evaluate(() => [...window.elementsMap.keys()]);

    await addElementFromMenu(hostPage, 'strudel', { x: 460, y: 260 });

    await expect
      .poll(() => hostPage.evaluate((knownIds) => {
        for (const [elementId, layout] of window.elementsMap.entries()) {
          if (!knownIds.includes(elementId) && layout.type === 'strudel') return elementId;
        }
        return '';
      }, beforeIds), {
        message: 'Strudel element should be added by the host',
        timeout: 8_000
      })
      .not.toBe('');

    createdId = await hostPage.evaluate((knownIds) => {
      for (const [elementId, layout] of window.elementsMap.entries()) {
        if (!knownIds.includes(elementId) && layout.type === 'strudel') return elementId;
      }
      return '';
    }, beforeIds);

    await expect
      .poll(() => guestPage.evaluate((elementId) => window.activeElements.has(elementId), createdId), {
        message: 'guest should hydrate the same Strudel element',
        timeout: 8_000
      })
      .toBe(true);
    await expect
      .poll(() => observerPage.evaluate((elementId) => window.activeElements.has(elementId), createdId), {
        message: 'observer should hydrate the same Strudel element',
        timeout: 8_000
      })
      .toBe(true);

    const source = 'note("c3 e3 g3").s("piano")';
    await hostPage.evaluate(({ elementId, source }) => {
      const view = window.activeElements
        .get(elementId)
        ?.domWrapper.querySelector('.element-shadow-container')
        ?.shadowRoot
        ?.querySelector('#editor')
        ?.cmView;
      if (!view) throw new Error('missing host editor');
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: source },
        selection: { anchor: 0, head: 4 }
      });
      view.focus();
    }, { elementId: createdId, source });

    await expect
      .poll(() => guestPage.evaluate((elementId) => {
        const view = window.activeElements
          .get(elementId)
          ?.domWrapper.querySelector('.element-shadow-container')
          ?.shadowRoot
          ?.querySelector('#editor')
          ?.cmView;
        return view?.state.doc.toString() || '';
      }, createdId), {
        message: 'guest editor should receive live Y.Text changes',
        timeout: 8_000
      })
      .toBe(source);

    await expect
      .poll(() => guestPage.evaluate((elementId) => {
        const root = window.activeElements
          .get(elementId)
          ?.domWrapper.querySelector('.element-shadow-container')
          ?.shadowRoot;
        const remoteSelection = root?.querySelector('.cm-ySelection');
        const remoteCaret = root?.querySelector('.cm-ySelectionCaret');
        const remoteCursorOverlay = document.querySelector(`[data-strudel-remote-cursor-overlay="${elementId}"]`);
        const remoteSelectionOverlay = document.querySelector(`[data-strudel-remote-selection-overlay="${elementId}"]`);
        const remoteCursor = remoteCursorOverlay?.querySelector('.jam-strudel-remote-cursor-rect');
        const remoteSelectionRect = remoteSelectionOverlay?.querySelector('.jam-strudel-remote-selection-rect');
        const selectionStyle = remoteSelection ? getComputedStyle(remoteSelection) : null;
        const caretStyle = remoteCaret ? getComputedStyle(remoteCaret) : null;
        const remoteCursorOverlayStyle = remoteCursorOverlay ? getComputedStyle(remoteCursorOverlay) : null;
        const remoteSelectionOverlayStyle = remoteSelectionOverlay ? getComputedStyle(remoteSelectionOverlay) : null;
        const remoteCursorStyle = remoteCursor ? getComputedStyle(remoteCursor) : null;
        const remoteSelectionRectStyle = remoteSelectionRect ? getComputedStyle(remoteSelectionRect) : null;
        const remoteSelectionRectBox = remoteSelectionRect?.getBoundingClientRect();
        return {
          selectionText: remoteSelection?.textContent || '',
          hasCaret: Boolean(remoteCaret),
          hasRemoteCursorOverlay: Boolean(remoteCursorOverlay),
          hasRemoteSelectionOverlay: Boolean(remoteSelectionOverlay),
          selectionBlendMode: selectionStyle?.mixBlendMode || '',
          selectionFilter: selectionStyle?.filter || '',
          selectionBackground: selectionStyle?.backgroundColor || '',
          selectionOutlineStyle: selectionStyle?.outlineStyle || '',
          caretDisplay: caretStyle?.display || '',
          caretBlendMode: caretStyle?.mixBlendMode || '',
          caretFilter: caretStyle?.filter || '',
          caretAnimationName: caretStyle?.animationName || '',
          remoteCursorOverlayDisplay: remoteCursorOverlayStyle?.display || '',
          remoteSelectionOverlayDisplay: remoteSelectionOverlayStyle?.display || '',
          remoteCursorBackground: remoteCursorStyle?.backgroundColor || '',
          remoteCursorBlendMode: remoteCursorStyle?.mixBlendMode || '',
          remoteCursorFilter: remoteCursorStyle?.filter || '',
          remoteCursorAnimationName: remoteCursorStyle?.animationName || '',
          remoteCursorStyleWidth: remoteCursor?.style.width || '',
          remoteCursorStyleHeight: remoteCursor?.style.height || '',
          remoteSelectionRectCount: remoteSelectionOverlay?.children.length || 0,
          remoteSelectionRectBackground: remoteSelectionRectStyle?.backgroundColor || '',
          remoteSelectionRectBlendMode: remoteSelectionRectStyle?.mixBlendMode || '',
          remoteSelectionRectFilter: remoteSelectionRectStyle?.filter || '',
          remoteSelectionRectAnimationName: remoteSelectionRectStyle?.animationName || '',
          remoteSelectionRectWidth: remoteSelectionRectBox?.width || 0,
          userCount: window.jamAwareness?.getStates?.().size || 0
        };
      }, createdId), {
        message: 'guest editor should render host remote selection/caret awareness through overlays',
        timeout: 8_000
      })
      .toMatchObject({
        selectionText: 'note',
        hasCaret: true,
        hasRemoteCursorOverlay: true,
        hasRemoteSelectionOverlay: true,
        selectionBlendMode: 'normal',
        selectionFilter: 'none',
        selectionBackground: 'rgba(0, 0, 0, 0)',
        selectionOutlineStyle: 'none',
        caretDisplay: 'none',
        caretAnimationName: 'none',
        remoteCursorOverlayDisplay: 'block',
        remoteSelectionOverlayDisplay: 'block',
        remoteCursorBackground: 'rgb(94, 234, 212)',
        remoteCursorBlendMode: 'difference',
        remoteCursorFilter: 'none',
        remoteCursorAnimationName: 'jam-strudel-cursor-bar-blink',
        remoteSelectionRectCount: 1,
        remoteSelectionRectBackground: 'rgba(94, 234, 212, 0.45)',
        remoteSelectionRectBlendMode: 'difference',
        remoteSelectionRectFilter: 'none',
        remoteSelectionRectAnimationName: 'none',
        userCount: 3
      });

    await expect
      .poll(() => observerPage.evaluate((elementId) => {
        const view = window.activeElements
          .get(elementId)
          ?.domWrapper.querySelector('.element-shadow-container')
          ?.shadowRoot
          ?.querySelector('#editor')
          ?.cmView;
        return view?.state.doc.toString() || '';
      }, createdId), {
        message: 'observer editor should receive live Y.Text changes',
        timeout: 8_000
      })
      .toBe(source);

    await guestPage.evaluate(({ elementId, source }) => {
      const view = window.activeElements
        .get(elementId)
        ?.domWrapper.querySelector('.element-shadow-container')
        ?.shadowRoot
        ?.querySelector('#editor')
        ?.cmView;
      if (!view) throw new Error('missing guest editor');
      view.dispatch({ selection: { anchor: source.length, head: source.length } });
      view.focus();
    }, { elementId: createdId, source });

    await expect
      .poll(() => observerPage.evaluate((elementId) => {
        const remoteCursorOverlay = document.querySelector(`[data-strudel-remote-cursor-overlay="${elementId}"]`);
        const cursorNodes = [...(remoteCursorOverlay?.querySelectorAll('.jam-strudel-remote-cursor-rect') || [])];
        const visibleCursorNodes = cursorNodes.filter(node => getComputedStyle(node).display !== 'none');
        const displayStates = [...new Set(cursorNodes.map(node => getComputedStyle(node).display))];
        const backgrounds = [...new Set(cursorNodes.map(node => getComputedStyle(node).backgroundColor))];
        const animationNames = [...new Set(cursorNodes.map(node => getComputedStyle(node).animationName))];
        const animationDurations = [...new Set(cursorNodes.map(node => getComputedStyle(node).animationDuration))];
        const animationDelays = [...new Set(cursorNodes.map(node => getComputedStyle(node).animationDelay))];
        return {
          remoteCursorCount: cursorNodes.length,
          visibleRemoteCursorCount: visibleCursorNodes.length,
          displayStateCount: displayStates.length,
          backgrounds,
          animationNames,
          animationDurationCount: animationDurations.length,
          animationDelayCount: animationDelays.length,
          userCount: window.jamAwareness?.getStates?.().size || 0
        };
      }, createdId), {
        message: 'observer should see all remote collaborators cursors blinking together',
        timeout: 8_000
      })
      .toMatchObject({
        remoteCursorCount: 2,
        visibleRemoteCursorCount: 2,
        displayStateCount: 1,
        backgrounds: ['rgb(94, 234, 212)'],
        animationNames: ['jam-strudel-cursor-bar-blink'],
        animationDurationCount: 1,
        animationDelayCount: 1,
        userCount: 3
      });

    const multilineSource = 'note("c3").s("piano")\nnote("e3").s("piano")\nnote("g3").s("piano")';
    await hostPage.evaluate(({ elementId, source }) => {
      const view = window.activeElements
        .get(elementId)
        ?.domWrapper.querySelector('.element-shadow-container')
        ?.shadowRoot
        ?.querySelector('#editor')
        ?.cmView;
      if (!view) throw new Error('missing host editor');
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: source },
        selection: { anchor: 0, head: source.length }
      });
      view.focus();
    }, { elementId: createdId, source: multilineSource });

    await expect
      .poll(() => guestPage.evaluate((elementId) => {
        const root = window.activeElements
          .get(elementId)
          ?.domWrapper.querySelector('.element-shadow-container')
          ?.shadowRoot;
        const lineSelection = root?.querySelector('.cm-yLineSelection');
        const lineSelectionStyle = lineSelection ? getComputedStyle(lineSelection) : null;
        const remoteSelectionOverlay = document.querySelector(`[data-strudel-remote-selection-overlay="${elementId}"]`);
        return {
          hasLineSelection: Boolean(lineSelection),
          lineSelectionMarginLeft: lineSelectionStyle?.marginLeft || '',
          lineSelectionMarginRight: lineSelectionStyle?.marginRight || '',
          lineSelectionPaddingLeft: lineSelectionStyle?.paddingLeft || '',
          lineSelectionPaddingRight: lineSelectionStyle?.paddingRight || '',
          remoteSelectionRectCount: remoteSelectionOverlay?.children.length || 0
        };
      }, createdId), {
        message: 'remote whole-line selections should not indent selected lines',
        timeout: 8_000
      })
      .toMatchObject({
        hasLineSelection: true,
        lineSelectionMarginLeft: '0px',
        lineSelectionMarginRight: '0px',
        lineSelectionPaddingLeft: '0px',
        lineSelectionPaddingRight: '0px'
      });

    expect(hostFailures).toEqual([]);
    expect(guestFailures).toEqual([]);
    expect(observerFailures).toEqual([]);
  } finally {
    if (createdId) {
      await request.delete(`/api/workspace/elements/${createdId}`);
      await Promise.allSettled([
        hostPage.evaluate((elementId) => {
          window.ydoc?.transact(() => {
            window.elementsMap?.delete(elementId);
            window.ydoc.getMap('global_bus')?.delete(`${elementId}:state`);
          });
        }, createdId),
        guestPage.evaluate((elementId) => {
          window.ydoc?.transact(() => {
            window.elementsMap?.delete(elementId);
            window.ydoc.getMap('global_bus')?.delete(`${elementId}:state`);
          });
        }, createdId),
        observerPage.evaluate((elementId) => {
          window.ydoc?.transact(() => {
            window.elementsMap?.delete(elementId);
            window.ydoc.getMap('global_bus')?.delete(`${elementId}:state`);
          });
        }, createdId)
      ]);
      await expect
        .poll(async () => {
          const response = await request.get('/api/workspace/elements');
          const body = await response.json();
          return !body.elements?.some(element => element.id === createdId);
        }, {
          message: 'collaborative test element should be removed from the shared workspace',
          timeout: 8_000
        })
        .toBe(true);
      await Promise.allSettled([
        expect
          .poll(() => hostPage.evaluate((elementId) => !window.activeElements?.has(elementId), createdId), {
            message: 'host should observe collaborative test element cleanup',
            timeout: 4_000
          })
          .toBe(true),
        expect
          .poll(() => guestPage.evaluate((elementId) => !window.activeElements?.has(elementId), createdId), {
            message: 'guest should observe collaborative test element cleanup',
            timeout: 4_000
          })
          .toBe(true),
        expect
          .poll(() => observerPage.evaluate((elementId) => !window.activeElements?.has(elementId), createdId), {
            message: 'observer should observe collaborative test element cleanup',
            timeout: 4_000
          })
          .toBe(true)
      ]);
    }
    await hostContext.close();
    await guestContext.close();
    await observerContext.close();
  }
});

test('Strudel collaborative editor seeds from existing element state', async ({ page, request }) => {
  const browserFailures = collectBrowserFailures(page);
  await joinWorkspace(page, 'host');
  const id = `strudel_legacy_${Date.now()}`;
  const legacyCode = 'note("d3 f3 a3").s("piano").gain(0.2)';

  await page.evaluate(({ id, legacyCode }) => {
    window.ydoc.transact(() => {
      window.ydoc.getMap('global_bus').set(`${id}:state`, {
        code: legacyCode,
        draftCode: legacyCode,
        running: true,
        moodVersion: 'blank-v1'
      });
      window.elementsMap.set(id, {
        id,
        x: 480,
        y: 280,
        width: 260,
        height: 32,
        filePath: '/elements/strudel_clocked_element.js',
        type: 'strudel',
        prompt: '',
        authored: 'hand'
      });
    });
  }, { id, legacyCode });

  try {
    await expect
      .poll(() => page.evaluate((elementId) => {
        const view = window.activeElements
          .get(elementId)
          ?.domWrapper.querySelector('.element-shadow-container')
          ?.shadowRoot
          ?.querySelector('#editor')
          ?.cmView;
        return view?.state.doc.toString() || '';
      }, id), {
        message: 'legacy element state should seed the collaborative Strudel editor',
        timeout: 8_000
      })
      .toBe(legacyCode);

    await expect
      .poll(() => page.evaluate((elementId) => window.ydoc.getText(`strudel:${elementId}:code`).toString(), id), {
        message: 'legacy code should be copied into Y.Text for future collaborators',
        timeout: 3_000
      })
      .toBe(legacyCode);

    expect(browserFailures).toEqual([]);
  } finally {
    await request.delete(`/api/workspace/elements/${id}`);
  }
});

test('Strudel editor highlights code ranges for active pattern haps', async ({ page, request }) => {
  const browserFailures = collectBrowserFailures(page);
  await joinWorkspace(page, 'host');
  const beforeIds = await page.evaluate(() => [...window.elementsMap.keys()]);

  await addElementFromMenu(page, 'strudel', { x: 460, y: 260 });

  await expect
    .poll(() => page.evaluate((knownIds) => {
      for (const [elementId, layout] of window.elementsMap.entries()) {
        if (!knownIds.includes(elementId) && layout.type === 'strudel') return elementId;
      }
      return '';
    }, beforeIds), {
      message: 'Strudel element should be added',
      timeout: 8_000
    })
    .not.toBe('');

  const id = await page.evaluate((knownIds) => {
    for (const [elementId, layout] of window.elementsMap.entries()) {
      if (!knownIds.includes(elementId) && layout.type === 'strudel') return elementId;
    }
    return '';
  }, beforeIds);

  try {
    await expect
      .poll(() => page.evaluate((elementId) => {
        const view = window.activeElements
          .get(elementId)
          ?.domWrapper.querySelector('.element-shadow-container')
          ?.shadowRoot
          ?.querySelector('#editor')
          ?.cmView;
        return Boolean(view);
      }, id), {
        message: 'Strudel editor should mount before source highlighting setup',
        timeout: 8_000
      })
      .toBe(true);

    await page.evaluate((elementId) => {
      const view = window.activeElements
        .get(elementId)
        ?.domWrapper.querySelector('.element-shadow-container')
        ?.shadowRoot
        ?.querySelector('#editor')
        ?.cmView;
      if (!view) throw new Error('missing Strudel editor');
      const source = 's("bd sd").gain(0.2)';
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: source },
        selection: { anchor: source.length, head: source.length }
      });
      view.focus();
    }, id);
    await page.keyboard.press('Alt+Enter');

    await expect
      .poll(() => page.evaluate((elementId) => window.__jamStrudelRuntimeDebug?.miniLocations?.[elementId]?.length || 0, id), {
        message: 'Strudel transpiler should report source mini locations',
        timeout: 8_000
      })
      .toBeGreaterThan(0);

    await page.evaluate((elementId) => {
      const runtime = window.__jamStrudelRuntimeDebug;
      const pattern = runtime.state.patterns.get(elementId);
      const haps = pattern
        .queryArc(0, 1)
        .filter(hap => hap.context?.jamElementId === elementId && hap.context?.locations?.length);
      if (!haps.length) throw new Error('missing highlighted haps');
      window.dispatchEvent(new CustomEvent('jam-strudel-highlight-frame', {
        detail: { elementId, phase: 0.25, haps: [haps[0]] }
      }));
    }, id);

    await expect
      .poll(() => page.evaluate((elementId) => {
        const root = window.activeElements
          .get(elementId)
          ?.domWrapper.querySelector('.element-shadow-container')
          ?.shadowRoot;
        return [...(root?.querySelectorAll('.cm-content span') || [])]
          .some(node => node.getAttribute('style')?.includes('outline: solid 2px'));
      }, id), {
        message: 'active haps should draw Strudel source range outlines',
        timeout: 3_000
      })
      .toBe(true);

    expect(browserFailures).toEqual([]);
  } finally {
    if (id) await request.delete(`/api/workspace/elements/${id}`);
  }
});

for (const shortcut of ['Control+Delete', 'Control+Backspace']) {
  test(`${shortcut} inside a Strudel editor deletes that element`, async ({ page, request }) => {
    await joinWorkspace(page, 'controller');
    const beforeIds = await page.evaluate(() => [...window.elementsMap.keys()]);

    await addElementFromMenu(page, 'strudel', { x: 460, y: 260 });

    await expect
      .poll(() => page.evaluate((knownIds) => {
        for (const [elementId, layout] of window.elementsMap.entries()) {
          if (!knownIds.includes(elementId) && layout.type === 'strudel') return elementId;
        }
        return '';
      }, beforeIds), {
        message: 'Strudel element should be added',
        timeout: 8_000
      })
      .not.toBe('');

    const createdId = await page.evaluate((knownIds) => {
      for (const [elementId, layout] of window.elementsMap.entries()) {
        if (!knownIds.includes(elementId) && layout.type === 'strudel') return elementId;
      }
      return '';
    }, beforeIds);

    try {
      await expect
        .poll(() => page.evaluate((elementId) => Boolean(window.activeElements
          .get(elementId)
          ?.domWrapper.querySelector('.element-shadow-container')
          ?.shadowRoot
          ?.querySelector('#editor')
          ?.cmView), createdId), {
          message: 'Strudel editor should hydrate before shortcut focus',
          timeout: 8_000
        })
        .toBe(true);

      await page.evaluate((elementId) => {
        const view = window.activeElements
          .get(elementId)
          ?.domWrapper.querySelector('.element-shadow-container')
          ?.shadowRoot
          ?.querySelector('#editor')
          ?.cmView;
        if (!view) throw new Error('missing CodeMirror view');
        view.focus();
      }, createdId);

      await page.keyboard.press(shortcut);

      await expect
        .poll(() => page.evaluate((elementId) => window.elementsMap?.has(elementId) ?? true, createdId), {
          message: `focused Strudel editor should be removed by ${shortcut}`,
          timeout: 3_000
        })
        .toBe(false);
      await expect(page.locator(`#wrapper-${createdId}`)).toHaveCount(0);
    } finally {
      if (createdId) await request.delete(`/api/workspace/elements/${createdId}`);
    }
  });
}

test('Multiple Strudel elements keep independent runtime patterns', async ({ page, request }) => {
  const browserFailures = collectBrowserFailures(page);
  await joinWorkspace(page, 'host');
  const beforeIds = await page.evaluate(() => [...window.elementsMap.keys()]);

  await addElementFromMenu(page, 'strudel', { x: 420, y: 240 });
  await addElementFromMenu(page, 'strudel', { x: 520, y: 320 });

  await expect
    .poll(() => page.evaluate((knownIds) => [...window.elementsMap.keys()].filter(id => !knownIds.includes(id)), beforeIds), {
      message: 'two Strudel elements should be added',
      timeout: 8_000
    })
    .toHaveLength(2);

  const ids = await page.evaluate((knownIds) => [...window.elementsMap.keys()].filter(id => !knownIds.includes(id)), beforeIds);

  try {
    await expect
      .poll(() => page.evaluate((createdIds) => createdIds.every(id => window.activeElements.has(id)), ids), {
        message: 'created Strudel elements should hydrate',
        timeout: 8_000
      })
      .toBe(true);

    const evalStrudel = async (id, code) => {
      await page.evaluate(({ elementId, source }) => {
        const input = window.activeElements
          .get(elementId)
          ?.domWrapper.querySelector('.element-shadow-container')
          ?.shadowRoot
          ?.querySelector('#code');
        if (!input) throw new Error(`missing Strudel editor for ${elementId}`);
        input.value = source;
        input.selectionStart = source.length;
        input.selectionEnd = source.length;
        input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          altKey: true,
          bubbles: true,
          composed: true,
          cancelable: true
        }));
      }, { elementId: id, source: code });
    };

    const firstSource = 'note("c3").s("sawtooth").gain(0.1)';
    const secondSource = 'note("g3").s("sawtooth").gain(0.1)';
    await evalStrudel(ids[0], firstSource);
    await evalStrudel(ids[1], secondSource);

    await expect
      .poll(() => page.evaluate(() => window.__jamStrudelRuntimeDebug?.sources || {}), {
        message: 'both Strudel elements should own separate runtime sources',
        timeout: 8_000
      })
      .toMatchObject({
        [ids[0]]: firstSource,
        [ids[1]]: secondSource
      });

    await expect
      .poll(() => page.evaluate(() => window.__jamStrudelRuntimeDebug?.activeElementIds || []), {
        message: 'both Strudel elements should be active',
        timeout: 8_000
      })
      .toEqual(expect.arrayContaining(ids));

    const hardResetCountBeforeSilence = await page.evaluate(() => window.__jamStrudelRuntimeDebug?.hardResetCount || 0);

    await page.evaluate((elementId) => {
      const input = window.activeElements
        .get(elementId)
        ?.domWrapper.querySelector('.element-shadow-container')
        ?.shadowRoot
        ?.querySelector('#code');
      if (!input) throw new Error(`missing Strudel editor for ${elementId}`);
      input.dispatchEvent(new KeyboardEvent('keydown', {
        key: '.',
        code: 'Period',
        ctrlKey: true,
        bubbles: true,
        composed: true,
        cancelable: true
      }));
    }, ids[1]);

    await expect
      .poll(() => page.evaluate((createdIds) => ({
        createdActiveElementIds: (window.__jamStrudelRuntimeDebug?.activeElementIds || [])
          .filter(id => createdIds.includes(id)),
        firstSource: window.__jamStrudelRuntimeDebug?.sources?.[createdIds[0]] || '',
        secondSource: window.__jamStrudelRuntimeDebug?.sources?.[createdIds[1]] || '',
        running: window.__jamStrudelRuntimeDebug?.running || {},
        hardResetCount: window.__jamStrudelRuntimeDebug?.hardResetCount || 0
      }), ids), {
        message: 'Modifier+period in one Strudel editor should remove only that element pattern',
        timeout: 8_000
      })
      .toMatchObject({
        createdActiveElementIds: [ids[0]],
        firstSource,
        secondSource: '',
        running: { [ids[0]]: true, [ids[1]]: false },
        hardResetCount: hardResetCountBeforeSilence
      });

    expect(browserFailures).toEqual([]);
  } finally {
    await Promise.all(ids.map(id => request.delete(`/api/workspace/elements/${id}`)));
  }
});

test('Strudel replacement clears deleted dollar-pattern lines from the runtime feed', async ({ page, request }) => {
  const browserFailures = collectBrowserFailures(page);
  await joinWorkspace(page, 'host');
  const beforeIds = await page.evaluate(() => [...window.elementsMap.keys()]);

  await addElementFromMenu(page, 'strudel', { x: 460, y: 260 });

  await expect
    .poll(() => page.evaluate((knownIds) => [...window.elementsMap.keys()].find(elementId => !knownIds.includes(elementId)) || '', beforeIds), {
      message: 'Strudel element should be added',
      timeout: 8_000
    })
    .not.toBe('');
  const id = await page.evaluate((knownIds) => [...window.elementsMap.keys()].find(elementId => !knownIds.includes(elementId)) || '', beforeIds);

  try {
    await expect
      .poll(() => page.evaluate((elementId) => window.activeElements.has(elementId), id), {
        message: 'Strudel element should hydrate',
        timeout: 8_000
      })
      .toBe(true);

    const evalStrudel = async (source) => {
      await page.evaluate(({ elementId, source }) => {
        const input = window.activeElements
          .get(elementId)
          ?.domWrapper.querySelector('.element-shadow-container')
          ?.shadowRoot
          ?.querySelector('#code');
        if (!input) throw new Error(`missing Strudel editor for ${elementId}`);
        input.value = source;
        input.selectionStart = source.length;
        input.selectionEnd = source.length;
        input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          altKey: true,
          bubbles: true,
          composed: true,
          cancelable: true
        }));
      }, { elementId: id, source });
    };

    const elementSounds = () => page.evaluate((elementId) => {
      const pattern = window.__jamStrudelRuntimeDebug?.state?.patterns?.get(elementId);
      return (pattern?.firstCycleValues || [])
        .map(value => value?.s || value?.sound || JSON.stringify(value))
        .filter(Boolean);
    }, id);

    await evalStrudel('$: s("bd").gain(0.1)');
    await expect
      .poll(elementSounds, {
        message: 'initial dollar-pattern should evaluate',
        timeout: 8_000
      })
      .toContain('bd');

    await evalStrudel('$: s("hh").gain(0.1)');
    await expect
      .poll(elementSounds, {
        message: 'replacement should not retain deleted dollar-pattern sound',
        timeout: 8_000
      })
      .toEqual(expect.arrayContaining(['hh']));
    expect(await elementSounds()).not.toContain('bd');
    expect(browserFailures).toEqual([]);
  } finally {
    if (id) await request.delete(`/api/workspace/elements/${id}`);
  }
});

test('Strudel runtime registers the Dirt drum sample bank for lazy loading', async ({ page, request }) => {
  const browserFailures = collectBrowserFailures(page);
  await joinWorkspace(page, 'host');
  const beforeIds = await page.evaluate(() => [...window.elementsMap.keys()]);
  await addElementFromMenu(page, 'strudel', { x: 460, y: 260 });

  const id = await expect
    .poll(() => page.evaluate((knownIds) => [...window.elementsMap.keys()].find(elementId => !knownIds.includes(elementId)) || '', beforeIds), {
      message: 'Strudel element should be added',
      timeout: 5_000
    })
    .not.toBe('');

  const createdId = await page.evaluate((knownIds) => [...window.elementsMap.keys()].find(elementId => !knownIds.includes(elementId)) || '', beforeIds);

  try {
    await expect
      .poll(() => page.evaluate((elementId) => window.activeElements.has(elementId), createdId), {
        message: 'Strudel element should hydrate',
        timeout: 8_000
      })
      .toBe(true);

    await page.evaluate((elementId) => {
      const input = window.activeElements
        .get(elementId)
        ?.domWrapper.querySelector('.element-shadow-container')
        ?.shadowRoot
        ?.querySelector('#code');
      const source = 's("bd sd cp hh").gain(0.15)';
      input.value = source;
      input.selectionStart = source.length;
      input.selectionEnd = source.length;
      input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter',
        code: 'Enter',
        altKey: true,
        bubbles: true,
        composed: true,
        cancelable: true
      }));
    }, createdId);

    await expect
      .poll(() => page.evaluate(async (elementId) => ({
        soundCatalogReady: Boolean(window.__jamStrudelRuntimeDebug?.soundCatalogReady),
        source: window.__jamStrudelRuntimeDebug?.sources?.[elementId] || '',
        lastError: window.__jamStrudelRuntimeDebug?.lastError || '',
        types: await window.__jamStrudelRuntimeDebug?.getRegisteredSoundTypes?.([
          'bd',
          'sd',
          'cp',
          'hh',
          'gm_piano',
          'piano',
          'rolandtr909_bd',
          'rolandtr909_sd',
          'rolandtr909_hh',
          'tr909_bd'
        ])
      }), createdId), {
        message: 'official Strudel sound catalog and compatibility aliases should be registered',
        timeout: 15_000
      })
      .toMatchObject({
        soundCatalogReady: true,
        source: 's("bd sd cp hh").gain(0.15)',
        lastError: '',
        types: {
          bd: 'sample',
          sd: 'sample',
          cp: 'sample',
          hh: 'sample',
          gm_piano: 'soundfont',
          piano: 'soundfont',
          rolandtr909_bd: 'sample',
          rolandtr909_sd: 'sample',
          rolandtr909_hh: 'sample',
          tr909_bd: 'sample'
        }
      });

    expect(browserFailures).toEqual([]);
  } finally {
    if (createdId) await request.delete(`/api/workspace/elements/${createdId}`);
  }
});

test('Dragging inside a Strudel editor does not move the element or corrupt code', async ({ page, request }) => {
  await joinWorkspace(page, 'controller');
  const beforeIds = await page.evaluate(() => [...window.elementsMap.keys()]);
  await addElementFromMenu(page, 'strudel', { x: 460, y: 260 });

  const id = await expect
    .poll(() => page.evaluate((knownIds) => {
      for (const [elementId, layout] of window.elementsMap.entries()) {
        if (!knownIds.includes(elementId) && layout.type === 'strudel') return elementId;
      }
      return '';
    }, beforeIds), {
      message: 'Strudel element should be added',
      timeout: 5_000
    })
    .not.toBe('');

  const createdId = await page.evaluate((knownIds) => {
    for (const [elementId, layout] of window.elementsMap.entries()) {
      if (!knownIds.includes(elementId) && layout.type === 'strudel') return elementId;
    }
    return '';
  }, beforeIds);

  try {
    await expect
      .poll(() => page.evaluate((elementId) => window.activeElements.has(elementId), createdId), {
        message: 'Strudel element should hydrate',
        timeout: 5_000
      })
      .toBe(true);

    const before = await page.evaluate((elementId) => {
      const layout = window.elementsMap.get(elementId);
      const input = window.activeElements
        .get(elementId)
        ?.domWrapper.querySelector('.element-shadow-container')
        ?.shadowRoot
        ?.querySelector('#code');
      input.value = 's("bd sd hh").gain(0.4)';
      input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      input.focus();
      input.setSelectionRange(0, 0);
      return { x: layout.x, y: layout.y };
    }, createdId);

    const editorBox = await page.evaluate((elementId) => {
      const editor = window.activeElements
        .get(elementId)
        ?.domWrapper.querySelector('.element-shadow-container')
        ?.shadowRoot
        ?.querySelector('#editor');
      const rect = editor.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height
      };
    }, createdId);

    await page.mouse.move(editorBox.left + 20, editorBox.top + 24);
    await page.mouse.down();
    await page.mouse.move(editorBox.left + Math.min(editorBox.width - 20, 180), editorBox.top + 24, { steps: 8 });
    await page.mouse.up();

    const after = await page.evaluate((elementId) => {
      const layout = window.elementsMap.get(elementId);
      const input = window.activeElements
        .get(elementId)
        ?.domWrapper.querySelector('.element-shadow-container')
        ?.shadowRoot
        ?.querySelector('#code');
      return {
        x: layout.x,
        y: layout.y,
        value: input.value
      };
    }, createdId);

    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.value).toBe('s("bd sd hh").gain(0.4)');
  } finally {
    if (createdId) await request.delete(`/api/workspace/elements/${createdId}`);
  }
});

test('Controller input reaches the Host within the sync budget', async ({ browser, request }, testInfo) => {
  const testElementId = `elem_sync_${Date.now()}`;
  const testElementFile = `/elements/${testElementId}_synth.js`;
  await fs.writeFile(path.join(elementsDir, `${testElementId}_synth.js`), `export default function setup(ctx, prevState) {
  const state = { frequency: prevState?.frequency || 220 };
  const osc = ctx.audioCtx.createOscillator();
  const gain = ctx.audioCtx.createGain();
  osc.frequency.value = state.frequency;
  gain.gain.value = 0.01;
  osc.connect(gain);
  gain.connect(ctx.audioOut);
  osc.start();
  ctx.domRoot.innerHTML = '<label>Freq <input id="freq-slider" type="range" min="80" max="1200" value="' + state.frequency + '"><span id="freq-val">' + state.frequency + 'Hz</span></label>';
  const slider = ctx.domRoot.querySelector('#freq-slider');
  const label = ctx.domRoot.querySelector('#freq-val');
  const setFrequency = (value) => {
    state.frequency = Number(value);
    slider.value = String(state.frequency);
    label.textContent = state.frequency + 'Hz';
    osc.frequency.setTargetAtTime(state.frequency, ctx.audioCtx.currentTime, 0.01);
  };
  const onInput = () => {
    setFrequency(slider.value);
    ctx.bus.pubGlobal('sync_test_frequency', state.frequency);
  };
  slider.addEventListener('input', onInput);
  const unsubscribe = ctx.bus.subGlobal('sync_test_frequency', setFrequency);
  return {
    getState() { return state; },
    destroy() {
      slider.removeEventListener('input', onInput);
      unsubscribe();
      osc.stop();
      osc.disconnect();
      gain.disconnect();
    }
  };
}
`, 'utf8');

  const addResponse = await request.post('/api/workspace/elements', {
    data: {
      id: testElementId,
      filePath: testElementFile,
      type: 'synth',
      prompt: 'controller sync test synth',
      authored: 'hand',
      x: 20,
      y: 20,
      width: 260,
      height: 120
    }
  });
  await expect(addResponse).toBeOK();

  const hostPage = await browser.newPage();
  const controllerPage = await browser.newPage();
  const hostFailures = collectBrowserFailures(hostPage);
  const controllerFailures = collectBrowserFailures(controllerPage);
  const expectedCount = expectedElementCount + 1;

  const hostResult = await joinWorkspace(hostPage, 'host', expectedCount);
  const controllerResult = await joinWorkspace(controllerPage, 'controller', expectedCount);

  const changed = await setFirstSynthFrequency(controllerPage, 444);
  expect(changed).toBe(true);

  const startedAt = Date.now();
  await expect
    .poll(async () => {
      const freqs = await readSynthFrequencies(hostPage);
      return freqs.some((freq) => freq.value === '444' && freq.label === '444Hz');
    }, {
      message: 'controller synth frequency should sync to host',
      timeout: controllerSyncBudgetMs,
      intervals: [25, 50, 100, 250]
    })
    .toBe(true);
  const syncMs = Date.now() - startedAt;

  await testInfo.attach('controller-sync-metrics.json', {
    contentType: 'application/json',
    body: JSON.stringify({ hostResult, controllerResult, syncMs }, null, 2)
  });

  expect(controllerResult.hydrateMs).toBeLessThan(controllerHydrateBudgetMs);
  expect(syncMs).toBeLessThan(controllerSyncBudgetMs);
  expect(hostFailures).toEqual([]);
  expect(controllerFailures).toEqual([]);

  await request.delete(`/api/workspace/elements/${testElementId}`);
  await controllerPage.close();
  await hostPage.close();
});
