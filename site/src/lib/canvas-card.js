/**
 * Section card model (common-m1.md §3). Pure, no Node imports: Canvas.astro
 * renders from it, the browser script (canvas-card-client.js) counts badges
 * with it, node --test covers it.
 */

/** Frame preview inside the card: same-origin render endpoint, annotation client off. */
export const frameSrc = (pageId, frameId) =>
  `/api/frame?page=${encodeURIComponent(pageId)}&screen=${encodeURIComponent(frameId)}&annotate=off`;

/** Workbench canvas view of the article; with a section id it scrolls to that row (M0-D). */
export const canvasHref = (pageId, sectionId) =>
  `/?page=${encodeURIComponent(pageId)}${sectionId ? `&section=${encodeURIComponent(sectionId)}` : ''}`;

/** The read-only annotation endpoint for a bucket's canvas ledger (src/server/annotate-api.js). */
export const canvasLedgerUrl = (pageId) => `/annotations/%40canvas?entry=${encodeURIComponent(pageId)}`;

/**
 * Shells that are not the 393×852 phone. The card sizes these to the frame's
 * own box (measured after load); `width` is the iframe's layout width before
 * measuring (comp stage is max-content, ≤ 420 px in index.html), `scale` the
 * preview scale, `height` the fallback height until measured.
 */
export const PHONE = { width: 393, height: 852, scale: 158 / 393 };
const NATURAL = {
  comp: { width: 480, height: 360, scale: 0.6 },
  doc: { width: 1280, height: 900, scale: 0.25 },
};
export function shellBox(shell) {
  if (!shell || shell === 'app' || shell === 'lock') return { mode: 'phone', ...PHONE };
  return { mode: 'natural', ...(NATURAL[shell] || NATURAL.comp) };
}

/** Errors from articleCanvas: strings (no section) or { section | sectionId, frame?, message }. */
export function normalizeErrors(errors) {
  return (errors || []).map((e) => (typeof e === 'string'
    ? { section: null, message: e }
    : { section: e.section ?? e.sectionId ?? null, frame: e.frame, message: String(e.message ?? e.error ?? e) }));
}

/** Errors that belong to no section: the article page shows them at the top. */
export function looseErrors(canvas) {
  return normalizeErrors(canvas?.errors).filter((e) => !e.section).map((e) => e.message);
}

/**
 * → { pageId, sectionId, letter, title, shell, box, frames: [{ id, ref, title, src }], href, meta, errors: [message] }
 * `sectionId` is the enclosing <Section> (the remark pass injects it).
 */
export function cardModel(canvas, sectionId) {
  const pageId = canvas?.pageId || '';
  if (!sectionId) {
    return { pageId, sectionId: '', letter: '', title: '', frames: [], href: '', meta: '', box: shellBox(), errors: ['<Canvas> 要写在 <Section> 里，卡片才知道显示哪一节'] };
  }
  const section = (canvas?.sections || []).find((s) => s.id === sectionId);
  const errors = normalizeErrors(canvas?.errors).filter((e) => e.section === sectionId).map((e) => e.message);
  if (!section && !errors.length) errors.push(`画布里没有这一节（section "${sectionId}"）`);
  const frames = (section?.frames || []).map((f) => ({ id: f.id, ref: f.ref || '', title: f.title || f.id, src: frameSrc(pageId, f.id) }));
  const refs = frames.map((f) => f.ref).filter(Boolean);
  const range = refs.length > 1 ? `${refs[0]}–${refs[refs.length - 1]}` : refs[0] || '';
  return {
    pageId,
    sectionId,
    letter: section?.letter || '',
    title: section?.title || sectionId,
    shell: section?.shell || '',
    box: shellBox(section?.shell),
    frames,
    href: pageId ? canvasHref(pageId, sectionId) : '',
    meta: [range, `${frames.length} 帧`].filter(Boolean).join(' · '),
    errors,
  };
}

/** Open (unhandled) canvas annotations on these frames; rows without status count as open. */
export function openCount(doc, pageId, frameIds) {
  const ids = new Set(frameIds);
  return (doc?.annotations || []).filter((a) => a && (a.status || 'open') === 'open'
    && ids.has(a.screenId) && (!a.pageId || a.pageId === pageId)).length;
}
