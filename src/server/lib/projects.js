/**
 * pp3 project 读取（docs/projects.md）：registry 里 kind "project" 的条目指向
 * project 根目录，内容住在 <root>/docs/pinpoint/：
 *
 *   project.json                  { "id", "title" }
 *   articles/<article>/index.mdx  frontmatter: title, summary?
 *   concepts/<名字>.md            frontmatter: name, status, boundary
 *
 * listProjects / findProject 是 Astro 站点（内容集合）、服务（/api/projects）
 * 与 CLI（pinpoint list）共用的唯一读侧。读不抛：每个 project 带一份 errors
 * 列表（缺 project.json、id 不符、撞名…），由调用方决定是报错还是照常渲染。
 *
 * frontmatter 只认 `key: value` 一行一条（值可加单 / 双引号）；看不懂的行记一条
 * error，不猜。仓里没有直接依赖的 YAML 解析器，这几个字段也用不着。
 */
import fs from 'node:fs';
import path from 'node:path';

import { fileURLToPath } from 'node:url';

import { ENTRY_ID_PATTERN } from '../../shared/registry-ids.js';
import { frameFileReaders, parseArticleCanvas } from './article-canvas.js';
import { isReservedSegment, RESERVED_TOP_SEGMENTS } from './article-routes.js';
import { manifestPageIds } from './page-manifest.js';

// 站点卡片（M1-F）的入口也从这里拿：articleCanvas(projectId, articleId, { registry? })。
export { articleCanvas } from './article-board.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** project 根下的内容目录（相对路径）。 */
export const PROJECT_CONTENT_DIR = path.join('docs', 'pinpoint');

/**
 * project id 是站点 URL 的第一段（/<project>/<article>/），不能是服务已占用的首段。
 * 唯一的表在 article-routes.js（RESERVED_TOP_SEGMENTS + test-results* /
 * playwright-report* 前缀）：服务路由与登记校验用同一份。
 */
export const RESERVED_PROJECT_IDS = new Set(RESERVED_TOP_SEGMENTS);

/** id 是不是保留的 URL 首段（整名或前缀）。 */
export const isReservedProjectId = (id) => isReservedSegment(String(id));

/** project 内占用的 URL 第二段：/<project>/concepts/<名字>/。 */
export const RESERVED_ARTICLE_IDS = new Set(['concepts']);

/**
 * 文章画布的页 id（M1，docs/projects.md「文章的画布」）：`<project id>_<article id>`。
 * project id 与 article id 都匹配 ENTRY_ID_PATTERN（没有 `_`），所以：
 * - 拆分无歧义（恰好一个 `_`），不同文章不会得到同一个页 id；
 * - 不会和 registry 条目撞（条目 id 也是 ENTRY_ID_PATTERN，不含 `_`）；
 * - 仍匹配 PAGE_ID_PATTERN（`?page=`、标注桶、/sites/<id>/ 都认）。
 * 唯一可能撞的是 content/previews/_index.json 里带 `_` 的模板页，读取时检查并记错误。
 */
export const ARTICLE_PAGE_ID_SEPARATOR = '_';
export const ARTICLE_PAGE_ID_PATTERN = /^([a-z0-9][a-z0-9-]*)_([a-z0-9][a-z0-9-]*)$/;

export function articlePageId(projectId, articleId) {
  const id = `${projectId}${ARTICLE_PAGE_ID_SEPARATOR}${articleId}`;
  if (!ENTRY_ID_PATTERN.test(String(projectId)) || !ENTRY_ID_PATTERN.test(String(articleId))) {
    throw new Error(`articlePageId：project id 与 article id 都必须匹配 ${ENTRY_ID_PATTERN}：${JSON.stringify(id)}`);
  }
  return id;
}

/** 页 id → { projectId, articleId }；不是文章画布的页 id 形状返回 null（不查盘）。 */
export function parseArticlePageId(pageId) {
  const match = String(pageId == null ? '' : pageId).match(ARTICLE_PAGE_ID_PATTERN);
  return match ? { projectId: match[1], articleId: match[2] } : null;
}

