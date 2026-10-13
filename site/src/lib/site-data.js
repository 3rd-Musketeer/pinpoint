/**
 * Everything a page needs about the registered projects, rebuilt per call
 * from the content collections (cheap; keeps dev reloads honest).
 */
import { getCollection } from 'astro:content';
import { extractRefs, resolveRef, refHtml, RAW_REF_RE, unesc } from './refs.js';

export const CONCEPT_STATUS = {
  placeholder: '占位', converging: '收敛中', fixed: '已固定',
  占位: '占位', 收敛中: '收敛中', 已固定: '已固定',
};

export const articleHref = (project, article) => `/${encodeURIComponent(project)}/${encodeURIComponent(article)}/`;
export const conceptHref = (project, name) => `/${encodeURIComponent(project)}/concepts/${encodeURIComponent(name)}/`;
export const projectHref = (project) => `/${encodeURIComponent(project)}/`;

/** First paragraph of a markdown body as plain text (fallback definition). */
function firstParagraph(body) {
  const p = String(body || '').trim().split(/\n\s*\n/).find((x) => x.trim() && !/^[#>`|-]/.test(x.trim()));
  return p ? p.replace(/\[\[([^\]|]+)\|?([^\]]*)\]\]/g, (_, a, b) => b || a).replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim() : '';
}

export async function loadSite() {
  const [projectEntries, articleEntries, conceptEntries] = await Promise.all([
    getCollection('projects'), getCollection('articles'), getCollection('concepts'),
  ]);
  const errors = projectEntries.flatMap((p) => p.data.errors);
  const projects = new Map();
  for (const p of projectEntries) {
    if (p.id === '__errors') continue;
    projects.set(p.id, { ...p.data, articles: [], concepts: [], names: new Map(), emptyRefs: new Map() });
  }
  for (const a of articleEntries) {
    const p = projects.get(a.data.project);
    if (!p) continue;
    const item = { kind: 'article', entry: a, id: a.data.article, title: a.data.title, summary: a.data.summary || '', href: articleHref(p.id, a.data.article) };
    p.articles.push(item);
    if (!p.names.has(item.id)) p.names.set(item.id, item);
  }
  for (const c of conceptEntries) {
    const p = projects.get(c.data.project);
    if (!p) continue;
    const item = {
      kind: 'concept', entry: c, name: c.data.name,
      status: CONCEPT_STATUS[c.data.status || 'placeholder'],
      fixed: (c.data.status || '') === 'fixed' || c.data.status === '已固定',
      definition: c.data.definition || c.data.boundary || firstParagraph(c.body),
      href: conceptHref(p.id, c.data.name),
      usedBy: [],
    };
    p.concepts.push(item);
    if (!p.names.has(item.name)) p.names.set(item.name, item);
  }
  for (const p of projects.values()) {
    p.articles.sort((x, y) => (x.entry.data.order ?? Infinity) - (y.entry.data.order ?? Infinity) || x.id.localeCompare(y.id));
    p.concepts.sort((x, y) => x.name.localeCompare(y.name, 'zh'));
  }

  // Who references what: article bodies feed used-by; every unresolved target is an empty ref of its project.
  const noteEmpty = (r, source) => {
    const p = projects.get(r.project);
    if (!p) return;
    const list = p.emptyRefs.get(r.name) || [];
    if (!list.includes(source)) list.push(source);
    p.emptyRefs.set(r.name, list);
  };
  for (const p of projects.values()) {
    for (const a of p.articles) {
      a.refs = [];
      for (const raw of extractRefs(a.entry.body)) {
        const r = resolveRef(raw, p.id, projects);
        a.refs.push(r);
        if (r.kind === 'concept' && !r.item.usedBy.includes(a)) r.item.usedBy.push(a);
        if (r.kind === 'empty') noteEmpty(r, a);
      }
    }
    for (const c of p.concepts) {
      for (const raw of extractRefs(c.entry.body)) {
        const r = resolveRef(raw, p.id, projects);
        if (r.kind === 'empty') noteEmpty(r, c);
      }
    }
  }

  const resolve = (raw, from) => resolveRef(raw, from, projects);
  return { projects, errors, resolve, renderRef: (raw, from) => renderRef(resolve(raw, from)) };
}

/** Popup fields per kind (common.md §6, CONTEXT.md concept 词条). */
export function renderRef(r) {
  if (r.kind === 'article') {
    return refHtml(r, { href: r.item.href, title: r.item.title, summary: r.item.summary });
  }
  if (r.kind === 'concept') {
    return refHtml(r, {
      href: r.item.href,
      status: r.item.status,
      fixed: r.item.fixed ? '1' : '',
      def: r.item.definition,
      used: r.item.usedBy.map((a) => ({ title: a.title, href: a.href })),
    });
  }
  return refHtml(r, {});
}

/** Resolve the placeholder spans the remark pass left in rendered .md HTML. */
export function resolveRawRefs(html, site) {
  return String(html || '').replace(RAW_REF_RE, (_, raw, from) => site.renderRef(unesc(raw), unesc(from)));
}

/** Throw in a production build when the namespace check found problems (common.md §6: 撞名构建报错). */
export function assertBuildClean(site) {
  if (import.meta.env.PROD && site.errors.length) {
    throw new Error(`pinpoint site: ${site.errors.length} content error(s)\n- ${site.errors.join('\n- ')}`);
  }
}
