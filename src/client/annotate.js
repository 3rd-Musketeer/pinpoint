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
import { bind_outbox, init_outbox, installLeaveHooks } from './annotate/outbox.js';
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
import { bind_schedule, init_schedule, installViewScheduling } from './annotate/schedule.js';
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
  startAnnotate();
})();
