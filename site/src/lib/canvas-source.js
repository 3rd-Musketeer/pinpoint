/**
 * The site's one door to "an article's canvas" (common-m1.md §2, §3).
 *
 *   articleCanvas(projectId, articleId) → { pageId, sections: [{ id, title, letter, shell?, frames: [{ id, ref, title? }] }], errors }
 *   articlePageId(projectId, articleId) → the auto-generated page id (= annotation bucket)
 *
 * Package E provides both in src/server/lib/projects.js. Until it lands they
 * come from canvas-stub.js (same shape, read from the MDX). Swapping is this one
 * line:
 *   export { articleCanvas, articlePageId } from '../../../src/server/lib/projects.js';
 * Callers `await` articleCanvas, so a sync or async implementation both work.
 */
export { articleCanvas, articlePageId } from './canvas-stub.js';
