const ID_PATTERN = /^[a-zA-Z0-9_/-]+$/;
const MODES = new Set(['html-full', 'html-no-css', 'image']);
const FORMATS = new Set(['png', 'webp']);

export class ExportDocContractError extends Error {
  constructor(path, message) {
    super(`${path}: ${message}`);
    this.name = 'ExportDocContractError';
    this.path = path;
  }
}

function requiredString(value, path, pattern = null) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ExportDocContractError(path, 'expected a non-empty string');
  }
  const text = value.trim();
  if (pattern && !pattern.test(text)) throw new ExportDocContractError(path, `invalid value "${text}"`);
  return text;
}

function enumValue(value, path, allowed, fallback) {
  const normalized = value == null ? fallback : value;
  if (!allowed.has(normalized)) throw new ExportDocContractError(path, `unsupported value "${normalized}"`);
  return normalized;
}

/** Strip authoring <style> / stylesheet links. Keep inline style attrs (chart widths etc.). */
export function stripDocumentCss(html) {
  if (typeof html !== 'string') throw new ExportDocContractError('html', 'expected a string');
  return html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<link\b[^>]*\brel\s*=\s*["']?stylesheet["']?[^>]*>/gi, '');
}

/** Normalize a workbench doc src to a previews/-relative path (no leading slash). */
export function normalizeDocSrc(src) {
  let text = requiredString(src, 'src');
  if (/^https?:\/\//i.test(text)) {
    try { text = new URL(text).pathname; } catch {
      throw new ExportDocContractError('src', 'invalid absolute URL');
    }
  }
  text = text.replace(/^\/+/, '');
  if (!text.startsWith('previews/')) {
    throw new ExportDocContractError('src', 'must resolve under previews/');
  }
  if (text.includes('\0') || text.split('/').includes('..')) {
    throw new ExportDocContractError('src', 'path traversal is not allowed');
  }
  return text;
}

export function exportDocFilename(request) {
  const base = `${request.pageId}__${request.screenId}`.replace(/\//g, '-');
  const comments = !!request.comments;
  if (request.mode === 'html-full') {
    return comments ? `${base}.comments.html` : `${base}.html`;
  }
  if (request.mode === 'html-no-css') {
    return comments ? `${base}.comments.no-css.html` : `${base}.no-css.html`;
  }
  return comments
    ? `${base}@${request.scale}x.comments.${request.format}`
    : `${base}@${request.scale}x.${request.format}`;
}

export function exportDocMime(request) {
  if (request.mode === 'image') {
    return request.format === 'webp' ? 'image/webp' : 'image/png';
  }
  return 'text/html; charset=utf-8';
}

/** Default long-image viewport width (document column). */
export const EXPORT_DOC_W = 920;
/** Gutter width for sidebar comment bubbles in image export. */
export const EXPORT_GUTTER_W = 264;
/** Image viewport when comments are on: doc column + gutter. */
export const EXPORT_VIEWPORT_WITH_COMMENTS = EXPORT_DOC_W + EXPORT_GUTTER_W; // 1184

function commentsFlag(raw) {
  return raw === true || raw === 1 || raw === '1' || raw === 'true';
}

export function validateExportDocRequest(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ExportDocContractError('request', 'expected an object');
  }
  const mode = enumValue(raw.mode, 'mode', MODES, null);
  const pageId = requiredString(raw.pageId, 'pageId', ID_PATTERN);
  const screenId = requiredString(raw.screenId, 'screenId', ID_PATTERN);
  const src = normalizeDocSrc(raw.src);
  const format = enumValue(raw.format, 'format', FORMATS, 'png');
  const scale = Number(raw.scale == null ? 2 : raw.scale);
  if (scale !== 1 && scale !== 2) throw new ExportDocContractError('scale', 'expected 1 or 2');
  const comments = commentsFlag(raw.comments);
  const defaultViewport = comments && mode === 'image' ? EXPORT_VIEWPORT_WITH_COMMENTS : EXPORT_DOC_W;
  const viewportWidth = Number(raw.viewportWidth == null ? defaultViewport : raw.viewportWidth);
  if (!Number.isFinite(viewportWidth) || viewportWidth < 320 || viewportWidth > 2400) {
    throw new ExportDocContractError('viewportWidth', 'expected 320–2400');
  }
  return {
    mode,
    pageId,
    screenId,
    src,
    comments,
    format: mode === 'image' ? format : 'html',
    scale: mode === 'image' ? scale : 1,
    viewportWidth: mode === 'image' ? Math.round(viewportWidth) : 0,
  };
}

const TOKEN_MODES = new Set(['html-full', 'html-no-css', 'image']);

/** Text HTML uses local BPE; image mode uses vision formulas on export pixel size. */
export function validateExportDocTokenRequest(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ExportDocContractError('request', 'expected an object');
  }
  const mode = enumValue(raw.mode, 'mode', TOKEN_MODES, null);
  const src = normalizeDocSrc(raw.src);
  const comments = commentsFlag(raw.comments);
  if (mode !== 'image') return { mode, src, comments, scale: 1, viewportWidth: 0 };

  const scale = Number(raw.scale == null ? 2 : raw.scale);
  if (scale !== 1 && scale !== 2) throw new ExportDocContractError('scale', 'expected 1 or 2');
  const defaultViewport = comments ? EXPORT_VIEWPORT_WITH_COMMENTS : EXPORT_DOC_W;
  const viewportWidth = Number(raw.viewportWidth == null ? defaultViewport : raw.viewportWidth);
  if (!Number.isFinite(viewportWidth) || viewportWidth < 320 || viewportWidth > 2400) {
    throw new ExportDocContractError('viewportWidth', 'expected 320–2400');
  }
  return {
    mode,
    src,
    comments,
    scale,
    viewportWidth: Math.round(viewportWidth),
  };
}