const FM_KEY = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:(?:\s+(.*))?$/;
// 这些开头在 YAML 里是块标量、流式列表 / 映射、锚点、标签：本解析器不支持，报错不猜。
const YAML_ONLY_START = /^[>|[{&*!]/;

/** concept 的 status 只有三档（CONTEXT.md concept 词条）。 */
export const CONCEPT_STATUSES = new Set(['占位', '收敛中', '已固定']);

function unquote(raw) {
  const value = raw.trim();
  if (value.startsWith('"')) {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === 'string') return { value: parsed };
    } catch { /* 落到下面报错 */ }
    return { error: `双引号值没闭合或含非法转义：${value}` };
  }
  if (value.startsWith("'")) {
    if (value.length >= 2 && value.endsWith("'")) return { value: value.slice(1, -1).replace(/''/g, "'") };
    return { error: `单引号值没闭合：${value}` };
  }
  if (!value) return { error: '值为空（不写这个键，或写 ""）' };
  if (YAML_ONLY_START.test(value)) return { error: `只支持单行字符串，不支持以 ${value[0]} 开头的 YAML 写法：${value}` };
  // 不带引号的值：` #` 之后是注释（与 YAML 同规则）。
  const hash = value.search(/\s#/);
  return { value: (hash >= 0 ? value.slice(0, hash) : value).trim() };
}

/**
 * 解析开头的 `---` frontmatter。返回 { data, body, errors }：
 * 没有 frontmatter → data 为空、body 为全文；看不懂的行逐条进 errors。
 */
export function parseFrontmatter(text) {
  const source = String(text || '').replace(/^﻿/, '');
  const lines = source.split(/\r?\n/);
  if (lines[0] !== '---') return { data: {}, body: source, errors: [] };
  const end = lines.indexOf('---', 1);
  if (end < 0) return { data: {}, body: source, errors: ['frontmatter 没有结束的 ---'] };
  const data = {};
  const errors = [];
  for (let i = 1; i < end; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const match = line.match(FM_KEY);
    if (!match) {
      errors.push(`frontmatter 第 ${i + 1} 行只支持 key: value：${line.trim()}`);
      continue;
    }
    const [, key, raw = ''] = match;
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      errors.push(`frontmatter 第 ${i + 1} 行重复的键：${key}`);
      continue;
    }
    const parsed = unquote(raw);
    if (parsed.error) {
      errors.push(`frontmatter 第 ${i + 1} 行：${parsed.error}`);
      continue;
    }
    data[key] = parsed.value;
  }
  return { data, body: lines.slice(end + 1).join('\n'), errors };
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function isDir(target) {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function isFile(target) {
  try {
    return fs.statSync(target).isFile();
  } catch {
    return false;
  }
}

function visibleChildren(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((item) => !item.name.startsWith('.'))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

/**
 * <root>/docs/pinpoint/project.json → { json, errors }。CLI 登记前也用它：
 * 文件缺失、JSON 坏、id 不合模式或是保留名都是 error。
 */
export function readProjectJson(root) {
  const file = path.join(root, PROJECT_CONTENT_DIR, 'project.json');
  const text = readText(file);
  if (text === null) return { json: null, file, errors: [`缺 ${path.join(PROJECT_CONTENT_DIR, 'project.json')}（${file}）`] };
  let json;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return { json: null, file, errors: [`project.json 不是合法 JSON：${error.message}`] };
  }
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return { json: null, file, errors: ['project.json 必须是对象 { "id", "title" }'] };
  }
  const errors = [];
  if (typeof json.id !== 'string' || !ENTRY_ID_PATTERN.test(json.id)) {
    errors.push(`project.json 的 id 必须匹配 ${ENTRY_ID_PATTERN}：${JSON.stringify(json.id)}`);
  } else if (isReservedProjectId(json.id)) {
    errors.push(`project id 是保留名（服务已占用 /${json.id}/）：${json.id}`);
  }
  if (json.title !== undefined && typeof json.title !== 'string') errors.push('project.json 的 title 必须是字符串');
  return { json, file, errors };
}

function readArticles(dir, errors, projectId) {
  const articlesDir = path.join(dir, 'articles');
  const articles = [];
  for (const item of visibleChildren(articlesDir)) {
    const rel = `articles/${item.name}`;
    if (!item.isDirectory()) {
      errors.push(`${rel}：articles/ 下只放文章目录`);
      continue;
    }
    if (!ENTRY_ID_PATTERN.test(item.name)) {
      errors.push(`${rel}：文章 id 必须匹配 ${ENTRY_ID_PATTERN}`);
      continue;
    }
    if (RESERVED_ARTICLE_IDS.has(item.name)) {
      errors.push(`${rel}：文章 id 是保留名（/<project>/${item.name}/ 已被占用）`);
      continue;
    }
    const articleDir = path.join(articlesDir, item.name);
    const file = path.join(articleDir, 'index.mdx');
    const text = readText(file);
    if (text === null) {
      errors.push(`${rel}：缺 index.mdx`);
      continue;
    }
    const fm = parseFrontmatter(text);
    for (const problem of fm.errors) errors.push(`${rel}/index.mdx：${problem}`);
    // 画布写法的错误（跨页引用、缺帧文件、一节两个 Canvas、重复节 id…）也是布局错误。
    const canvas = parseArticleCanvas(text, frameFileReaders(articleDir));
    for (const problem of canvas.errors) errors.push(`${rel}/index.mdx：${problem.message}`);
    const article = { id: item.name, title: fm.data.title || item.name, dir: articleDir, file };
    if (projectId && ENTRY_ID_PATTERN.test(projectId)) article.pageId = articlePageId(projectId, item.name);
    if (fm.data.summary) article.summary = fm.data.summary;
    articles.push(article);
  }
  return articles;
}

function readConcepts(dir, errors) {
  const conceptsDir = path.join(dir, 'concepts');
  const concepts = [];
  for (const item of visibleChildren(conceptsDir)) {
    const rel = `concepts/${item.name}`;
    if (!item.isFile() || path.extname(item.name) !== '.md') {
      errors.push(`${rel}：concepts/ 下只放 <名字>.md`);
      continue;
    }
    const file = path.join(conceptsDir, item.name);
    const fm = parseFrontmatter(readText(file) || '');
    for (const problem of fm.errors) errors.push(`${rel}：${problem}`);
    const slug = path.basename(item.name, '.md');
    const concept = { name: fm.data.name || slug, slug, file };
    if (fm.data.status) {
      if (CONCEPT_STATUSES.has(fm.data.status)) concept.status = fm.data.status;
      else errors.push(`${rel}：status 只能是 ${[...CONCEPT_STATUSES].join(' / ')}：${fm.data.status}`);
    }
    if (fm.data.boundary) concept.boundary = fm.data.boundary;
    concepts.push(concept);
  }
  return concepts;
}

/** `[[名字]]` 的命名空间键：比较不分大小写、去首尾空白（Obsidian 同规则）。 */
export function refKey(name) {
  return String(name).normalize('NFC').trim().toLowerCase();
}

/** article id 与 concept name 共用一个命名空间：撞名逐条记 error。 */
function checkNamespace(articles, concepts, errors) {
  const owners = new Map();
  const claim = (key, label) => {
    if (!owners.has(key)) owners.set(key, []);
    owners.get(key).push(label);
  };
  for (const article of articles) claim(refKey(article.id), `article "${article.id}"`);
  for (const concept of concepts) claim(refKey(concept.name), `concept "${concept.name}"（concepts/${concept.slug}.md）`);
  for (const [key, labels] of owners) {
    if (labels.length > 1) errors.push(`撞名 [[${key}]]：${labels.join('、')}（article id 与 concept name 共用一个命名空间）`);
  }
}

/** 一个 registry project 条目 → 读盘后的 project（不抛）。 */
export function readProject(entry) {
  const root = entry.path;
  const dir = path.join(root, PROJECT_CONTENT_DIR);
  const errors = [];
  const project = { id: entry.id, title: entry.title || entry.id, root, dir, articles: [], concepts: [], errors };
  if (isReservedProjectId(entry.id)) errors.push(`project id 是保留名（服务已占用 /${entry.id}/）：${entry.id}`);
  if (!isDir(root)) {
    errors.push(`project 根目录不存在：${root}`);
    return project;
  }
  if (!isDir(dir)) {
    errors.push(`缺 ${PROJECT_CONTENT_DIR}/ 目录（${dir}）`);
    return project;
  }
  const meta = readProjectJson(root);
  for (const problem of meta.errors) if (!errors.includes(problem)) errors.push(problem);
  if (meta.json) {
    if (typeof meta.json.id === 'string' && meta.json.id !== entry.id) {
      errors.push(`project.json 的 id "${meta.json.id}" 与登记的 id "${entry.id}" 不一致（改 id 用 pinpoint rename）`);
    }
    if (typeof meta.json.title === 'string' && meta.json.title) project.title = meta.json.title;
  }
  project.articles = readArticles(dir, errors, entry.id);
  project.concepts = readConcepts(dir, errors);
  project.concepts.sort((a, b) => a.name.localeCompare(b.name));
  checkNamespace(project.articles, project.concepts, errors);
  return project;
}

function projectEntries(registry) {
  if (!registry) return [];
  if (Array.isArray(registry.projects)) return registry.projects;
  return (registry.entries || []).filter((entry) => entry && entry.kind === 'project');
}

/**
 * 文章画布页 id 与既有页撞名 → 布局错误。按构造不会撞 registry 条目（见
 * ARTICLE_PAGE_ID_PATTERN），仍逐条查一遍；真正可能撞的是带 `_` 的模板页。
 */
function checkPageIdCollisions(project, registry, root = REPO_ROOT) {
  const taken = new Map();
  for (const entry of (registry && registry.entries) || []) if (entry && entry.id) taken.set(entry.id, `registry 条目 "${entry.id}"`);
  for (const id of manifestPageIds(root)) if (!taken.has(id)) taken.set(id, `模板页 "${id}"（content/previews/_index.json）`);
  for (const article of project.articles) {
    if (article.pageId && taken.has(article.pageId)) {
      project.errors.push(`articles/${article.id}：画布页 id "${article.pageId}" 与${taken.get(article.pageId)}撞名，画布打不开（改文章 id 或那个页的 id）`);
    }
  }
  return project;
}

/**
 * 登记的全部 project，按登记顺序：
 * [{ id, title, root, dir, articles: [{ id, title, summary?, pageId, dir, file }],
 *    concepts: [{ name, slug, status?, boundary?, file }], errors: [] }]
 */
export function listProjects(registry) {
  return projectEntries(registry).map((entry) => checkPageIdCollisions(readProject(entry), registry));
}

/** 按 id 找一个 project；没登记返回 null。 */
export function findProject(registry, id) {
  const entry = projectEntries(registry).find((item) => item.id === id);
  return entry ? checkPageIdCollisions(readProject(entry), registry) : null;
}
