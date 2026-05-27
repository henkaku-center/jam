import { expect, test } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
      /Failed to load resource: the server responded with a status of 404 \(Not Found\)/.test(text);

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

async function joinWorkspace(page, mode) {
  const startedAt = Date.now();
  await installPerfObserver(page);
  await page.goto(`${appBaseURL}/#test-${mode}-${Date.now()}`, { waitUntil: 'domcontentloaded' });

  await page
    .getByRole('button', { name: mode === 'host' ? /Host-Renderer/ : /Thin-Controller/ })
    .click();

  await expect(page.locator('#autoplay-overlay')).toHaveClass(/hidden/);
  await expect(page.locator('#mode-badge')).toHaveText(mode === 'host' ? 'HOST' : 'CONTROLLER');

  await expect
    .poll(() => page.evaluate(() => window.activeElements?.size ?? 0), {
      message: 'workspace elements should be hydrated',
      timeout: 12_000
    })
    .toBe(expectedElementCount);

  await expect(page.locator('.canvas-element-wrapper')).toHaveCount(expectedElementCount);

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

test('Controller input reaches the Host within the sync budget', async ({ browser }, testInfo) => {
  const hostPage = await browser.newPage();
  const controllerPage = await browser.newPage();
  const hostFailures = collectBrowserFailures(hostPage);
  const controllerFailures = collectBrowserFailures(controllerPage);

  const hostResult = await joinWorkspace(hostPage, 'host');
  const controllerResult = await joinWorkspace(controllerPage, 'controller');

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

  await controllerPage.close();
  await hostPage.close();
});
