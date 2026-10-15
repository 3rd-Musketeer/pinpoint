import { expect, test as base } from '@playwright/test';

export { expect };

// 页面里出现多份 React 时 React 报的错。几乎总是环境问题：服务的 vite 依赖缓存（deps/）在它启动后被
// 别的实例重建覆盖，页面按两个 ?v= 各加载了一份 React（2026-10-15 查清，vite.config.js 的 cacheDir）。
export const MULTI_REACT = /Invalid hook call|more than one copy of React|Cannot read properties of null \(reading 'use[A-Za-z]*'\)/;

/** 一条页面错误 / console 文本是不是多份 React 的症状。 */
export function isMultiReactSymptom(text) {
  return MULTI_REACT.test(String(text));
}

/** 失败信息里加的那一行：一眼认出是环境，不去查用例。 */
export function multiReactMessage(samples) {
  return [
    '环境：vite 依赖缓存被覆盖（页面里有多份 React），不是这条用例的问题。',
    '服务的 deps/ 在它启动后被别的 vite 实例重建过；查服务的 cacheDir 是不是和别的实例共用（vite.config.js、e2e/env.js 的 E2E_VITE_CACHE）。',
    `页面报错：${samples.slice(0, 3).join(' | ')}`,
  ].join('\n');
}

/**
 * 用例统一从这里取 test / expect（e2e/spec-hygiene.test.js 守）。
 * 包一层 context：收集这个 context 里所有页面的报错和 console.error，出现多份 React 的症状时，
 * 用例失败就在失败信息里加一条“环境：vite 依赖缓存被覆盖”；用例通过只记一条 annotation。
 */
export const test = base.extend({
  context: async ({ context }, use, testInfo) => {
    const samples = [];
    const note = (text) => { if (isMultiReactSymptom(text) && samples.length < 10) samples.push(String(text).split('\n')[0]); };
    context.on('weberror', (error) => note(error.error().message));
    context.on('console', (msg) => { if (msg.type() === 'error') note(msg.text()); });
    await use(context);
    if (!samples.length) return;
    if (testInfo.status !== testInfo.expectedStatus) throw new Error(multiReactMessage(samples));
    testInfo.annotations.push({ type: '环境', description: multiReactMessage(samples) });
  },
});
