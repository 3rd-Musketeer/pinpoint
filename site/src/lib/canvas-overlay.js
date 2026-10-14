/**
 * Section overlay (lightbox) over the article: pure parts, no DOM. The browser
 * script (canvas-overlay-client.js) opens it from a card's frame; node --test
 * covers the hash contract and the scale rule. Contract: site/README.md
 * 「画布浮层」.
 */

/**
 * The overlay's URL hash: `#overlay=<section id>`, optionally `&frame=<frame id>`
 * (the frame to scroll to and highlight). Parsed with URLSearchParams, so ids
 * are percent-encoded when needed.
 */
export function overlayHash(sectionId, frameId) {
  const q = new URLSearchParams({ overlay: sectionId });
  if (frameId) q.set('frame', frameId);
  return `#${q.toString()}`;
}

/** `#overlay=<section>[&frame=<frame>]` → { section, frame }; anything else (TOC `#flow`, empty) → null. */
export function parseOverlayHash(hash) {
  const raw = String(hash || '').replace(/^#/, '');
  if (!raw.startsWith('overlay=')) return null;
  const q = new URLSearchParams(raw);
  const section = q.get('overlay') || '';
  if (!section) return null;
  return { section, frame: q.get('frame') || '' };
}

/**
 * One scale for every frame in the overlay, so sizes stay comparable: the
 * largest that fits every frame's natural box into the available height (and
 * width, which only binds on a phone or for wide doc frames), never above
 * `max` (1 = the frame's real size). `boxes` are natural sizes in CSS px; a box with
 * `height: null` (a document frame) fills the height, so only its width counts.
 */
export function overlayScale({ boxes, availWidth, availHeight, max = 1 }) {
  const list = (boxes || []).filter((b) => b && b.width > 0 && (b.height > 0 || b.height === null));
  if (!list.length || !(availWidth > 0) || !(availHeight > 0)) return max;
  // height: null = a document frame: it fills the available height and scrolls inside, so only its width binds.
  const heights = list.filter((b) => b.height > 0).map((b) => b.height);
  const tallest = heights.length ? Math.max(...heights) : 0;
  const widest = Math.max(...list.map((b) => b.width));
  return Math.min(max, tallest ? availHeight / tallest : max, availWidth / widest);
}

/**
 * A frame's natural box before it is measured, from its card box (shellBox):
 * a phone is the device body inside the workbench's iPhone chrome (402 × 874,
 * .ios-device inside the 438 × 910 stage of index.html), which is what the
 * overlay shows and clips to; a document frame (shell doc) keeps the page width the card is set to
 * and fills the height (`height: null`); other shells take the card's starting box.
 */
export const PHONE_STAGE = { width: 402, height: 874 };
export function naturalBox(cardBox) {
  if (cardBox.mode === 'phone') return { ...PHONE_STAGE };
  // A document frame (HTML 帧) keeps its page width and takes the overlay's full height (height: null, see overlayScale).
  if (cardBox.mode === 'doc') return { width: cardBox.width, height: null };
  return { width: cardBox.width, height: cardBox.height };
}

/** The section before / after `current` in `ids` (sections that have a canvas, article order); '' at either end. */
export function neighborSection(ids, current, step) {
  const i = (ids || []).indexOf(current);
  if (i < 0) return '';
  return ids[i + step] || '';
}
