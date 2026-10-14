/**
 * `ppnt show <project>[/<article>] --uses <组件>`：哪些帧和图用到了一个组件，改完组件照这张单子截图。
 *
 * 两个信号取并集，都读编译产物（dist 不在或落后时先编，见 dist.js）：
 *   - 帧和图的 HTML 里有 data-pp-comp="<名字>"：组件真的渲染出来了（kit 的组件也算）；
 *   - 编译记录的依赖里有 <名字>.jsx：帧 import 了它（组件渲染成片段、没有宿主元素时靠这条）。
 */
import fs from 'node:fs';
import path from 'node:path';

import { deriveArticleBoard } from '../../src/server/lib/article-board.js';
import { loadFigure, readBuildJson, readDistScreen } from '../../src/server/lib/page-compiler.js';
import { PROJECT_CONTENT_DIR } from '../../src/server/lib/projects.js';
import { outlineFrames } from '../../src/workbench/lib/board-refs.js';

import { REPO_ROOT } from './core.js';
import { ensureDist } from './dist.js';

const KIT_JSX = path.join(REPO_ROOT, 'content', 'kits', 'ios', 'jsx');

/** `ConfirmCard`、`components/ConfirmCard.jsx`、`./components/ConfirmCard` → `ConfirmCard`。 */
export function componentName(token) {
  const base = path.basename(String(token || '').trim());
  return base.replace(/\.(jsx|js|tsx|ts)$/, '');
}

function countInstances(html, name) {
  if (!html) return 0;
  return html.split(`data-pp-comp="${name}"`).length - 1;
}

function importsComponent(depFiles, name) {
  return depFiles.some((file) => componentName(file) === name);
}

/** 组件定义在哪：本篇 components/、project 的 components/、kit。 */
function definitionsOf(name, { projectRoot, articleDirs }) {
  const files = [];
  for (const dir of articleDirs) files.push(path.join(dir, 'components', `${name}.jsx`));
  files.push(path.join(projectRoot, PROJECT_CONTENT_DIR, 'components', `${name}.jsx`));
  files.push(path.join(KIT_JSX, `${name}.jsx`));
  return [...new Set(files)].filter((file) => fs.existsSync(file));
}

/**
 * targets：[{ address, target, context }]（context 是 loadAnnotateContext 的结果，取编号用）。
 * → { component, definedIn, frames: [{ address, ref, id, instances, file }], figures: [{ address, id, instances, file }], compiled: [地址] }
 */
export async function componentUses({ component, targets, projectRoot, distRoot }) {
  const name = componentName(component);
  const frames = [];
  const figures = [];
  const compiled = [];
  for (const { address, target, context } of targets) {
    if (await ensureDist(target, { distRoot })) compiled.push(address);
    const build = readBuildJson(distRoot, target.entryId) || {};
    const sources = build.sources || {};
    for (const frame of context && context.refs ? outlineFrames(context.refs) : []) {
      const read = readDistScreen(target.entryId, frame.id, { distRoot });
      const html = read.kind === 'ok' ? read.html : '';
      const deps = ((sources[frame.id] && sources[frame.id].deps) || []).map((dep) => dep.file);
      const instances = countInstances(html, name);
      if (instances || importsComponent(deps, name)) {
        frames.push({ address, ref: frame.ref, id: frame.id, instances, file: path.join(target.pageDir, `${frame.id}.jsx`) });
      }
    }
    let figureRows = [];
    try {
      figureRows = deriveArticleBoard(target).figures;
    } catch {
      figureRows = [];
    }
    for (const figure of figureRows) {
      if (!figure.id || !fs.existsSync(path.join(target.pageDir, 'figures', `${figure.id}.jsx`))) continue;
      const loaded = await loadFigure(target, figure.id, { distRoot });
      const deps = ((loaded.record && loaded.record.sources) || []).map((source) => source.file);
      const instances = countInstances(loaded.ok ? loaded.html : '', name);
      if (instances || importsComponent(deps, name)) {
        figures.push({ address, id: figure.id, instances, file: path.join(target.pageDir, 'figures', `${figure.id}.jsx`) });
      }
    }
  }
  return {
    component: name,
    definedIn: definitionsOf(name, { projectRoot, articleDirs: targets.map((row) => row.target.pageDir) }),
    frames,
    figures,
    compiled,
  };
}

/** 文字输出：定义、帧、图，最后是每篇一条截图命令。 */
export function formatUses(model, scope) {
  const lines = [`# ${model.component} 的用处（${scope}）`];
  lines.push(model.definedIn.length ? `定义：${model.definedIn.join('、')}` : '定义：没在本篇、project 的 components/ 和 kit 里找到同名文件（照编译产物里的组件名找用处）');
  lines.push('', `帧（${model.frames.length}）`);
  if (!model.frames.length) lines.push('  （无）');
  for (const row of model.frames) lines.push(`  ${row.address}  ${(row.ref || '—').padEnd(4)} ${row.id}${row.instances ? `  ${row.instances} 处` : '  import 了它'}`);
  lines.push('', `图（${model.figures.length}）`);
  if (!model.figures.length) lines.push('  （无）');
  for (const row of model.figures) lines.push(`  ${row.address}  图 ${row.id}${row.instances ? `  ${row.instances} 处` : '  import 了它'}`);
  const byArticle = new Map();
  for (const row of model.frames) {
    if (!byArticle.has(row.address)) byArticle.set(row.address, { refs: [], figures: [] });
    byArticle.get(row.address).refs.push(row.ref || row.id);
  }
  for (const row of model.figures) {
    if (!byArticle.has(row.address)) byArticle.set(row.address, { refs: [], figures: [] });
    byArticle.get(row.address).figures.push(row.id);
  }
  if (byArticle.size) {
    lines.push('', '改完组件后截这些：');
    for (const [address, row] of byArticle) {
      if (row.refs.length) lines.push(`  ppnt shot ${address} ${row.refs.join(' ')}`);
      for (const id of row.figures) lines.push(`  ppnt shot ${address} --figure ${id}`);
    }
  }
  return lines;
}
