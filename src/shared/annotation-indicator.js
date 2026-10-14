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
 *
 * pp2 标注状态机（2026-09-22 立，2026-09-23 放开 owner 直接关闭）：升档走
 * open → check / done（agent，mark 端点）；owner 完成单击可从 open / check / done
 * 任一态入 close，close 可撤销回关闭前的原态。写状态的只有两条路：工作台编辑 /
 * 单击（走 /save 整写）与 ppnt mark（走 /api/annotations/:page/:id/status）——
 * 两条路各有自己的合法转换表。
 */

/** 四态。缺省 open。 */
export const ANNOTATION_STATUSES = ['open', 'check', 'done', 'close'];

function normalizeStatus(value) {
  return ANNOTATION_STATUSES.includes(value) ? value : 'open';
}

/** /save 整写的合法转换：owner 完成（open / check / done → close，工作台单击）、
 * close 撤销 / 重新打开（→ open / check / done）、恒等。升档（→ check / done）
 * 与无编辑的 →open 仍不放行（review R14）：前者只经 mark 端点，后者防止直写
 * /save 的 agent 静默把 check / done 降回 open —— 编辑强制回 open 由 save 在
 * 判「变」后另行赋值。 */
export function isLegalTransition(from, to) {
  if (from === to) return true;
  if (from === 'close') return to !== 'close';
  return to === 'close';
}

/** mark 端点的合法转换：open / check → check / done。 */
export function isLegalMarkTransition(from, to) {
  return (from === 'open' || from === 'check') && (to === 'check' || to === 'done');
}

/** 「清空」的目标行（决定 #11）：close 是执行历史，清空不带走 —— 只清
 *  open / check / done。「当前页」过滤归调用方（页面归属只有 client 知道），
 *  页内工具条「清空标记」与工作台「清空未关闭标注」同一份口径。 */
export function isClearableMark(mark) {
  if (!mark) return false;
  return (mark.status || 'open') !== 'close';
}

const ID_RE = '[A-Za-z0-9._-]+';
const TARGET_REF_RE = /^i([1-9][0-9]*)$/;
const TARGET_STORE_RE = /\[@t:(i[1-9][0-9]*)\]/gi;
const TARGET_DISPLAY_RE = /\[indicator\s+([1-9][0-9]*)\]/gi;
const TARGET_MISSING_DISPLAY_RE = /\[missing indicator\s+(i[1-9][0-9]*)\]/gi;

function targetRefNumber(ref) {
  const hit = String(ref || '').match(TARGET_REF_RE);
  return hit ? Number(hit[1]) : 0;
}

/** Return a deduped target list with stable local refs (`i1`, `i2`, ...).
 *  ppId（决定 #15）：编译页锚点的源码稳定 id（data-pp-id 的值），随 target
 *  透传 —— 同一元素必然同一个值，按 selector 去重已覆盖 ppId 撞车。 */
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
    const target = { ref, selector: raw.selector, text: raw.text || '' };
    if (typeof raw.ppId === 'string' && raw.ppId) target.ppId = raw.ppId;
    if (typeof raw.screenId === 'string' && raw.screenId) target.screenId = raw.screenId;
    out.push(target);
  }
  return out;
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

/**
 * Normalize one annotation for disk / API。只认现行字段：磁盘上的账本没有旧字段
 * （comment / group / groupLabel、[@m:] mention），这里不做读侧升级。
 */
export function normalizeAnnotation(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  const a = { ...raw };

  // pp2 状态机：status 归一，缺省 open；n / lastRect 透传。
  a.status = normalizeStatus(a.status);

  if (Array.isArray(a.mentions)) {
    a.mentions = a.mentions.map((id) => String(id));
  }

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

/** Pick annotations array from a doc. */
export function annotationsFromDoc(doc) {
  if (!doc || typeof doc !== 'object') return [];
  return Array.isArray(doc.annotations) ? doc.annotations : [];
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
