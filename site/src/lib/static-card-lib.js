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
 * @import 递归展开：constructed stylesheet 不许带 @import，按 URL 取回文本内联；
 * 带条件的 import 包进 @media 保住条件。seen 打破循环引用（同一趟解析里重复的地址跳过）。
 * fetchText(href) → CSS 文本（调用方负责按 URL 缓存与 ?direct 处理）。
 */
export async function resolveCssImports(cssText, baseUrl, fetchText, seen = new Set()) {
  let out = String(cssText);
  const imports = [...out.matchAll(/@import\s+(?:url\(\s*)?['"]([^'"]+)['"]\s*\)?\s*([^;]*);/g)];
  for (const m of imports) {
    const href = new URL(m[1], baseUrl).href;
    let replacement = '';
    if (!seen.has(href)) {
      seen.add(href);
      const text = await fetchText(href, seen);
      replacement = m[2].trim() ? `@media ${m[2].trim()}{${text}}` : text;
    }
    out = out.replace(m[0], replacement);
  }
  return out;
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
