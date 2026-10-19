import { expect, test as base } from '@playwright/test';

export { expect };

// 这些是 Hooks 初始化失败的共有症状，单凭报错不能确定是用法、renderer 还是重复实例。
const MULTI_REACT = /Invalid hook call|more than one copy of React|Cannot read properties of null \(reading 'use[A-Za-z]*'\)/;

/** 收集 React Hooks 错误，尚不归因。 */
export function isMultiReactSymptom(text) {
  return MULTI_REACT.test(String(text));
}

/** 同一文档的脚本记录；各自使用不同版本的独立文档不算重复加载。 */
export function duplicateReactEvidence(samples, urls = []) {
  // React 自己的三项排查提示也含这句话，不能把“可能有多份”当成已经检测到。
  const evidence = samples.filter((sample) => /more than one copy of React/i.test(sample) && !/might have more than one copy of React/i.test(sample));
  const versions = new Map();
  for (const value of urls) {
    const url = new URL(value);
    const version = url.searchParams.get('v');
    if (!version || !/\/(?:react[^/]*|chunk-[^/]+)\.js$/.test(url.pathname)) continue;
    const key = url.origin + url.pathname;
    if (!versions.has(key)) versions.set(key, new Set());
    versions.get(key).add(version);
  }
  for (const [chunk, hashes] of versions) if (hashes.size > 1) evidence.push(`同一 chunk 加载了不同的 ?v=：${chunk} (${[...hashes].join(', ')})`);
  return evidence;
}

export function multiReactMessage(samples, evidence = duplicateReactEvidence(samples)) {
  return [
    evidence.length ? '检测到多份 React 的证据；检查重复依赖及 vite 缓存是否共用（cacheDir、e2e/env.js 的 E2E_VITE_CACHE）。' : 'React Hooks 初始化失败；检查 Hooks 用法、React 与 renderer 版本及重复实例。',
    ...evidence,
    `页面报错：${samples.slice(0, 3).join(' | ')}`,
  ].join('\n');
}

/**
 * 用例统一从这里取 test / expect（e2e/spec-hygiene.test.js 守）。
 * 收集页面报错和脚本版本；失败时补充诊断，通过时只记 annotation。
 */
export const test = base.extend({
  context: async ({ context }, use, testInfo) => {
    const samples = [];
    const scripts = new Map();
    context.on('page', (page) => page.on('framenavigated', (frame) => scripts.delete(frame)));
    context.on('request', (request) => {
      if (request.resourceType() !== 'script') return;
      let frame;
      try { frame = request.frame(); } catch { return; }
      if (!scripts.has(frame)) scripts.set(frame, new Set());
      scripts.get(frame).add(request.url());
    });
    const note = (text) => { if (isMultiReactSymptom(text) && samples.length < 10) samples.push(String(text).split('\n')[0]); };
    context.on('weberror', (error) => note(error.error().message));
    context.on('console', (msg) => { if (msg.type() === 'error') note(msg.text()); });
    await use(context);
    if (!samples.length) return;
    const evidence = [...scripts.values()].flatMap((urls) => duplicateReactEvidence([], urls));
    const description = multiReactMessage(samples, [...duplicateReactEvidence(samples), ...evidence]);
    if (testInfo.status !== testInfo.expectedStatus) throw new Error(description);
    testInfo.annotations.push({ type: 'React 诊断', description });
  },
});
