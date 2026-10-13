/**
 * `[[ ]]` references (common.md §6). Pure: no Astro, no fs.
 *
 *   [[名字]]            article id or concept name in the current project
 *   [[project:名字]]    the same in another project (prefix must be a project id)
 *   [[名字|显示文字]]    Obsidian-style label
 *
 * A name that resolves to nothing is an empty ref: legal, rendered dashed,
 * listed on the project page.
 *
 * Names compare by `refKey` (NFC, trimmed, case-insensitive) — the same key
 * listProjects uses for its namespace check, so what collides there is what
 * resolves here.
 */
import { refKey } from '../../../src/server/lib/projects.js';
export { refKey };

export const REF_RE = /\[\[([^\[\]\n]+?)\]\]/g;

/** Split `[[...]]` inner text into { target, label }. */
export function parseRefBody(body) {
  const bar = body.indexOf('|');
  const target = (bar >= 0 ? body.slice(0, bar) : body).trim();
  const label = bar >= 0 ? body.slice(bar + 1).trim() : '';
  return { target, label };
}

/**
 * Resolve the target against the project index.
 * `projects` = Map<projectId, { names: Map<refKey(name), item> }>, item = { kind: 'article'|'concept', ... }.
 * → { kind: 'article'|'concept'|'empty', project, name, label, item? }
 */
export function resolveRef(raw, from, projects) {
  const { target, label } = parseRefBody(raw);
  let project = from;
  let name = target;
  const colon = target.indexOf(':');
  if (colon > 0) {
    const prefix = target.slice(0, colon).trim();
    if (projects.has(prefix)) { project = prefix; name = target.slice(colon + 1).trim(); }
  }
  const item = projects.get(project)?.names.get(refKey(name));
  const shown = label || name;
  if (!item) return { kind: 'empty', project, name, label: shown };
  return { kind: item.kind, project, name, label: shown, item };
}

/** Drop fenced code and inline code so a scan agrees with the remark pass (which skips code nodes). */
export function stripCode(text) {
  return String(text || '')
    .replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, '')
    .replace(/`[^`\n]*`/g, '');
}

/** All `[[ ]]` bodies in a markdown/MDX source, code excluded, in order. */
export function extractRefs(text) {
  return [...stripCode(text).matchAll(REF_RE)].map((m) => m[1]);
}

/**
 * Namespace check for one project: article ids and concept names share it.
 * → list of error strings (empty when clean).
 */
export function namespaceErrors(project) {
  const seen = new Map();
  const errors = [];
  const add = (name, what) => {
    const key = refKey(name);
    if (seen.has(key)) errors.push(`project "${project.id}": name "${name}" is used by ${seen.get(key)} and ${what} — article ids and concept names share one namespace`);
    else seen.set(key, what);
  };
  for (const a of project.articles || []) {
    if (a.id === 'concepts') errors.push(`project "${project.id}": article id "concepts" is reserved (it is the concept route segment)`);
    add(a.id, `article ${a.file}`);
  }
  for (const c of project.concepts || []) add(c.name, `concept ${c.file}`);
  return errors;
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

/**
 * One markup for a resolved ref, used by the MDX <Ref> component and by the
 * concept pages (whose .md bodies carry placeholder spans). `info` holds the
 * popup fields the client script reads.
 */
export function refHtml(r, info = {}) {
  const attrs = [
    `data-kind="${r.kind}"`,
    `data-name="${esc(r.name)}"`,
    `data-project="${esc(r.project)}"`,
  ];
  for (const [k, v] of Object.entries(info)) {
    if (v === undefined || v === null || v === '') continue;
    attrs.push(`data-${k}="${esc(typeof v === 'string' ? v : JSON.stringify(v))}"`);
  }
  if (r.kind === 'empty') {
    return `<span class="cref empty" role="button" tabindex="0" ${attrs.join(' ')}>${esc(r.label)}</span>`;
  }
  return `<a class="cref" href="${esc(info.href || '#')}" ${attrs.join(' ')}>${esc(r.label)}</a>`;
}

/** Placeholder the remark pass emits into plain .md (no components there). */
export const RAW_REF_RE = /<span data-pp-ref="([^"]*)" data-pp-from="([^"]*)">[^<]*<\/span>/g;
export const rawRefHtml = (raw, from) =>
  `<span data-pp-ref="${esc(raw)}" data-pp-from="${esc(from)}">${esc(parseRefBody(raw).label || parseRefBody(raw).target)}</span>`;

const UNESC = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
export const unesc = (s) => String(s).replace(/&(amp|lt|gt|quot|#39);/g, (m) => UNESC[m]);

/** Section letters share the board's scheme (A … Z, AA …). */
export { sectionLetter } from '../../../src/workbench/lib/board-refs.js';
