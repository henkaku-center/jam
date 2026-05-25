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
