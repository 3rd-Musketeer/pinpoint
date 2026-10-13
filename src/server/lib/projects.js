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

import { ENTRY_ID_PATTERN } from '../../shared/registry-ids.js';

/** project 根下的内容目录（相对路径）。 */
export const PROJECT_CONTENT_DIR = path.join('docs', 'pinpoint');

/**
 * project id 是站点 URL 的第一段（/<project>/<article>/），不能是服务已占用的首段。
 * 来源：common.md 定的七个（api sites workbench kits assets annotate _astro）；
 * 服务路由（annotate-api: health registry events annotations images image save；
 * content-routes: previews lib）；vite 直接按仓库根服务静态文件，所以仓库根的
 * 顶层目录也都是首段（src content node_modules bin docs e2e scripts skills
 * site tasks；projects.test.js 守着它与仓库根同步）。
 */
export const RESERVED_PROJECT_IDS = new Set([
  'api', 'sites', 'workbench', 'kits', 'assets', 'annotate', '_astro',
  'health', 'registry', 'events', 'annotations', 'images', 'image', 'save',
  'previews', 'lib',
  'src', 'content', 'node_modules', 'bin', 'docs', 'e2e', 'scripts', 'skills', 'site', 'tasks',
]);

/** project 内占用的 URL 第二段：/<project>/concepts/<名字>/。 */
export const RESERVED_ARTICLE_IDS = new Set(['concepts']);

const FM_KEY = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:(?:\s+(.*))?$/;

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
  } else if (RESERVED_PROJECT_IDS.has(json.id)) {
    errors.push(`project id 是保留名（服务已占用 /${json.id}/）：${json.id}`);
  }
  if (json.title !== undefined && typeof json.title !== 'string') errors.push('project.json 的 title 必须是字符串');
  return { json, file, errors };
}

function readArticles(dir, errors) {
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
    const article = { id: item.name, title: fm.data.title || item.name, dir: articleDir, file };
    if (fm.data.summary) article.summary = fm.data.summary;
    articles.push(article);
  }
  return articles;
}

function readConcepts(dir, errors) {
  const conceptsDir = path.join(dir, 'concepts');
  const concepts = [];
  for (const item of visibleChildren(conceptsDir)) {
    if (!item.isFile() || path.extname(item.name) !== '.md') continue;
    const rel = `concepts/${item.name}`;
    const file = path.join(conceptsDir, item.name);
    const fm = parseFrontmatter(readText(file) || '');
    for (const problem of fm.errors) errors.push(`${rel}：${problem}`);
    const slug = path.basename(item.name, '.md');
    const concept = { name: fm.data.name || slug, slug, file };
    if (fm.data.status) concept.status = fm.data.status;
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
  if (RESERVED_PROJECT_IDS.has(entry.id)) errors.push(`project id 是保留名（服务已占用 /${entry.id}/）：${entry.id}`);
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
  project.articles = readArticles(dir, errors);
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
 * 登记的全部 project，按登记顺序：
 * [{ id, title, root, dir, articles: [{ id, title, summary?, dir, file }],
 *    concepts: [{ name, slug, status?, boundary?, file }], errors: [] }]
 */
export function listProjects(registry) {
  return projectEntries(registry).map(readProject);
}

/** 按 id 找一个 project；没登记返回 null。 */
export function findProject(registry, id) {
  const entry = projectEntries(registry).find((item) => item.id === id);
  return entry ? readProject(entry) : null;
}
