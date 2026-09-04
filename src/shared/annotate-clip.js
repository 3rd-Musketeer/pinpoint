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
 * Clamp a point into rect (inclusive left/top, exclusive of overflowing past right/bottom by keeping inside).
 * @param {number} x
 * @param {number} y
 * @param {[number,number,number,number]} r
 * @returns {[number, number]}
 */
export function clampPointToRect(x, y, r) {
  const maxX = r[0] + Math.max(0, r[2] - 1);
  const maxY = r[1] + Math.max(0, r[3] - 1);
  return [
    Math.min(Math.max(x, r[0]), maxX),
    Math.min(Math.max(y, r[1]), maxY),
  ];
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
