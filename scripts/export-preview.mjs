#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

import { chromium } from '@playwright/test';

import { exportFilename, validateExportRequest } from '../lib/export-contract.js';

function parseArgs(argv) {
  const values = { url: 'http://127.0.0.1:5199', format: 'webp', scale: 2, background: 'canvas' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--with-notes') values.includeNotes = true;
    else if (arg.startsWith('--')) values[arg.slice(2)] = argv[++index];
  }
  values.scale = Number(values.scale);
  return values;
}

function usage(message) {
  if (message) console.error(message);
  console.error('Usage: npm run export -- --page <pageId> --section <sectionId> [--frame <screenId>] [--format webp|png] [--scale 1|2] [--background canvas|white|transparent] [--with-notes] [--output path]');
  process.exitCode = 1;
}

const args = parseArgs(process.argv.slice(2));
if (!args.page || !args.section) {
  usage('Both --page and --section are required. Omit --frame to export the whole Section.');
} else {
  const baseUrl = String(args.url).replace(/\/$/, '');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
    // The annotation SSE connection is intentionally long-lived, so networkidle
    // would never settle. DOM readiness + the public Workbench API is the gate.
    await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.workbench);
    await page.evaluate((pageId) => window.workbench.setActivePage(pageId), args.page);
    await page.waitForFunction((pageId) => window.workbench.activePageId() === pageId && document.querySelector('#wb-board-panel .wb-lib-item'), args.page);
    const snapshot = await page.evaluate((options) => window.workbench.exportSnapshot(options), {
      kind: args.frame ? 'frame' : 'section',
      sectionId: args.section,
      screenId: args.frame || '',
      format: args.format,
      scale: args.scale,
      background: args.background,
      includeNotes: !!args.includeNotes,
    });
    const request = validateExportRequest(snapshot);
    const response = await fetch(`${baseUrl}/api/export-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Export failed (${response.status}): ${body}`);
    }
    const filename = exportFilename(request).replace(/\//g, '-');
    const output = path.resolve(args.output || path.join('exports', filename));
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, Buffer.from(await response.arrayBuffer()));
    console.log(`${output} · ${response.headers.get('x-export-width')}×${response.headers.get('x-export-height')} · ${response.headers.get('content-type')}`);
  } finally {
    await browser.close();
  }
}
