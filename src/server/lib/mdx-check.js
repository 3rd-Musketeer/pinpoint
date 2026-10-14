/**
 * 文章正文的渲染检查（`ppnt check`）：MDX 能解析、要到渲染时才出错的写法，比如没定义的组件
 * `<Foo />`、没定义的变量 `{undefinedVar}`。这类错误 listProjects 读不出来（它只解析结构），
 * 打开文章页才看得到；这里不起站点，用站点同一个 MDX 编译器（@mdx-js/mdx，@astrojs/mdx 用的就是它）
 * 和同一个 remark 步骤（remark-pinpoint）把正文编出来跑一遍：
 *
 *   checkMdxRender(text, { file }) → [{ code, line, message, severity }]
 *
 * - code：mdx_compile（编译不过，如 remark 步骤拒绝的写法）、mdx_component_missing（站点没提供、正文也没
 *   import 的组件）、mdx_render（渲染时抛错，如未定义的变量）、mdx_import（正文的 import 在这里跑不了，
 *   只提示）。
 * - line 是整份 index.mdx 的行号（frontmatter 换成同样多的空行再编，行号不偏）。渲染时抛的错按 source map
 *   找回正文的行。
 * - 站点提供给正文的组件（不用 import）是 SITE_MDX_COMPONENTS：和 site/src/pages/[project]/[article]/index.astro
 *   里 `<Content components={{…}} />` 的名字一致，mdx-check.test.js 守着这一点。站点组件这里用替身
 *   （只渲染子节点），它们自己的错误（Canvas、Figure 的写法）由 parseArticleCanvas 报。
 */
import { pathToFileURL } from 'node:url';

import { compile } from '@mdx-js/mdx';
import remarkGfm from 'remark-gfm';
import { SourceMapConsumer, SourceMapGenerator } from 'source-map-js';
import { h, Fragment } from 'preact';
import * as devRuntime from 'preact/jsx-dev-runtime';
import * as runtime from 'preact/jsx-runtime';
import renderToString from 'preact-render-to-string';

import { remarkPinpoint } from '../../../site/src/lib/remark-pinpoint.js';
import { parseFrontmatter } from './frontmatter.js';

/** 站点给正文提供的组件（不用 import）。改 index.astro 的 components 时同步这里。 */
export const SITE_MDX_COMPONENTS = Object.freeze(['Section', 'Canvas', 'Figure', 'Ref']);

const AsyncFunction = (async () => {}).constructor;
const MISSING_RE = /_missingMdxReference\("([^"]+)", (true|false)(?:, "(\d+):(\d+)-[^"]*")?\)/g;

/** frontmatter 换成同样多的空行：正文的行号就是整份文件的行号。 */
function blankFrontmatter(text) {
  const source = String(text || '').replace(/^﻿/, '');
  const { body } = parseFrontmatter(source);
  if (body === source) return source;
  const head = source.slice(0, source.length - body.length);
  return head.replace(/[^\n]/g, '') + body;
}

let evalLineOffset = null;
/** new AsyncFunction(body) 的栈里 body 第 1 行是第几行（V8 在前面包了一个函数头）。 */
async function bodyLineOffset() {
  if (evalLineOffset !== null) return evalLineOffset;
  try {
    await new AsyncFunction('throw new Error("probe")')();
  } catch (error) {
    const m = String(error.stack || '').match(/<anonymous>:(\d+):\d+/);
    evalLineOffset = m ? Number(m[1]) - 1 : 2;
  }
  return evalLineOffset;
}

/** 渲染时抛的错 → 正文的行（找不到是 null）。 */
async function originalLine(error, map) {
  const m = String((error && error.stack) || '').match(/<anonymous>:(\d+):(\d+)/);
  if (!m || !map) return null;
  const offset = await bodyLineOffset();
  const consumer = new SourceMapConsumer(map);
  const line = Number(m[1]) - offset;
  const column = Math.max(0, Number(m[2]) - 1);
  const hit = consumer.originalPositionFor({ line, column, bias: SourceMapConsumer.GREATEST_LOWER_BOUND });
  if (hit && hit.line) return hit.line;
  const near = consumer.originalPositionFor({ line, column, bias: SourceMapConsumer.LEAST_UPPER_BOUND });
  return near && near.line ? near.line : null;
}

const passChildren = (props) => h(Fragment, null, props.children);
const stub = () => null;
const SITE_STUBS = { Section: passChildren, Canvas: stub, Figure: stub, Ref: (props) => h('span', null, props.raw || '') };

/** 正文 → 渲染诊断（见文件头）。file 是 index.mdx 的绝对路径（remark-pinpoint 靠它找 project）。 */
export async function checkMdxRender(text, { file } = {}) {
  const diagnostics = [];
  const report = (code, line, message, severity = 'error') => diagnostics.push({ code, line: line || null, message, severity });
  let compiled;
  try {
    compiled = await compile({ path: file, value: blankFrontmatter(text) }, {
      outputFormat: 'function-body',
      development: true,
      remarkPlugins: [remarkGfm, remarkPinpoint],
      SourceMapGenerator,
    });
  } catch (error) {
    const message = String((error && (error.reason || error.message)) || error).replace(`${file}: `, '');
    const place = error && error.place;
    const at = message.match(/\((\d+):\d+(?:-\d+:\d+)?\)/);
    const line = (error && error.line) || (place && (place.line || (place.start && place.start.line))) || (at ? Number(at[1]) : null);
    report('mdx_compile', line, `MDX 编译失败：${message}`);
    return diagnostics;
  }
  const code = String(compiled.value);
  const provided = new Set(SITE_MDX_COMPONENTS);
  const missing = new Set();
  for (const m of code.matchAll(MISSING_RE)) {
    const [, name, isComponent, line] = m;
    if (provided.has(name) || missing.has(name)) continue;
    missing.add(name);
    report('mdx_component_missing', Number(line) || null, isComponent === 'true'
      ? `组件 <${name}> 没有定义：站点只提供 ${SITE_MDX_COMPONENTS.join('、')}，别的组件要在正文里 import`
      : `${name} 没有定义（正文里用了 ${name}.…）`);
  }
  const components = { ...SITE_STUBS };
  for (const name of missing) components[name] = passChildren;
  let Content;
  try {
    const mod = await new AsyncFunction(code)({
      Fragment: runtime.Fragment,
      jsx: runtime.jsx,
      jsxs: runtime.jsxs,
      jsxDEV: devRuntime.jsxDEV,
      baseUrl: file ? pathToFileURL(file).href : undefined,
    });
    Content = mod.default;
  } catch (error) {
    if (error && /ERR_UNKNOWN_FILE_EXTENSION|ERR_MODULE_NOT_FOUND|Cannot find module/.test(`${error.code} ${error.message}`)) {
      report('mdx_import', null, `正文的 import 在检查里跑不了，跳过渲染检查：${error.message}`, 'warning');
      return diagnostics;
    }
    report('mdx_render', await originalLine(error, compiled.map), `正文执行出错：${(error && error.message) || error}`);
    return diagnostics;
  }
  try {
    renderToString(h(Content, { components }));
  } catch (error) {
    const name = error && error.name ? `${error.name}: ` : '';
    report('mdx_render', await originalLine(error, compiled.map), `渲染出错：${name}${(error && error.message) || error}`);
  }
  return diagnostics;
}
