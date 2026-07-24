const ID_PATTERN = /^[a-zA-Z0-9_/-]+$/;
const FORMATS = new Set(['webp', 'png']);
const BACKGROUNDS = new Set(['canvas', 'white', 'transparent']);
const KINDS = new Set(['frame', 'section']);

export class ExportContractError extends Error {
  constructor(path, message) {
    super(`${path}: ${message}`);
    this.name = 'ExportContractError';
    this.path = path;
  }
}

function requiredString(value, path, pattern = null) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ExportContractError(path, 'expected a non-empty string');
  }
  const text = value.trim();
  if (pattern && !pattern.test(text)) throw new ExportContractError(path, `invalid value "${text}"`);
  return text;
}

function enumValue(value, path, allowed, fallback) {
  const normalized = value == null ? fallback : value;
  if (!allowed.has(normalized)) throw new ExportContractError(path, `unsupported value "${normalized}"`);
  return normalized;
}

export function exportFilename(request) {
  const parts = [request.pageId, request.sectionId];
  if (request.kind === 'frame') parts.push(request.screenId);
  return `${parts.join('__').replace(/\//g, '-')}@${request.scale}x.${request.format}`;
}

export function exportMime(format) {
  return format === 'png' ? 'image/png' : 'image/webp';
}

export function validateExportRequest(raw, options = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ExportContractError('request', 'expected an object');
  }
  const maxHtmlBytes = options.maxHtmlBytes || 12 * 1024 * 1024;
  const kind = enumValue(raw.kind, 'kind', KINDS, 'frame');
  const pageId = requiredString(raw.pageId, 'pageId', ID_PATTERN);
  const sectionId = requiredString(raw.sectionId, 'sectionId', ID_PATTERN);
  const screenId = kind === 'frame'
    ? requiredString(raw.screenId, 'screenId', ID_PATTERN)
    : '';
  const format = enumValue(raw.format, 'format', FORMATS, 'webp');
  const scale = Number(raw.scale == null ? 2 : raw.scale);
  if (scale !== 1 && scale !== 2) throw new ExportContractError('scale', 'expected 1 or 2');
  const background = enumValue(raw.background, 'background', BACKGROUNDS, 'canvas');
  if (background === 'transparent' && format !== 'png') {
    throw new ExportContractError('background', 'transparent export requires PNG');
  }
  const html = requiredString(raw.html, 'html');
  if (Buffer.byteLength(html, 'utf8') > maxHtmlBytes) {
    throw new ExportContractError('html', `snapshot exceeds ${maxHtmlBytes} bytes`);
  }
  const tokens = raw.tokens && typeof raw.tokens === 'object' && !Array.isArray(raw.tokens)
    ? Object.fromEntries(Object.entries(raw.tokens).filter(([key, value]) =>
      /^--wb-[a-z0-9-]+$/.test(key) && typeof value === 'string' && value.length < 128))
    : {};

  return {
    kind,
    pageId,
    sectionId,
    screenId,
    format,
    scale,
    background,
    includeNotes: raw.includeNotes === true,
    html,
    tokens,
  };
}
