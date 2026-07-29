/**
 * Pure gutter (sidebar) packer for comment bubbles.
 * Shared by live workbench gutter rendering and server-side export bake.
 *
 * Input anchors use document / overlay coordinates: [x, y, w, h].
 * Bubbles stack in a single right column.
 *
 * sortBy:
 *   - 'y' (default, live): sort by anchor Y, then numeric n. Keeps bubbles
 *     near on-screen anchors.
 *   - 'n' (export): sort by numeric annotation number. Same-row grid peers
 *     stay in authoring order (avoids "7,8 vanished" when string sort put
 *     "11"/"12" before "7"/"8", or Y-sort interleaved other columns).
 */

export const GUTTER_BUBBLE_W = 240;
export const GUTTER_MARGIN = 12;
export const GUTTER_GAP = 10;
export const GUTTER_W = GUTTER_BUBBLE_W + GUTTER_MARGIN * 2; // 264

function numericN(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

/**
 * @param {Array<{n: number|string, rect: [number, number, number, number]}>} anchors
 * @param {Record<string|number, number>|Map} heights  measured bubble heights keyed by n
 * @param {{docW?: number, bubbleW?: number, margin?: number, gap?: number, fallbackHeight?: number, bubbleLeft?: number, sortBy?: 'y'|'n'}} [opts]
 * @returns {Array<{n: number|string, left: number, top: number, width: number, height: number, line: {x1:number,y1:number,x2:number,y2:number}}>}
 */
export function packGutter(anchors, heights, opts) {
  opts = opts || {};
  const bubbleW = opts.bubbleW != null ? opts.bubbleW : GUTTER_BUBBLE_W;
  const margin = opts.margin != null ? opts.margin : GUTTER_MARGIN;
  const gap = opts.gap != null ? opts.gap : GUTTER_GAP;
  const fallbackH = opts.fallbackHeight != null ? opts.fallbackHeight : 60;
  const docW = opts.docW != null ? opts.docW : 0;
  const sortBy = opts.sortBy === 'n' ? 'n' : 'y';

  function heightOf(n) {
    if (heights && typeof heights.get === 'function') {
      const v = heights.get(n);
      if (v > 0) return v;
      // Map may have been keyed with string n from data attributes.
      const v2 = heights.get(String(n));
      return v2 > 0 ? v2 : fallbackH;
    }
    if (heights && heights[n] > 0) return heights[n];
    if (heights && heights[String(n)] > 0) return heights[String(n)];
    return fallbackH;
  }

  const list = (Array.isArray(anchors) ? anchors : [])
    .filter((a) => a && a.rect && a.rect.length >= 4)
    .slice()
    .sort((p, q) => {
      if (sortBy === 'n') return numericN(p.n) - numericN(q.n);
      const dy = p.rect[1] - q.rect[1];
      if (dy) return dy;
      // Numeric tie-break — NEVER String.localeCompare ("11" < "7").
      return numericN(p.n) - numericN(q.n);
    });

  const bubbleLeft = docW > 0
    ? docW + margin
    : (opts.bubbleLeft != null ? opts.bubbleLeft : margin);

  let nextTop = margin;
  const out = [];
  for (const an of list) {
    const [ax, ay, aw, ah] = an.rect;
    const h = heightOf(an.n);
    const desired = Math.max(margin, ay);
    const top = Math.max(desired, nextTop);
    const lineY = top + Math.min(22, h / 2);
    out.push({
      n: an.n,
      left: bubbleLeft,
      top,
      width: bubbleW,
      height: h,
      line: {
        x1: ax + aw,
        y1: ay + ah / 2,
        x2: bubbleLeft,
        y2: lineY,
      },
    });
    nextTop = top + h + gap;
  }
  return out;
}
