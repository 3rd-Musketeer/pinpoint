/**
 * Layout errors on the site (docs/projects.md“读取”): listProjects hands them over as
 * objects `{ code, message, path?, section?, frame?, line? }` (src/shared/project-errors.js);
 * this is the one place the site turns them into lines. Server side only (the
 * browser scripts never import repo code, see site/README.md).
 */
import { formatProjectError, isArticleError } from '../../../src/shared/project-errors.js';
import { looseErrors } from './canvas-card.js';

/** One layout error as the site prints it (logger, error banners): `project "<id>": <line>`. */
export const projectErrorLine = (projectId, error) => `project "${projectId}": ${formatProjectError(error)}`;

/**
 * The article page's error banner, each error shown once. articleCanvas
 * returns this article's own errors (every project error whose path is under
 * `articles/<article>`): section errors go to that section's card, the rest
 * (looseErrors) to the banner. The project's other errors (other articles,
 * wiki entries, project.json, name collisions) are listed as project lines.
 */
export function bannerErrors(projectId, projectErrors, articleId, canvas) {
  const others = (projectErrors || []).filter((e) => !isArticleError(e, articleId));
  return [...others.map((e) => projectErrorLine(projectId, e)), ...looseErrors(canvas)];
}
