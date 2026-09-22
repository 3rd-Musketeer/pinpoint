const ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const COMPONENT_SCREEN_PATTERN = /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/;

export class ContractError extends Error {
  constructor(path, message) {
    super(`${path}: ${message}`);
    this.name = 'ContractError';
    this.path = path;
  }
}

export function validateScreenFragment(raw, path = 'screen', options = {}) {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new ContractError(path, 'expected a non-empty HTML fragment');
  }
  const html = raw.trim();
  const isFullDocument = /^<!doctype\b/i.test(html)
    || /<html\b/i.test(html)
    || /<head\b/i.test(html)
    || /\bid=["']wbroot["']/i.test(html);
  if (isFullDocument) {
    throw new ContractError(
      path,
      'received a full HTML document instead of a screen fragment; the dev server may have returned its fallback page',
    );
  }
  const shell = options.shell || 'app';
  if (!/\b(?:ios-app|ios-lockscreen|ios-stage|ios-device)\b/.test(html)) {
    throw new ContractError(path, 'expected an ios-app, ios-lockscreen, or legacy phone wrapper');
  }
  return html;
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

// 2026-08-17 title 规矩（decisions 当日）：title = 单行短名词短语 —— 编号由系统
// 派生（board-refs A/B1），标题只保留单行短名，不承载说明文字。
// 契约层硬拦换行；长度不钉死，画布 caption 两行截断兜底。
function titleString(value, path) {
  const title = nonEmptyString(value, path);
  if (/[\r\n]/.test(title)) {
    throw new ContractError(path, 'expected a single-line title; move long-form text into note');
  }
  return title;
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

const PAGE_MODES = ['ios', 'html'];

function validatePageMode(value, path) {
  const mode = value == null || value === '' ? 'ios' : value;
  // 2026-08-16 阶段 2：web 模式/壳退役 —— 存量数据里的 'web' 安全落 doc 阅读器。
  if (mode === 'web') return 'html';
  if (!PAGE_MODES.includes(mode)) {
    throw new ContractError(path, 'expected "ios" or "html"');
  }
  return mode;
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
    return {
      id,
      title: titleString(page.title, `pages[${index}].title`),
      mode: validatePageMode(page.mode, `pages[${index}].mode`),
    };
  });
  const defaultPage = identifier(input.defaultPage, 'defaultPage');
  if (!seen.has(defaultPage)) {
    throw new ContractError('defaultPage', `"${defaultPage}" is not listed in pages`);
  }
  return { defaultPage, pages };
}

function validateShell(value, path, fallback = 'app') {
  const shell = value || fallback;
  // "doc" = a complete standalone HTML document rendered in an iframe (HTML board).
  // "app"/"lock" take body fragments the loader wraps in phone chrome.
  // "comp"（pp2 切片 2）= variants 墙：无机壳 comp 画板，screen 条目带 comp + props。
  // Legacy "web" (2026-08-16 退役) 归一到 "doc" —— 裸画板壳已连壳删除。
  if (shell === 'web') return 'doc';
  if (shell !== 'app' && shell !== 'lock' && shell !== 'doc' && shell !== 'comp') {
    throw new ContractError(path, 'expected "app", "lock", "doc", or "comp"');
  }
  return shell;
}

// 2026-08-16f（ROADMAP 阶段 6）：screen 级 role —— "product"（默认）= 产物，
// "draft" = 草稿（恒为整页 HTML 的 doc 屏）。role 是条目的属性，只标在 screen 上；
// 它不改变装载/壳语义，只驱动条目派生（lib/board-entries.js）。
const SCREEN_ROLES = ['product', 'draft'];

function validateRole(value, path) {
  const role = value == null || value === '' ? 'product' : value;
  if (!SCREEN_ROLES.includes(role)) {
    throw new ContractError(path, 'expected "product" or "draft"');
  }
  return role;
}

// pp2 切片 2：comp section 的 screen 条目 { id, title?, comp, props? } —— comp 是
// 组件名（JS 标识符；页目录 components/<Name>.jsx 或 pinpoint/kit），props 是喂给
// 组件的 JSON 值（board.json 本身已保证 JSON 安全，这里只拦非对象）。
const COMP_NAME_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function normalizeComp(screen, path) {
  if (screen.comp == null) return {};
  const comp = nonEmptyString(screen.comp, `${path}.comp`);
  if (!COMP_NAME_PATTERN.test(comp)) throw new ContractError(`${path}.comp`, `invalid component name "${comp}"`);
  let props = {};
  if (screen.props != null) {
    if (!screen.props || typeof screen.props !== 'object' || Array.isArray(screen.props)) {
      throw new ContractError(`${path}.props`, 'expected a JSON object of component props');
    }
    props = screen.props;
  }
  return { comp, props };
}

function normalizeScreen(entry, path, sectionShell, options) {
  const allowComponentRefs = !!options.allowComponentRefs;
  if (typeof entry === 'string') {
    return { id: screenIdentifier(entry, path, allowComponentRefs), title: '', shell: sectionShell, role: 'product', src: '' };
  }
  const screen = objectAt(entry, path);
  const compPart = normalizeComp(screen, path);
  // comp 屏的 title 缺省用 id（variants 墙的一格一名）；普通屏 title 可空。
  const titleFallback = compPart.comp ? screen.id : '';
  return {
    id: screenIdentifier(screen.id, `${path}.id`, allowComponentRefs),
    title: screen.title == null ? titleFallback : titleString(screen.title, `${path}.title`),
    shell: validateShell(screen.shell, `${path}.shell`, sectionShell),
    role: validateRole(screen.role, `${path}.role`),
    src: screen.src == null ? '' : nonEmptyString(screen.src, `${path}.src`),
    ...compPart,
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
    const shell = validateShell(section.shell, `${path}.shell`, options.defaultShell || 'app');
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
      title: section.title == null ? id : titleString(section.title, `${path}.title`),
      layout,
      shell,
      screens,
    };
  });
  return { sections };
}
