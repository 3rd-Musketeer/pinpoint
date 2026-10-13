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
 * Preview geometry per shell. `width` × `height` is the iframe's layout box
 * before the frame is measured, shown at `scale`. After load the client
 * measures the frame's stage: the phone (393×852 plus bezel) is fitted to a
 * fixed `fitWidth` (158 px, the preview's look); other shells (comp stage is
 * max-content ≤ 420 px in index.html) keep `scale` and take their own box.
 */
export const PHONE = { width: 393, height: 852, scale: 158 / 393, fitWidth: 158 };
const NATURAL = {
  comp: { width: 480, height: 320, scale: 0.75 },
  doc: { width: 1280, height: 900, scale: 0.25 },
};
export function shellBox(shell) {
  if (!shell || shell === 'app' || shell === 'lock') return { mode: 'phone', ...PHONE };
  return { mode: 'natural', ...(NATURAL[shell] || NATURAL.comp) };
}

/** articleCanvas errors → { section, frame?, message }; no `section` = a page-level error. */
export function normalizeErrors(errors) {
  return (errors || []).map((e) => (typeof e === 'string'
    ? { section: null, message: e }
    : { section: e.section ?? null, frame: e.frame, message: String(e.message ?? e) }));
}

/** Errors that belong to no section: the article page shows them at the top. */
export function looseErrors(canvas) {
  return normalizeErrors(canvas?.errors).filter((e) => !e.section).map((e) => e.message);
}

/**
 * The article page's error banner, each canvas error shown once. The project's
 * errors (`p.errors`, from listProjects via the projects collection, each
 * line prefixed `project "<id>": `) repeat every error of this article as
 * `articles/<article>/…：…`, and articleCanvas returns the same ones without
 * that prefix: section errors go to that section's card, the rest
 * (looseErrors) to the banner. So this article's lines are dropped here;
 * errors of other articles and of the project itself stay.
 */
export function bannerErrors(projectErrors, articleId, canvas) {
  const prefix = `articles/${articleId}`;
  const mine = (raw) => {
    const e = String(raw).replace(/^project "[^"]*": /, '');
    return e.startsWith(`${prefix}/`) || e.startsWith(`${prefix}：`);
  };
  return [...(projectErrors || []).filter((e) => !mine(e)), ...looseErrors(canvas)];
}

/**
 * → { pageId, sectionId, letter, title, shell, box, frames: [{ id, ref, title, src, missing }], href, meta, errors: [message] }
 * `sectionId` is the enclosing <Section> (the remark pass injects it). A Canvas
 * outside any Section has none: articleCanvas reports that as a page-level
 * error (banner), so the model is `stray` and the card renders nothing.
 * A frame with no source file keeps its place and number (`missing`): the card
 * shows a placeholder tile instead of a preview, like the canvas does.
 */
export function cardModel(canvas, sectionId) {
  const pageId = canvas?.pageId || '';
  if (!sectionId) {
    return { pageId, stray: true, sectionId: '', letter: '', title: '', frames: [], href: '', meta: '', box: shellBox(), errors: [] };
  }
  const section = (canvas?.sections || []).find((s) => s.id === sectionId);
  const errors = normalizeErrors(canvas?.errors).filter((e) => e.section === sectionId).map((e) => e.message);
  if (!section && !errors.length) errors.push(`画布里没有这一节（section "${sectionId}"）`);
  const frames = (section?.frames || []).map((f) => ({
    id: f.id, ref: f.ref || '', title: f.title || f.id, missing: !!f.missing, src: f.missing ? '' : frameSrc(pageId, f.id),
  }));
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
