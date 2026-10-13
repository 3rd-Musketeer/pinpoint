/**
 * The site's one door to "an article's canvas" (common-m1.md §2, §3), from the
 * service code (src/server/lib/article-board.js, docs/projects.md「文章的画布」):
 *
 *   articleCanvas(projectId, articleId) → { pageId, sections: [{ id, title, letter, shell?, frames: [{ id, ref, missing? }] }], errors: [{ message, line?, section?, frame? }] }
 *   articlePageId(projectId, articleId) → `<project>_<article>`, the canvas page id (= annotation bucket)
 *
 * articleCanvas reads the registry the way the site does (PINPOINT_REGISTRY,
 * else ~/.pinpoint/registry.json).
 */
export { articleCanvas, articlePageId } from '../../../src/server/lib/projects.js';
