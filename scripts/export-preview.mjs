#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

import { chromium } from '@playwright/test';

import { exportFilename, validateExportRequest } from '../src/server/lib/export-contract.js';

function parseArgs(argv) {
  const values = {
    url: process.env.PINPOINT_URL || 'https://pinpoint.localhost',
    format: 'png',
    scale: 2,
    background: 'canvas',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith('--')) values[arg.slice(2)] = argv[++index];
  }
  values.scale = Number(values.scale);
  return values;
}

function usage(message) {
  if (message) console.error(message);
  console.error('Usage: npm run export -- --page <pageId> --section <sectionId> [--frame <screenId>] [--format png|webp] [--scale 1|2] [--background canvas|white|transparent] [--output path]');
  process.exitCode = 1;
}

const args = parseArgs(process.argv.slice(2));
if (!args.page || !args.section) {
  usage('Both --page and --section are required. Omit --frame to export the whole Section.');
} else {
  const baseUrl = String(args.url).replace(/\/$/, '');
  const hostname = new URL(baseUrl).hostname;
  const localPreview = hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '::1'
    || hostname.endsWith('.localhost');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1100 },
    ignoreHTTPSErrors: localPreview,
  });
  try {
    const page = await context.newPage();
    // The annotation SSE connection is intentionally long-lived, so networkidle
    // would never settle. DOM readiness + the public Workbench API is the gate.
    await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.workbench);
    await page.evaluate((pageId) => window.workbench.setActivePage(pageId), args.page);
    await page.waitForFunction((pageId) => window.workbench.activePageId() === pageId && document.querySelector('#wb-board-panel .wb-lib-item'), args.page);
    // window.workbench.exportSnapshot 已随 pp2 切片 3 的导出削减退役 —— 快照按同一
    // 契约在页内手组：clone → 摘 script 与 data-export-ui → 带上画布 token。
    const snapshot = await page.evaluate((options) => {
      const panel = document.getElementById('wb-board-panel');
      const target = options.kind === 'section'
        ? panel.querySelector(`.wb-lib-item[data-ann-section="${CSS.escape(options.sectionId)}"]`)
        : panel.querySelector(`[data-screen="${CSS.escape(options.screenId)}"]`);
      if (!target) throw new Error('找不到要导出的 ' + (options.kind === 'frame' ? 'Frame' : 'Section'));
      const clone = target.cloneNode(true);
      clone.querySelectorAll('script,[data-export-ui]').forEach((node) => node.remove());
      clone.removeAttribute('data-export-ui');
      const TOKEN_NAMES = [
        '--wb-phone-w', '--wb-phone-h', '--wb-cap-section', '--wb-cap-screen', '--wb-cap-note', '--wb-cap-gap', '--wb-cap-ref',
        '--wb-fg', '--wb-muted', '--wb-faint', '--wb-side', '--wb-line', '--wb-hover', '--wb-accent',
      ];
      const computed = getComputedStyle(panel.querySelector('.wb-library'));
      const tokens = {};
      TOKEN_NAMES.forEach((name) => {
        const value = computed.getPropertyValue(name).trim();
        if (value) tokens[name] = value;
      });
      const section = options.kind === 'section' ? target : target.closest('.wb-lib-item');
      const screen = options.kind === 'frame' ? target : null;
      return {
        kind: options.kind,
        pageId: window.workbench.activePageId(),
        sectionId: section.getAttribute('data-ann-section') || section.getAttribute('data-ann-group'),
        screenId: screen ? screen.getAttribute('data-screen') : '',
        format: options.format,
        scale: options.scale,
        background: options.background,
        tokens,
        html: clone.outerHTML,
      };
    }, {
      kind: args.frame ? 'frame' : 'section',
      sectionId: args.section,
      screenId: args.frame || '',
      format: args.format,
      scale: args.scale,
      background: args.background,
    });
    const request = validateExportRequest(snapshot);
    const response = await context.request.post(`${baseUrl}/api/export-image`, {
      data: request,
    });
    if (!response.ok()) {
      const body = await response.text();
      throw new Error(`Export failed (${response.status()}): ${body}`);
    }
    const filename = exportFilename(request).replace(/\//g, '-');
    const output = path.resolve(args.output || path.join('exports', filename));
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, await response.body());
    const headers = response.headers();
    console.log(`${output} · ${headers['x-export-width']}×${headers['x-export-height']} · ${headers['content-type']}`);
  } finally {
    await context.close();
    await browser.close();
  }
}
