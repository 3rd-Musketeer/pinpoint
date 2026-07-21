const ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const COMPONENT_SCREEN_PATTERN = /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/;

export class ContractError extends Error {
  constructor(path, message) {
    super(`${path}: ${message}`);
    this.name = 'ContractError';
    this.path = path;
  }
}

function objectAt(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ContractError(path, 'expected an object');
  }
  return value;
}

function nonEmptyString(value, path) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ContractError(path, 'expected a non-empty string');
  }
  return value.trim();
}

function identifier(value, path, pattern = ID_PATTERN) {
  const id = nonEmptyString(value, path);
  if (!pattern.test(id)) throw new ContractError(path, `invalid id "${id}"`);
  return id;
}

function screenIdentifier(value, path, allowComponentRefs) {
  const id = nonEmptyString(value, path);
  if (!ID_PATTERN.test(id) && !(allowComponentRefs && COMPONENT_SCREEN_PATTERN.test(id))) {
    throw new ContractError(path, `invalid id "${id}"`);
  }
  return id;
}

export function validatePageManifest(raw) {
  const input = objectAt(raw, 'manifest');
  if (!Array.isArray(input.pages) || !input.pages.length) {
    throw new ContractError('pages', 'expected a non-empty array');
  }
  const seen = new Set();
  const pages = input.pages.map((entry, index) => {
    const page = objectAt(entry, `pages[${index}]`);
    const id = identifier(page.id, `pages[${index}].id`);
    if (seen.has(id)) throw new ContractError(`pages[${index}].id`, `duplicate id "${id}"`);
    seen.add(id);
    return { id, title: nonEmptyString(page.title, `pages[${index}].title`) };
  });
  const defaultPage = identifier(input.defaultPage, 'defaultPage');
  if (!seen.has(defaultPage)) {
    throw new ContractError('defaultPage', `"${defaultPage}" is not listed in pages`);
  }
  return { defaultPage, pages };
}

function validateShell(value, path, fallback = 'app') {
  const shell = value || fallback;
  if (shell !== 'app' && shell !== 'lock') {
    throw new ContractError(path, 'expected "app" or "lock"');
  }
  return shell;
}

function normalizeScreen(entry, path, sectionShell, options) {
  const allowComponentRefs = !!options.allowComponentRefs;
  if (typeof entry === 'string') {
    return { id: screenIdentifier(entry, path, allowComponentRefs), title: '', shell: sectionShell, src: '' };
  }
  const screen = objectAt(entry, path);
  return {
    id: screenIdentifier(screen.id, `${path}.id`, allowComponentRefs),
    title: screen.title == null ? '' : nonEmptyString(screen.title, `${path}.title`),
    shell: validateShell(screen.shell, `${path}.shell`, sectionShell),
    src: screen.src == null ? '' : nonEmptyString(screen.src, `${path}.src`),
  };
}

export function validateBoard(raw, options = {}) {
  const board = objectAt(raw, options.pageId ? `board(${options.pageId})` : 'board');
  if (!Array.isArray(board.sections)) {
    throw new ContractError('sections', 'expected an array; flat board shapes are not supported');
  }
  const sectionIds = new Set();
  const screenIds = new Set();
  const sections = board.sections.map((entry, sectionIndex) => {
    const path = `sections[${sectionIndex}]`;
    const section = objectAt(entry, path);
    const id = identifier(section.id, `${path}.id`);
    if (sectionIds.has(id)) throw new ContractError(`${path}.id`, `duplicate id "${id}"`);
    sectionIds.add(id);
    const layout = section.layout;
    if (layout !== 'row' && layout !== 'column') {
      throw new ContractError(`${path}.layout`, 'expected "row" or "column"');
    }
    if (!Array.isArray(section.screens)) {
      throw new ContractError(`${path}.screens`, 'expected an array');
    }
    const shell = validateShell(section.shell, `${path}.shell`);
    const screens = section.screens.map((screen, screenIndex) => {
      const screenPath = `${path}.screens[${screenIndex}]`;
      const normalized = normalizeScreen(screen, screenPath, shell, options);
      if (screenIds.has(normalized.id)) {
        throw new ContractError(screenPath, `duplicate screen id "${normalized.id}"`);
      }
      screenIds.add(normalized.id);
      return normalized;
    });
    return {
      id,
      title: section.title == null ? id : nonEmptyString(section.title, `${path}.title`),
      layout,
      shell,
      screens,
    };
  });
  return { sections };
}
