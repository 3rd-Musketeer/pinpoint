/**
 * 静态卡片（shadow root）的纯函数一侧：CSS 文本处理、静态化判据、资源地址改写。
 * 不碰 DOM，node --test 直测；DOM 编排（取帧文档、挂 shadow、量尺寸、回退 iframe）
 * 在 canvas-card-client.js。机制依据：tasks 2026-10-19-ppnt-overhaul 的 r3 原型。
 */

/** 服务端内联进帧页的 frame-boot 启动脚本（src/client/frame-boot.js 的 docblock 首行）。 */
export const FRAME_BOOT_MARKER = '/api/frame 嵌入页的预览脚本运行时';

/**
 * 帧文档里一个 <script> 的身份：
 *   'boot'    ios-kit 或内联 frame-boot —— 静态挂载时剥掉（kit 由卡片页统一加载）；
 *   'preview' data-preview-script / data-preview-mount —— 有运行时脚本的帧留 iframe；
 *   'other'   来路不明的脚本 —— 同样留 iframe（不知道它会不会动 DOM / 查 document）。
 */
export function classifyFrameScript({ src = '', attrs = '', text = '' }) {
  if (/\bdata-preview-(?:script|mount)\b/.test(attrs)) return 'preview';
  if (src) {
    try {
      if (new URL(src, 'http://x/').pathname === '/kits/ios/ios-kit.js') return 'boot';
    } catch { /* 非法地址按 other */ }
    return 'other';
  }
  return text.includes(FRAME_BOOT_MARKER) ? 'boot' : 'other';
}

const CSS_COMMENT = /\/\*[\s\S]*?\*\//g;

/**
 * 静态显示在 shadow root 里会和 iframe 不一样的 CSS 依赖，命中就留 iframe（判据）：
 * - 视口类 media query（width / height / aspect-ratio / orientation）：iframe 里按帧视口求值，
 *   shadow 里按文章页视口求值。prefers-* / print / screen / 像素比两端求值相同，不算。
 * - 视口单位（vw / vh / vi / vb / vmin / vmax 及 s/l/d 前缀）：同上。
 * - position:fixed：iframe 里相对帧视口，shadow 里相对文章页视口，会飞出卡片。
 * → 'media-viewport' | 'viewport-unit' | 'fixed-position' | null
 */
