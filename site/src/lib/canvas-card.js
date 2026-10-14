/**
 * Section card model (common-m1.md §3). Pure, no Node imports: Canvas.astro
 * renders from it, the browser script (canvas-card-client.js) counts badges
 * with it, node --test covers it.
 */

/**
 * Frame preview inside the card and the overlay: same-origin render endpoint,
 * annotation client off, embed mode (no caption; the stage carries
 * data-pp-stage, the phone body data-pp-device — what the browser side measures).
 */
export const frameSrc = (pageId, frameId) =>
  `/api/frame?page=${encodeURIComponent(pageId)}&screen=${encodeURIComponent(frameId)}&annotate=off&embed=card`;

/** Workbench canvas view of the article; with a section id it scrolls to that row (M0-D). */
export const canvasHref = (pageId, sectionId) =>
  `/?page=${encodeURIComponent(pageId)}${sectionId ? `&section=${encodeURIComponent(sectionId)}` : ''}`;

/** The read-only annotation endpoint for a bucket's canvas ledger (src/server/annotate-api.js). */
export const canvasLedgerUrl = (pageId) => `/annotations/%40canvas?entry=${encodeURIComponent(pageId)}`;

/**
 * Preview geometry per shell. One scale for every frame in a card, so a bare
 * component and the phones beside it keep their real proportions: the phone
 * stage (the workbench's 438 × 910 iPhone chrome, --wb-phone-w × --wb-phone-h)
 * shown 158 px wide. `width` × `height` is the iframe's layout box before the
 * frame is measured; after load the client measures the stage
 * ([data-pp-stage]) and keeps the scale (comp stage is max-content ≤ 420 px).
 */
export const CARD_SCALE = 158 / 438;
export const PHONE = { width: 438, height: 910, scale: CARD_SCALE };
const NATURAL = {
  comp: { width: 480, height: 320, scale: CARD_SCALE },
  doc: { width: 1280, height: 900, scale: CARD_SCALE },
};
export function shellBox(shell) {
  if (!shell || shell === 'app' || shell === 'lock') return { mode: 'phone', ...PHONE };
  return { mode: 'natural', ...(NATURAL[shell] || NATURAL.comp) };
}

/**
 * articleCanvas errors → { section, frame?, message }; no `section` = a page-level error.
 * A figure's errors (code figure_…) are left out: the figure shows them in its own place (figure.js).
 */
export function normalizeErrors(errors) {
  return (errors || [])
    .filter((e) => !/^figure_/.test(String(e?.code || '')))
    .map((e) => ({ section: e.section ?? null, frame: e.frame, message: String(e.message ?? '') }));
}

/** Errors that belong to no section: the article page shows them at the top. */
export function looseErrors(canvas) {
  return normalizeErrors(canvas?.errors).filter((e) => !e.section).map((e) => e.message);
}

/**
 * → { pageId, sectionId, num, title, shell, box, frames: [{ id, title, src, missing, shell, box }], href, meta, errors: [message] }
 * `num` is the section's number in the article (1, 2 …; remark-pinpoint
 * injects it next to `section`). The article shows numbers only: the canvas
 * letters (`letter`, frame `ref` like B1) stay in articleCanvas for the
 * workbench and are left out here, so a reader never sees a letter that does
 * not match the TOC.
 * `shell` / `box` on the card are the section's; each frame has its own: a
 * frame file's `export const shell = "…"` (articleCanvas frame `shell`) wins
 * over the section's, so one card can hold phones and bare components.
 * `sectionId` is the enclosing <Section> (the remark pass injects it). A Canvas
 * outside any Section has none: articleCanvas reports that as a page-level
 * error (banner), so the model is `stray` and the card renders nothing.
 * A frame with no source file keeps its place (`missing`): the card shows a
 * placeholder tile instead of a preview, like the canvas does.
 */
export function cardModel(canvas, sectionId, num = '') {
  const pageId = canvas?.pageId || '';
  if (!sectionId) {
    return { pageId, stray: true, sectionId: '', num: '', title: '', frames: [], href: '', meta: '', box: shellBox(), errors: [] };
  }
  const section = (canvas?.sections || []).find((s) => s.id === sectionId);
  const errors = normalizeErrors(canvas?.errors).filter((e) => e.section === sectionId).map((e) => e.message);
  if (!section && !errors.length) errors.push(`画布里没有这一节（section "${sectionId}"）`);
  const frames = (section?.frames || []).map((f) => {
    const shell = f.shell || section?.shell || '';
    return {
      id: f.id, title: f.title || f.id, missing: !!f.missing, src: f.missing ? '' : frameSrc(pageId, f.id),
      shell, box: shellBox(shell),
    };
  });
  return {
    pageId,
    sectionId,
    num: num ? String(num) : '',
    title: section?.title || sectionId,
    shell: section?.shell || '',
    box: shellBox(section?.shell),
    frames,
    href: pageId ? canvasHref(pageId, sectionId) : '',
    meta: `${frames.length} 帧`,
    errors,
  };
}

/** Open (unhandled) canvas annotations on these frames; rows without status count as open. */
export function openCount(doc, pageId, frameIds) {
  const ids = new Set(frameIds);
  return (doc?.annotations || []).filter((a) => a && (a.status || 'open') === 'open'
    && ids.has(a.screenId) && (!a.pageId || a.pageId === pageId)).length;
}
