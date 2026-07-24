/**
 * Hierarchical annotation indicators for agents.
 *
 *   @page:<pageId>
 *   @section:<pageId>/<sectionId>
 *   @frame:<pageId>/<screenId>
 *   @a:<id>
 *
 * Scope indicators mean “all annotations under this locator”.
 * @a means one annotation.
 */

const ID_RE = '[A-Za-z0-9._-]+';
const TARGET_REF_RE = /^i([1-9][0-9]*)$/;
const TARGET_STORE_RE = /\[@t:(i[1-9][0-9]*)\]/gi;
const TARGET_DISPLAY_RE = /\[indicator\s+([1-9][0-9]*)\]/gi;
const TARGET_MISSING_DISPLAY_RE = /\[missing indicator\s+(i[1-9][0-9]*)\]/gi;

function targetRefNumber(ref) {
  const hit = String(ref || '').match(TARGET_REF_RE);
  return hit ? Number(hit[1]) : 0;
}

/** Return a deduped target list with stable local refs (`i1`, `i2`, ...). */
export function normalizeTargetRefs(rawTargets, fallbackSelector, fallbackText) {
  const source = Array.isArray(rawTargets) && rawTargets.length
    ? rawTargets
    : (fallbackSelector ? [{ selector: fallbackSelector, text: fallbackText || '' }] : []);
  const out = [];
  const selectors = new Set();
  const refs = new Set();
  let next = 1;

  for (const raw of source) {
    if (!raw || !raw.selector || selectors.has(raw.selector)) continue;
    selectors.add(raw.selector);
    let ref = String(raw.ref || '');
    const refNumber = targetRefNumber(ref);
    if (!refNumber || refs.has(ref)) {
      while (refs.has(`i${next}`)) next++;
      ref = `i${next}`;
    }
    refs.add(ref);
    next = Math.max(next, targetRefNumber(ref) + 1);
    out.push({ ref, selector: raw.selector, text: raw.text || '' });
  }
  return out;
}

/** Normalize the lightweight response attached to one annotation. */
export function normalizeAnnotationReply(raw) {
  if (raw == null) return undefined;
  const source = typeof raw === 'string' ? { content: raw } : raw;
  if (!source || typeof source !== 'object') return undefined;
  const content = String(source.content || '').trim();
  if (!content) return undefined;
  const author = source.author === 'user' ? 'user' : 'agent';
  const reply = { content, author };
  if (typeof source.updated_at === 'string' && source.updated_at) {
    reply.updated_at = source.updated_at;
  }
  return reply;
}

export function nextTargetRef(targets) {
  let max = 0;
  for (const target of Array.isArray(targets) ? targets : []) {
    max = Math.max(max, targetRefNumber(target && target.ref));
  }
  return `i${max + 1}`;
}

export function targetContentToDisplay(text, targets) {
  const known = new Set((Array.isArray(targets) ? targets : []).map((target) => target.ref));
  return String(text || '').replace(TARGET_STORE_RE, (_, ref) => (
    known.has(ref) ? `[indicator ${targetRefNumber(ref)}]` : `[missing indicator ${ref}]`
  ));
}

export function targetContentToStorage(text, targets) {
  const known = new Set((Array.isArray(targets) ? targets : []).map((target) => target.ref));
  return String(text || '')
    .replace(TARGET_MISSING_DISPLAY_RE, (_, ref) => `[@t:${ref}]`)
    .replace(TARGET_DISPLAY_RE, (full, number) => {
      const ref = `i${Number(number)}`;
      return known.has(ref) ? `[@t:${ref}]` : full;
    });
}