export function cssHazard(cssText) {
  const css = String(cssText || '').replace(CSS_COMMENT, '');
  for (const m of css.matchAll(/@media\b([^{]+)\{/g)) {
    if (/\b(?:min-|max-)?(?:width|height|aspect-ratio)\b|\borientation\b/.test(m[1])) return 'media-viewport';
  }
  if (/\b\d*\.?\d+(?:[sld]?v(?:[whib]|min|max))\b/.test(css)) return 'viewport-unit';
  if (/\bposition\s*:\s*fixed\b/.test(css)) return 'fixed-position';
  return null;
}

/** url() 相对地址按 base 改写成绝对；data: / http(s): / 绝对路径 / 纯 fragment 不动。 */
export function rewriteCssUrls(cssText, baseUrl) {
  return String(cssText).replace(/url\(\s*(['"]?)([^)'"]+)\1\s*\)/g, (full, q, u) => {
    const url = u.trim();
    if (/^(?:data:|https?:|\/|#)/.test(url)) return full;
    return `url("${new URL(url, baseUrl).href}")`;
  });
}

/** :root 的 token 定义搬到 shadow 的 :host 上（shadow 里的内容继承 host 的计算值）。 */
export const rewriteRootSelector = (cssText) => String(cssText).replace(/:root\b/g, ':host');

/**
 * @import 的条件（URL 之后到分号）只认 media query 列表：能原样包进 @media。命中 true 就整帧退回 iframe：
 * - layer（裸关键字或 layer()）/ supports() / scope()：包进 @media 会产出非法 CSS 或丢掉层级语义，
 *   constructed stylesheet 静默丢掉整张表；
 * - media query 里不会出现的字符（花括号、引号、反斜杠等）：认不出的语法，不去猜。
 */
export const importNeedsFrame = (condition) => /\b(?:layer|supports|scope)\b/i.test(condition)
  || !/^[\w\s(),:.\-\/<>=]*$/.test(condition);

// 一条 @import：URL 是字符串、url("…") / url('…')，或合法的无引号 url(…)；之后到分号是条件。
// 无引号 url() 里不能有空白、引号、括号、反斜杠（CSS Syntax 的 url-token），带转义的不认 → 退回 iframe。
const IMPORT_RULE = /@import\s*(?:url\(\s*(?:"([^"\\\n]*)"|'([^'\\\n]*)'|([^\s"'()\\]+))\s*\)|"([^"\\\n]*)"|'([^'\\\n]*)')([^;{}]*);/iy;

/**
 * 把 cssText 里的每条 @import 拆成 { start, end, href, condition }。按 CSS 的词法走：注释、
 * 字符串、无引号 url() 的内容跳过（里面的 @import 字样不是规则），文本本身不改。
 * 有一条认不出（语法不在 IMPORT_RULE 内、条件见 importNeedsFrame）就返回 null：调用方整帧
 * 退回 iframe，不把丢掉的规则当成加载成功（constructed stylesheet 对剩下的 @import 不加载也不报错）。
 */
export function parseCssImports(cssText) {
  const css = String(cssText);
  const out = [];
  let i = 0;
  while (i < css.length) {
    const c = css[i];
    if (c === '/' && css[i + 1] === '*') {
      const close = css.indexOf('*/', i + 2);
      i = close < 0 ? css.length : close + 2;
    } else if (c === '"' || c === "'") {
      i++;
      while (i < css.length && css[i] !== c && css[i] !== '\n') i += css[i] === '\\' ? 2 : 1;
      i++;
    } else if (c === '@' && /^@import\b/i.test(css.slice(i, i + 8))) {
      IMPORT_RULE.lastIndex = i;
      const r = IMPORT_RULE.exec(css);
      if (!r) return null;
      const condition = r[6].trim();
      if (importNeedsFrame(condition)) return null;
      out.push({ start: i, end: IMPORT_RULE.lastIndex, href: r[1] ?? r[2] ?? r[3] ?? r[4] ?? r[5], condition });
      i = IMPORT_RULE.lastIndex;
    } else if ((c === 'u' || c === 'U') && /^url\(\s*[^\s"']/i.test(css.slice(i, i + 64))) {
      const close = css.indexOf(')', i);
      i = close < 0 ? css.length : close + 1;
    } else {
      i++;
    }
  }
  return out;
}

/**
 * @import 递归展开：constructed stylesheet 不许带 @import，按 URL 取回原文内联；
 * 被展开的表的 url() 按它自己的地址绝对化；media query 条件的 import 包进 @media 保住条件。
 * fetchText(href) → 那张表的原始 CSS 文本（调用方负责按 URL 缓存原文与 ?direct 处理；不传展开结果，
 * 展开每一趟自己做）。path 是这一趟从根到当前表的地址链：import 指回链上的地址就是循环，
 * 返回 null。任何一层认不出的 @import、条件、循环都返回 null，调用方整帧退回 iframe。
 */
export async function resolveCssImports(cssText, baseUrl, fetchText, path = []) {
  const css = String(cssText);
  const imports = parseCssImports(css);
  if (imports == null) return null;
  let out = '';
  let at = 0;
  for (const { start, end, href: raw, condition } of imports) {
    const href = new URL(raw, baseUrl).href;
    if (path.includes(href)) return null; // 循环 import：整帧退回 iframe
    const inner = await resolveCssImports(await fetchText(href), href, fetchText, [...path, href]);
    if (inner == null) return null; // 被展开的表自己退回了
    const text = rewriteCssUrls(inner, href);
    out += css.slice(at, start) + (condition ? `@media ${condition}{${text}}` : text);
    at = end;
  }
  return out + css.slice(at);
}

/** srcset 的每个候选地址按 base 改写绝对（描述符 1x / 400w 原样保留）。 */
export function absolutizeSrcset(value, baseUrl) {
  return String(value).split(',').map((part) => {
    const t = part.trim();
    if (!t) return t;
    const i = t.search(/\s/);
    const url = i < 0 ? t : t.slice(0, i);
    if (/^(?:data:|https?:|\/|#)/.test(url)) return t;
    return new URL(url, baseUrl).href + (i < 0 ? '' : t.slice(i));
  }).join(', ');
}

/** 单个资源属性的改写；fragment（#c-chev 这类 sprite 引用）和 data: 不动。 */
export function absolutizeAttrValue(value, baseUrl) {
  const v = String(value || '');
  if (!v || /^(?:data:|https?:|\/|#)/.test(v)) return v;
  return new URL(v, baseUrl).href;
}
