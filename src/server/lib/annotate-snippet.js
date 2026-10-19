/**
 * The injection contract shared by every server-side HTML injector
 * (/sites/ static entries, the /sites/ url proxy, and previews/ pages alike):
 * one inline entry marker + the client bundle tag — keep one SSOT.
 *
 * 客户端标签引用构建产物的内容哈希地址 /annotate.<hash>.js（审计 B3，immutable
 * 永久缓存）；构建还没落地或失败时回退老地址 /annotate.js —— 那条路由对同一个
 * 失败显式 500 带原因，注入面不吞错。
 *
 * storage-unify：entryId 一律是「这条内容属于哪一页」的页 id，注入方都落页桶，
 * 不落缺省 pinpoint 桶。
 */
import { annotateClientSrc } from './annotate-bundle.js';
import { parseReqUrl } from './req-url.js';

/**
 * options.prose（pp3，文章页）：`{ project, article }`。客户端见到
 * `window.__pinpointProse` 就只跑正文评论（选中文字 → 右栏线程），不起画布
 * 标注的工具条与侧栏；桶 = entryId（文章页 id），账本固定 @prose。
 */
export function annotateSnippet(entryId, options = {}) {
  const prose = options.prose
    ? `;window.__pinpointProse=${JSON.stringify({ project: String(options.prose.project), article: String(options.prose.article) }).replace(/</g, '\\u003c')}`
    : '';
  return `<script>window.__pinpointEntry='${entryId}'${prose}</script><script src="${annotateClientSrc()}"></script>`;
}

export function injectAnnotateClient(html, entryId, options = {}) {
  const snippet = annotateSnippet(entryId, options);
  if (/<\/body\s*>/i.test(html)) return html.replace(/<\/body\s*>/i, `${snippet}\n</body>`);
  return `${html}\n${snippet}\n`;
}

/**
 * 该不该给这个请求注入标注客户端——判定的唯一入口（r2 D4：此前 sites-api 三处、
 * preview-inject、article-proxy、content-routes、frame-doc 各抄一份
 * `?annotate=off` 判断，配各自拼的注入函数）：
 * - 「登记过才注入」：entryId 为空（未登记的条目 / 解析不出页 id）就不注入；
 * - `?annotate=off`：单请求豁免（导出管线、工作台的 fragment 装载用）；
 * - opts 是 annotateSnippet 的透传（prose 形态）。
 * 返回注入函数 `(html) => 注入后的 html`；null = 不注入，原样出。
 * /api/frame 的 embed=card 形态（卡片不出标注面）是帧文档自己的形状开关，
 * 不在这个入口——frame-api 在请求层判完 off/entry 后把布尔传下去。
 */
export function annotateInjection(req, entryId, options = {}) {
  if (!entryId) return null;
  if (parseReqUrl(req).query.get('annotate') === 'off') return null;
  return (html) => injectAnnotateClient(html, entryId, options);
}
