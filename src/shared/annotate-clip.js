/**
 * Clip annotation geometry to scroll/overflow ancestors.
 * Pure (no DOM) so node tests and the inlined /annotate.js share one impl.
 * Rect shape: [x, y, w, h] in the same coordinate space (viewport or overlay).
 */

/** Min intersection edge (px) to treat a mark part as visible. */
export const CLIP_MIN_PX = 2;

/**
 * @param {[number,number,number,number]|null|undefined} a
 * @param {[number,number,number,number]|null|undefined} b
 * @returns {[number,number,number,number]|null}
 */
export function intersectRects(a, b) {
  if (!a || !b) return null;
  const ax2 = a[0] + a[2];
  const ay2 = a[1] + a[3];
  const bx2 = b[0] + b[2];
  const by2 = b[1] + b[3];
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(ax2, bx2);
  const y2 = Math.min(ay2, by2);
  const w = x2 - x1;
  const h = y2 - y1;
  if (w <= 0 || h <= 0) return null;
  return [x1, y1, w, h];
}

/**
 * Intersect `target` with every clip rect (skip null/undefined clips).
 * @param {[number,number,number,number]|null|undefined} target
 * @param {Array<[number,number,number,number]|null|undefined>} clips
 * @returns {[number,number,number,number]|null}
 */
export function clipByRects(target, clips) {
  if (!target) return null;
  let out = target;
  if (!clips || !clips.length) return out;
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i];
    if (!c) continue;
    out = intersectRects(out, c);
    if (!out) return null;
  }
  return out;
}

/**
 * @param {[number,number,number,number]|null|undefined} r
 * @param {number} [minPx]
 */
export function isVisibleEnough(r, minPx) {
  const min = minPx == null ? CLIP_MIN_PX : minPx;
  return !!(r && r[2] >= min && r[3] >= min);
}

/**
 * Preferred badge anchor: top-right of clipped frame, clamped inside.
 * @param {[number,number,number,number]} local clipped overlay/viewport rect
 * @param {number} [badgeHalf] half badge size (default 11 for 22px badge)
 * @returns {{ left: number, top: number }}
 */
export function badgePositionForRect(local, badgeHalf) {
  const half = badgeHalf == null ? 11 : badgeHalf;
  // Prefer top-right of the clipped frame; keep the badge overlapping it.
  const left = Math.min(
    Math.max(local[0] + local[2] - half, local[0] - half),
    local[0] + local[2] - half,
  );
  const top = Math.min(
    Math.max(local[1] - half, local[1] - half),
    local[1] + local[3] - half,
  );
  return { left, top };
}

/** Gap (px) kept between a clamped badge and the edge of the visible box. */
export const BADGE_EDGE_PX = 4;

/**
 * Badge anchor that never leaves the visible box (2026-10-15: a mark on a block flush
 * with the viewport's right edge had its pin half cut off by the overlay's overflow).
 * The preferred spot (badgePositionForRect) sits half outside the frame's top-right
 * corner; when the frame is inside `box`, pull the badge in so the whole 22px disc
 * stays `margin` px inside. A frame that does not intersect `box` keeps the preferred
 * spot (off-screen marks must not pile up on the edge). `box` null = no clamping.
 * @param {[number,number,number,number]} local frame rect (same space as box)
 * @param {[number,number,number,number]|null|undefined} box visible area
 * @param {number} [badgeHalf]
 * @param {number} [margin]
 * @returns {{ left: number, top: number }}
 */
export function badgePositionInBox(local, box, badgeHalf, margin) {
  const half = badgeHalf == null ? 11 : badgeHalf;
  const m = margin == null ? BADGE_EDGE_PX : margin;
  const pos = badgePositionForRect(local, half);
  if (!box || !(box[2] > 0) || !(box[3] > 0) || !intersectRects(local, box)) return pos;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, Math.max(lo, hi)));
  return {
    left: clamp(pos.left, box[0] + m, box[0] + box[2] - 2 * half - m),
    top: clamp(pos.top, box[1] + m, box[1] + box[3] - 2 * half - m),
  };
}

/**
 * Outward pad (px) around mark boxes so the 2px border clears glyphs.
 * Shared by live overlay + export bake. Hover ghost stays flush for hit precision.
 */
export const MARK_BOX_PAD_PX = 4;

/**
 * Expand a [x,y,w,h] rect outward by `pad` on each side.
 * @param {[number,number,number,number]|null|undefined} rect
 * @param {number} [pad]
 * @returns {[number,number,number,number]|null}
 */
export function expandRect(rect, pad) {
  if (!rect) return null;
  const p = pad == null ? MARK_BOX_PAD_PX : pad;
  if (!p) return [rect[0], rect[1], rect[2], rect[3]];
  return [rect[0] - p, rect[1] - p, rect[2] + 2 * p, rect[3] + 2 * p];
}
