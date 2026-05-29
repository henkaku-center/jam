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
const pingBudgetMs = Number(process.env.JAM_PING_BUDGET_MS || 100);
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
  await expect(page.locator('#mode-badge')).toHaveText(mode === 'host' ? 'AUDIO ON' : 'MUTED');

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

test('PING compile fast-path stays lightweight', async ({ request }) => {
  const startedAt = Date.now();
  const response = await request.post('/api/compile', {
    data: {
      prompt: 'PING',
      elementId: 'PING',
      filePath: '/elements/PING'
    }
  });
  const elapsedMs = Date.now() - startedAt;

  await expect(response).toBeOK();
  expect(await response.json()).toEqual({ success: true, message: 'PONG' });
  expect(elapsedMs).toBeLessThan(pingBudgetMs);
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

test('Arrow keys do not pan the workspace camera', async ({ page }) => {
  await joinWorkspace(page, 'controller');

  const before = await page.evaluate(() => ({
    x: document.querySelector('#stat-x')?.textContent,
    y: document.querySelector('#stat-y')?.textContent,
    zoom: document.querySelector('#stat-zoom')?.textContent
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
    x: document.querySelector('#stat-x')?.textContent,
    y: document.querySelector('#stat-y')?.textContent,
    zoom: document.querySelector('#stat-zoom')?.textContent
  }));

  expect(after).toEqual(before);
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
  await page.locator('#open-strudel-btn').click();

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
    const shadowText = await page.evaluate((id) => {
      const element = window.activeElements.get(id);
      return element?.domWrapper.querySelector('.element-shadow-container')?.shadowRoot?.textContent || '';
    }, created.id);
    expect(shadowText).toContain('Jam Strudel');
    expect(shadowText).toContain('Official Strudel runtime shared by jam elements');
    const runLabel = await page.evaluate((id) => {
      const element = window.activeElements.get(id);
      return element?.domWrapper.querySelector('.element-shadow-container')?.shadowRoot?.querySelector('#run')?.textContent || '';
    }, created.id);
    expect(runLabel).toBe('play');
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
      code.value = 'note("<c3 e3 g3>").s("sawtooth").gain(0.2).jux(rev)';
      code.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    }, created.id);

    await expect
      .poll(() => page.evaluate((id) => ({
        source: window.__jamStrudelRuntimeDebug?.sources?.[id] || '',
        status: window.activeElements
          .get(id)
          ?.domWrapper.querySelector('.element-shadow-container')
          ?.shadowRoot
          ?.querySelector('#status')
          ?.textContent || ''
      }), created.id), {
        message: 'typing should update the draft without auto-evaluating Strudel',
        timeout: 3_000
      })
      .toMatchObject({ status: 'edited' });

    const sourceBeforeEval = await page.evaluate((id) => window.__jamStrudelRuntimeDebug?.sources?.[id] || '', created.id);
    expect(sourceBeforeEval).not.toContain('<c3 e3 g3>');

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
        source: window.__jamStrudelRuntimeDebug?.sources?.[id] || '',
        status: window.activeElements
          .get(id)
          ?.domWrapper.querySelector('.element-shadow-container')
          ?.shadowRoot
          ?.querySelector('#status')
          ?.textContent || ''
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
        status: window.activeElements
          .get(id)
          ?.domWrapper.querySelector('.element-shadow-container')
          ?.shadowRoot
          ?.querySelector('#status')
          ?.textContent || ''
      }), created.id), {
        message: 'Modifier+period should silence the Strudel element',
        timeout: 8_000
      })
      .toMatchObject({ active: false, status: 'stopped' });
    expect(browserFailures).toEqual([]);
  } finally {
    if (created?.id) await request.delete(`/api/workspace/elements/${created.id}`);
  }
});

test('Multiple Strudel elements keep independent runtime patterns', async ({ page, request }) => {
  const browserFailures = collectBrowserFailures(page);
  await joinWorkspace(page, 'host');
  const beforeIds = await page.evaluate(() => [...window.elementsMap.keys()]);

  await page.locator('#open-strudel-btn').click();
  await page.locator('#open-strudel-btn').click();

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
        hardResetCount: expect.any(Number)
      });

    const hardResetCount = await page.evaluate(() => window.__jamStrudelRuntimeDebug?.hardResetCount || 0);
    expect(hardResetCount).toBeGreaterThan(0);

    expect(browserFailures).toEqual([]);
  } finally {
    await Promise.all(ids.map(id => request.delete(`/api/workspace/elements/${id}`)));
  }
});

test('Strudel replacement clears deleted dollar-pattern lines from the runtime feed', async ({ page, request }) => {
  const browserFailures = collectBrowserFailures(page);
  await joinWorkspace(page, 'host');
  const beforeIds = await page.evaluate(() => [...window.elementsMap.keys()]);

  await page.locator('#open-strudel-btn').click();

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
  await page.locator('#open-strudel-btn').click();

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
        source: window.__jamStrudelRuntimeDebug?.sources?.[elementId] || '',
        lastError: window.__jamStrudelRuntimeDebug?.lastError || '',
        types: await window.__jamStrudelRuntimeDebug?.getRegisteredSoundTypes?.(['bd', 'sd', 'cp', 'hh'])
      }), createdId), {
        message: 'Dirt drum sample aliases should be loaded for Strudel',
        timeout: 15_000
      })
      .toMatchObject({
        source: 's("bd sd cp hh").gain(0.15)',
        lastError: '',
        types: {
          bd: 'sample',
          sd: 'sample',
          cp: 'sample',
          hh: 'sample'
        }
      });

    expect(browserFailures).toEqual([]);
  } finally {
    if (createdId) await request.delete(`/api/workspace/elements/${createdId}`);
  }
});

test('Dragging inside a Strudel editor selects text instead of moving the element', async ({ page, request }) => {
  await joinWorkspace(page, 'controller');
  const beforeIds = await page.evaluate(() => [...window.elementsMap.keys()]);
  await page.locator('#open-strudel-btn').click();

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
      input.focus();
      input.setSelectionRange(0, 0);
      return { x: layout.x, y: layout.y };
    }, createdId);

    const textareaBox = await page.evaluate((elementId) => {
      const input = window.activeElements
        .get(elementId)
        ?.domWrapper.querySelector('.element-shadow-container')
        ?.shadowRoot
        ?.querySelector('#code');
      const rect = input.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height
      };
    }, createdId);

    await page.mouse.move(textareaBox.left + 20, textareaBox.top + 24);
    await page.mouse.down();
    await page.mouse.move(textareaBox.left + Math.min(textareaBox.width - 20, 180), textareaBox.top + 24, { steps: 8 });
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
        selectionLength: Math.abs(input.selectionEnd - input.selectionStart)
      };
    }, createdId);

    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.selectionLength).toBeGreaterThan(0);
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
