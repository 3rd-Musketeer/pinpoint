/**
 * Lasso hit-test helpers. Pure (no DOM) so they can be node-tested.
 * `pickContained` keeps the outermost elements fully inside a lasso rect,
 * mirroring the pre-refactor regionContains semantics.
 */

/** Tolerance in px so borders/rounding don't drop edge-touching elements. */
const TOL = 2;
const MAX = 12;

function inside(r, rect) {
  return (
    r[0] >= rect[0] - TOL &&
    r[1] >= rect[1] - TOL &&
    r[0] + r[2] <= rect[0] + rect[2] + TOL &&
    r[1] + r[3] <= rect[1] + rect[3] + TOL
  );
}

/**
 * @param {Array<{rect:[number,number,number,number], selector:string, parentSelector?:string, text?:string}>} candidates
 * @param {[number,number,number,number]} rect lasso in doc coords
 * @returns {Array<{selector:string, text?:string}>} outermost contained, capped at 12
 */
export function pickContained(candidates, rect) {
  const out = [];
  const seen = Object.create(null);
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const r = c.rect;
    if (!r || !r[2] || !r[3]) continue;
    if (!inside(r, rect)) continue;
    // Skip descendants of an already-kept outermost element.
    if (c.parentSelector && seen[c.parentSelector]) continue;
    seen[c.selector] = 1;
    out.push({ selector: c.selector, text: c.text });
    if (out.length >= MAX) break;
  }
  return out;
}
