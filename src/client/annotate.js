/* pinpoint: Figma-style HTML annotate tool.
 * Browser annotation client. Bundled by esbuild (src/server/lib/annotate-bundle.js) and served as /annotate.js;
 * ios-kit.js injects it on localhost.
 * Anchors use CSS selectors; coords are secondary (scale-safe).
 * SSOT = ~/.pinpoint/<pageId>/ (bucket = page, ADR 0036); localStorage is cache; SSE /events syncs browsers.
 * Modes: 标注 (click → box) | 交互 (demo; default). Text selection stays enabled in 交互.
 * Hierarchy: page → canvas → section → frame (screen + chrome). screenId = frame id.
 * Disk shape: annotations[] with content / section / sectionLabel / screenId / pageId.
 * Indicators: @page: @section: @frame: @a:; local target refs in content use [@t:iN].
 * Overlay mounts inside .wb-stage-wrap (not over the sidebar).
 * /api/frame 嵌入帧：frame 内标注与画布同账本（桶 = 帧所属页、账本 @canvas，注入
 * __pinpointFrame），锚点按 frame 内路径归一（src/shared/frame-anchor.js）。 */

// SSOT 共享库（src/shared、src/client/lib）走真正的 ES 模块，由
// src/server/lib/annotate-bundle.js 用 esbuild 打成单个自包含 IIFE 再 serve
// （审计 B3：取代运行时正则拼接 + 压缩 + 常驻缓存）。本文件不再被原样 serve，
// 这些 import 只进构建 —— 引用方式不变，仍然是不加限定符的裸名字。
// 实现按职责拆在 ./annotate/ 下；这里只做组装，闭包共享的状态经一个 ctx 传下去。
import { bind_boot, bootAnnotate } from './annotate/boot.js';
import { bind_marks, init_marks } from './annotate/marks.js';
import { bind_dom, init_dom } from './annotate/dom.js';
import { bind_anchor, init_anchor } from './annotate/anchor.js';
import { bind_persist } from './annotate/persist.js';
import { bind_outbox, init_outbox, installLeaveHooks, setEventsParked } from './annotate/outbox.js';
import { bind_ui, init_ui, installUiBindings } from './annotate/ui.js';
import { bind_sidebar, init_sidebar, installSidebar } from './annotate/sidebar.js';
import { bind_gesture, init_gesture, installPointerGestures } from './annotate/gesture.js';
import { bind_create } from './annotate/create.js';
import { bind_composer, init_composer } from './annotate/composer.js';
import { bind_mention } from './annotate/mention.js';
import { bind_composer_images } from './annotate/composer-images.js';
import { bind_composer_open } from './annotate/composer-open.js';
import { bind_arrow, init_arrow } from './annotate/arrow.js';
import { bind_render, init_render } from './annotate/render.js';
import { bind_render_geometry, init_render_geometry } from './annotate/render-geometry.js';
import { bind_bubbles, init_bubbles } from './annotate/bubbles.js';
import { bind_schedule, init_schedule, installViewScheduling, setViewParked } from './annotate/schedule.js';
import { bind_nav, init_nav, installPinpointApi } from './annotate/nav.js';
import { bind_ledger, startAnnotate } from './annotate/ledger.js';

(function () {
  'use strict';
  if (window.__pinpoint) return;
  window.__pinpoint = true;

  var ctx = {};
  bind_boot(ctx);
  bind_marks(ctx);
  bind_dom(ctx);
  bind_anchor(ctx);
  bind_persist(ctx);
  bind_outbox(ctx);
  bind_ui(ctx);
  bind_sidebar(ctx);
  bind_gesture(ctx);
  bind_create(ctx);
  bind_composer(ctx);
  bind_mention(ctx);
  bind_composer_images(ctx);
  bind_composer_open(ctx);
  bind_arrow(ctx);
  bind_render(ctx);
  bind_render_geometry(ctx);
  bind_bubbles(ctx);
  bind_schedule(ctx);
  bind_nav(ctx);
  bind_ledger(ctx);
  if (!bootAnnotate()) return;
  init_marks();
  init_dom();
  init_anchor();
  init_outbox();
  init_ui();
  init_sidebar();
  init_gesture();
  init_composer();
  init_arrow();
  init_render();
  init_render_geometry();
  init_bubbles();
  init_schedule();
  init_nav();
  installLeaveHooks();
  installUiBindings();
  installSidebar();
  installPointerGestures();
  installViewScheduling();
  installPinpointApi();
  // 停驻钩子（E2）：工作台的暂停登记调它断开观察器、断开 /events。只挂在这份实例上，
  // 卡片 iframe 里的另一份不进工作台的登记。挂在就绪广播之前：绑定方收到广播时就要用。
  window.pinpoint.setViewParked = setViewParked;
  window.pinpoint.setEventsParked = setEventsParked;
  startAnnotate();
  // 就绪广播（C1，r1 §7：注入完成即宣布，不再让等待方轮询）。此时 window.pinpoint
  // 已挂全、账本水合已启动；whenReady()（ledger.js whenLedgerReady）等账本第一次落定。
  // 同一文档的等待方收 'pinpoint:ready' 事件；嵌在 iframe 里时再向父级发一条消息，
  // 父级（工作台 ann-bridge / live-cards）按 event.source 认帧 —— 跨文档 DOM 事件
  // 过不来，postMessage 会排队投递，父级监听挂得晚也收得到。
  window.dispatchEvent(new Event('pinpoint:ready'));
  if (window.parent !== window) {
    try { window.parent.postMessage({ source: 'pinpoint-annotate', type: 'ready' }, location.origin); } catch (e) { /* 跨源父级收不到就算了 */ }
  }
})();
