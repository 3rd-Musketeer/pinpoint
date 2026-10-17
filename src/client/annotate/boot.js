// 启动：判定页面形态（文章页 / 嵌入帧 / 画布 / 普通页），定下账本键
// （ENTRY、PAGE、LS_KEY）。文章页在这里转去正文评论并返回 false。
// 导出 bind_boot、bootAnnotate。
import { CANVAS_LEDGER } from '../../shared/project-ids.js';
import { annotationSlug } from '../../shared/annotation-slug.js';
import { pageKeyFromPathname } from '../../shared/annotate-page-key.js';
import { startProseComments } from '../prose-comments.js';
export function bind_boot(c) { ctx = c; }
var ctx;

export function bootAnnotate() {

  ctx.SERVER = (function () {
    var src = document.currentScript && document.currentScript.src;
    if (src) { try { return new URL(src).origin; } catch (e) {} }
    return '';
  })();
  // pp3：文章页（article-proxy 注入 __pinpointProse）只跑正文评论 —— 选中文字
  // → 右栏线程，桶 = 文章页 id、账本 @prose（src/client/prose-comments.js）。画布
  // 标注的工具条、侧栏、元素标注都不在文章页上起：画布标注只在画布页做。
  if (window.__pinpointProse && window.__pinpointEntry) {
    var startProse = function () {
      startProseComments({ server: ctx.SERVER, entry: String(window.__pinpointEntry), prose: window.__pinpointProse });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', startProse, { once: true });
    else startProse();
  return false;
  }
  // Registry entry this page annotates under: the page-world global set by
  // same-origin injectors (/sites/、/api/frame）。Default: 'pinpoint'.
  // （浏览器扩展已于 pp2 切片 3 退役 —— 它曾走 <html data-pinpoint-entry>
  // 属性绕 CSP，那条通道与属性一并删除。）
  // ---------- 阶段 5：/api/frame 嵌入帧身份 ----------
  // frame 渲染端点注入 __pinpointFrame={pageId,screenId,section,sectionLabel}：
  // 本实例读写所属页画布同一份账本（桶 = 帧所属页，账本固定 @canvas），行带
  // pageId + screenId，锚点按 frame 内路径归一（src/shared/frame-anchor.js，内联）。
  // 文档正文标注仍走文档自己的账本 —— 两个命名空间共存不打架。
  ctx.FRAME = (function () {
    var f = window.__pinpointFrame;
    if (!f || typeof f !== 'object' || !f.pageId || !f.screenId) return null;
    return {
      pageId: String(f.pageId),
      screenId: String(f.screenId),
      section: f.section ? String(f.section) : '',
      sectionLabel: f.sectionLabel ? String(f.sectionLabel) : ''
    };
  })();
  // ---------- storage-unify：桶 = 页、画布账本固定名 ----------
  // 工作台画布实例没有 entry 标记（ios-kit 注入），它的桶 = 活动页 id，加载时
  // 定不了 —— CANVAS_MODE 只判形态，ENTRY/账本由 watchWorkbenchPages 在页定下
  // 来时经 switchLedgerTo 换上，切活动页 = 换桶重 hydrate。
  ctx.ENTRY = window.__pinpointEntry || 'pinpoint';
  ctx.CANVAS_PAGE = CANVAS_LEDGER;
  ctx.CANVAS_MODE = !ctx.FRAME && !window.__pinpointEntry && (function () {
    if (document.getElementById('wb-board-panel')) return true;
    if (window.workbench && typeof window.workbench.activePageId === 'function') return true;
    var p = location.pathname.replace(/\/+$/, '') || '/';
    return p === '/workbench' || p === '/workbench/index.html' || p === '/' || p === '/index.html';
  })();
  ctx.LEDGER_PATHNAME =
    ctx.FRAME || ctx.CANVAS_MODE
      ? ctx.CANVAS_PAGE
      : ((typeof window.__pinpointLedger === 'string' && window.__pinpointLedger.charAt(0) === '/')
          ? window.__pinpointLedger
          : location.pathname);
  ctx.LS_KEY = 'pinpoint:' + ctx.ENTRY + ':' + ctx.LEDGER_PATHNAME;
  // 页面标识 = 文件名 + 全路径短哈希（SSOT: src/shared/annotate-page-key.js，内联）；
  // 画布 / 帧实例的账本是固定名 @canvas（不跟工作台 pathname 走，`/` 与
  // `/index.html` 两个拼法从此同一本）。
  ctx.PAGE = (ctx.FRAME || ctx.CANVAS_MODE) ? ctx.CANVAS_PAGE : pageKeyFromPathname(ctx.LEDGER_PATHNAME);
  ctx.PAGE_KEY = annotationSlug(ctx.PAGE);
  return true;
}
