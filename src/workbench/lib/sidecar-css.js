// Fragment 里的 CSS 资源 url 重定位 —— 与 JS sidecar（preview-mount.js
// resolveSidecarUrl）同一条 pageBaseUrl 规则。
//
// 为什么需要（2026-09-03 实迁摩擦，BACKLOG「改 registry id 后 /sites/<旧 id>/
// 资源静默 404」候选 ①）：fragment 写 <style>@import url("./x.css")</style> 时，
// 浏览器按 workbench 文档（index.html）解析这条相对 url，于是打到站点根；
// 同一个 fragment 里的 ./x.js 却被 resolveSidecarUrl 接到 pageBaseUrl。
// 两条路不一致，作者写相对路径 CSS 必 404，而 @import 失败没有任何可见反馈。
// 这里在装配 fragment 时把相对 url 按同一条规则改写成 pageBaseUrl 前缀的绝对
// 路径；已经是绝对路径（/sites/…）或 http(s) 的原样保留。
//
// 纯字符串函数，无 DOM 依赖，有 node 测试（sidecar-css.test.js）。

// @import 的两种写法：url(…) 与裸字符串，引号可有可无；媒体查询等尾巴不消费。
var IMPORT_RE = /(@import\s+)(url\(\s*)?(["']?)([^"')\s]+)\3/gi;
var STYLE_BLOCK_RE = /(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi;
var LINK_RE = /<link\b[^>]*>/gi;
var HREF_RE = /(\bhref\s*=\s*)(["'])([^"']*)\2/i;

/** 相对 url = 没有协议、没有协议相对前缀、不以 / 或 # 开头。 */
export function isRelativeAssetUrl(url) {
  var s = String(url == null ? '' : url).trim();
  if (!s) return false;
  return !/^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|#)/i.test(s);
}

/** 相对 url → base 前缀的绝对路径（'./x.css' 与 'x.css' 同解，与 JS sidecar 同规则）。 */
export function rebaseAssetUrl(url, base) {
  if (!isRelativeAssetUrl(url)) return url;
  return base + String(url).trim().replace(/^\.\//, '');
}

/** 一段 CSS 文本里 @import 引到的 url 列表（顺序保留，用于装载后的存在性探测）。 */
export function cssImportUrls(cssText) {
  var out = [];
  String(cssText == null ? '' : cssText).replace(IMPORT_RE, function (match, lead, fn, quote, url) {
    out.push(url);
    return match;
  });
  return out;
}

function rewriteCssImports(cssText, base) {
  return cssText.replace(IMPORT_RE, function (match, lead, fn, quote, url) {
    return lead + (fn || '') + quote + rebaseAssetUrl(url, base) + quote;
  });
}

/**
 * fragment HTML 里的 CSS 资源 url 改写：<style> 块内的 @import，以及
 * <link rel="stylesheet"> 的 href。其余内容逐字节不动。
 */
export function rewriteFragmentAssetUrls(html, base) {
  if (!html || !base) return html;
  return String(html)
    .replace(STYLE_BLOCK_RE, function (match, open, css, close) {
      return open + rewriteCssImports(css, base) + close;
    })
    .replace(LINK_RE, function (tag) {
      if (!/\brel\s*=\s*["']?[^"'>]*stylesheet/i.test(tag)) return tag;
      return tag.replace(HREF_RE, function (m, pre, quote, url) {
        return pre + quote + rebaseAssetUrl(url, base) + quote;
      });
    });
}
