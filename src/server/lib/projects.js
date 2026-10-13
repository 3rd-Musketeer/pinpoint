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
 * frontmatter 的解析在 frontmatter.js，id 规则与保留名在 src/shared/project-ids.js。
 */
import fs from 'node:fs';
import path from 'node:path';

import { fileURLToPath } from 'node:url';

import { ENTRY_ID_PATTERN } from '../../shared/registry-ids.js';
import { articlePageId, isReservedProjectId, refKey, RESERVED_ARTICLE_IDS } from '../../shared/project-ids.js';
import { frameFileReaders, parseArticleCanvas } from './article-canvas.js';
import { parseFrontmatter } from './frontmatter.js';
import { manifestPageIds } from './page-manifest.js';
import { PROJECT_CONTENT_DIR } from './page-resolve.js';
import { projectEntries, projectEntry } from './registry.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export { PROJECT_CONTENT_DIR };

/** concept 的 status 只有三档（CONTEXT.md concept 词条）。 */
export const CONCEPT_STATUSES = new Set(['占位', '收敛中', '已固定']);

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
    // canvasSections：画布上有几节（带 Canvas 且列了帧的节）。0 = 这篇没有画布，
    // 工作台左栏点它直接打开正文（docs/projects.md“工作台左栏”）。
    const canvasSections = canvas.sections.filter((section) => section.frames.length > 0).length;
    const article = { id: item.name, title: fm.data.title || item.name, dir: articleDir, file, canvasSections };
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
  const entry = projectEntry(registry, id);
  return entry ? checkPageIdCollisions(readProject(entry), registry) : null;
}