export function removeTargetContentRef(text, ref) {
  const number = targetRefNumber(ref);
  if (!number) return String(text || '');
  const escapedRef = String(ref).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return String(text || '')
    .replace(new RegExp(`\\[@t:${escapedRef}\\]`, 'gi'), '')
    .replace(new RegExp(`\\[indicator\\s+${number}\\]`, 'gi'), '')
    .replace(new RegExp(`\\[missing indicator\\s+${escapedRef}\\]`, 'gi'), '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.;:!?，。；：！？])/g, '$1')
    .trimStart();
}

export function formatPageIndicator(pageId) {
  return `@page:${String(pageId || '').trim()}`;
}

export function formatSectionIndicator(pageId, sectionId) {
  return `@section:${String(pageId || '').trim()}/${String(sectionId || '').trim()}`;
}

export function formatFrameIndicator(pageId, screenId) {
  return `@frame:${String(pageId || '').trim()}/${String(screenId || '').trim()}`;
}

export function formatAnnotationIndicator(id) {
  return `@a:${String(id || '').trim()}`;
}

/**
 * @returns {{ kind: 'page'|'section'|'frame'|'annotation', pageId?: string, sectionId?: string, screenId?: string, id?: string } | null}
 */
export function parseIndicator(text) {
  const raw = String(text || '').trim();
  let m = raw.match(new RegExp(`^@page:(${ID_RE})$`));
  if (m) return { kind: 'page', pageId: m[1] };
  m = raw.match(new RegExp(`^@section:(${ID_RE})/(${ID_RE})$`));
  if (m) return { kind: 'section', pageId: m[1], sectionId: m[2] };
  m = raw.match(new RegExp(`^@frame:(${ID_RE})/(${ID_RE})$`));
  if (m) return { kind: 'frame', pageId: m[1], screenId: m[2] };
  m = raw.match(new RegExp(`^@a:(${ID_RE})$`));
  if (m) return { kind: 'annotation', id: m[1] };
  return null;
}

/** True when annotation `a` falls under parsed indicator `ind`.
 * Scope kinds (@page/@section/@frame) require a.pageId === ind.pageId.
 * Annotations missing pageId never match a scope indicator (no cross-page soft match).
 */
export function annotationMatchesIndicator(a, ind) {
  if (!a || !ind) return false;
  if (ind.kind === 'annotation') return !!ind.id && a.id === ind.id;

  if (!ind.pageId || !a.pageId || a.pageId !== ind.pageId) return false;
  if (ind.kind === 'page') return true;
  if (ind.kind === 'section') {
    const section = a.section || a.group;
    return !!ind.sectionId && section === ind.sectionId;
  }
  if (ind.kind === 'frame') {
    return !!ind.screenId && a.screenId === ind.screenId;
  }
  return false;
}

/**
 * Normalize one annotation for disk / API (new shape).
 * Dual-reads legacy comment/group/groupLabel and [@m:] mentions.
 */
export function normalizeAnnotation(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  const a = { ...raw };

  if (a.content == null && a.comment != null) a.content = a.comment;
  delete a.comment;

  if (a.section == null && a.group != null) a.section = a.group;
  if (a.sectionLabel == null && a.groupLabel != null) a.sectionLabel = a.groupLabel;
  delete a.group;
  delete a.groupLabel;

  if (typeof a.content === 'string' && a.content) {
    a.content = a.content.replace(/\[@m:([a-z0-9]+)\]/gi, '[@a:$1]');
  }
  if (Array.isArray(a.mentions)) {
    a.mentions = a.mentions.map((id) => String(id));
  }

  const reply = normalizeAnnotationReply(a.reply);
  if (reply) a.reply = reply;
  else delete a.reply;

  if (a.type === 'element' || a.selector || (Array.isArray(a.targets) && a.targets.length)) {
    const targets = normalizeTargetRefs(a.targets, a.selector, a.text);
    if (targets.length) {
      a.type = a.type || 'element';
      a.targets = targets;
      a.selector = targets[0].selector;
      a.text = targets[0].text;
    }
  }

  return a;
}

/** Pick annotations array from a doc that may use annotations or legacy marks. */
export function annotationsFromDoc(doc) {
  if (!doc || typeof doc !== 'object') return [];
  if (Array.isArray(doc.annotations)) return doc.annotations;
  if (Array.isArray(doc.marks)) return doc.marks;
  return [];
}

/** Normalize a full document to the new on-disk shape. */
export function normalizeDoc(doc, pageSlug) {
  const annotations = annotationsFromDoc(doc).map(normalizeAnnotation);
  return {
    page: (doc && doc.page) || pageSlug || 'index',
    path: (doc && doc.path) || '',
    updated_at: (doc && doc.updated_at) || null,
    revision: doc && Number.isInteger(doc.revision) && doc.revision >= 0 ? doc.revision : 0,
    annotations,
  };
}

/**
 * Best indicator to copy for an open annotation box.
 * Uses optional indicatorKind: 'page' | 'section' | 'frame' | 'annotation'.
 * When `persisted` is false, never emit `@a:` (unsaved id is not on disk yet) —
 * fall back to the best available scope indicator.
 */
export function indicatorForAnnotation(a, fallbackPageId, opts) {
  if (!a) return '';
  const pageId = a.pageId || fallbackPageId || '';
  const kind = a.indicatorKind || 'annotation';
  const section = a.section || a.group;
  const persisted = !opts || opts.persisted !== false;

  function scopeFallback() {
    if (pageId && section) return formatSectionIndicator(pageId, section);
    if (pageId && a.screenId) return formatFrameIndicator(pageId, a.screenId);
    if (pageId) return formatPageIndicator(pageId);
    return '';
  }

  if (!persisted) {
    if (kind === 'page' && pageId) return formatPageIndicator(pageId);
    if (kind === 'section' && pageId && section) return formatSectionIndicator(pageId, section);
    if (kind === 'frame' && pageId && a.screenId) return formatFrameIndicator(pageId, a.screenId);
    return scopeFallback();
  }

  if (kind === 'page' && pageId) return formatPageIndicator(pageId);
  if (kind === 'section' && pageId && section) return formatSectionIndicator(pageId, section);
  if (kind === 'frame' && pageId && a.screenId) return formatFrameIndicator(pageId, a.screenId);
  if (a.id) return formatAnnotationIndicator(a.id);
  return '';
}
