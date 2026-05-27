#!/usr/bin/env node

import fs from 'node:fs';
import { chromium } from '@playwright/test';

const baseUrl = process.env.JAM_BASE_URL || 'http://localhost:3000';
const canaryPath = process.env.CHROME_CANARY_PATH || '/usr/bin/google-chrome-canary';
const executablePath = fs.existsSync(canaryPath) ? canaryPath : undefined;

const browser = await chromium.launch({
  executablePath,
  headless: process.env.HEADED ? false : true
});

try {
  const page = await browser.newPage({
    viewport: {
      width: Number(process.env.SMOKE_WIDTH || 1280),
      height: Number(process.env.SMOKE_HEIGHT || 800)
    }
  });
  const errors = [];

  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    const text = message.text();
    const ignored =
      /favicon\.ico/.test(text) ||
      /Failed to load resource: the server responded with a status of 404 \(Not Found\)/.test(text);
    if (message.type() === 'error' && !ignored) errors.push(text);
  });

  const mode = process.env.JAM_MODE === 'host' ? 'host' : 'muted';
  const url = new URL(baseUrl);
  if (mode === 'host') url.searchParams.set('audio', 'on');

  await page.goto(url.toString(), { waitUntil: 'domcontentloaded' });
  await page.click('#join-host-btn');
  await page.waitForFunction(() => (window.activeElements?.size || 0) > 0, null, { timeout: 15000 });
  await page.waitForTimeout(Number(process.env.SMOKE_SETTLE_MS || 1000));

  const result = await page.evaluate(() => {
    const roots = [...document.querySelectorAll('.element-shadow-container')]
      .map((element) => element.shadowRoot)
      .filter(Boolean);
    return {
      activeElements: window.activeElements?.size || 0,
      wrappers: document.querySelectorAll('.canvas-element-wrapper').length,
      shadowText: roots.map((root) => root.textContent || '').join('\n').slice(0, 2000),
      terminalOnline: document.querySelector('#agent-terminal')?.classList.contains('online') || false
    };
  });

  console.log(JSON.stringify({ result, errors }, null, 2));
  process.exit(errors.length ? 1 : 0);
} finally {
  await browser.close();
}
