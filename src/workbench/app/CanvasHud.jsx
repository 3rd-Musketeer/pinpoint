import { Fragment } from 'react';
import { useWorkbenchStore, wbSet } from './store.js';
import { recenterBoard } from '../board-nav.js';
import { setCanvasZoom, zoomCanvasAt } from '../boot-prefs.js';
import { currentCanvasZoom } from '../lib/canvas-zoom.js';
import { clampZoom, formatZoomLabel } from '../../shared/canvas-gesture.js';
import { pageEntry } from '../lib/page-url.js';
import { offlineExportSupported } from '../../shared/offline-export-scope.js';
import { cn } from './lib/utils.js';
import { Button } from './ui/button.jsx';
import { WbIcon } from './WbIcon.jsx';

// 缩放组槽内项（SEG_ITEM 同族，去掉单选态）：24px 项 + 容器 2px 内衬 = 28px 档
var HUD_ITEM =
  'inline-flex h-6 min-w-6 cursor-pointer items-center justify-center rounded-sm border-0 ' +
  'bg-transparent px-1.5 font-sans text-[13px] font-semibold text-muted-foreground ' +
  'transition-[color,background-color] duration-150 hover:bg-accent hover:text-accent-foreground';

function nudgeZoom(factor) {
  zoomCanvasAt(clampZoom(currentCanvasZoom() * factor));
}

export function CanvasHud() {
  var zoom = useWorkbenchStore(function (s) { return s.canvasZoom; });
  // 导出钮只在离线导出能导的页上出（offline-export-scope.js，构建器同一口径）：文章画布页、
  // 模板页（没有 site，不是登记条目）、非 ios 的条目都不出。manifest 页的 mode 由 entryBoardMode
  // 派生，dir 条目只有 board 是 ios 时才是 'ios'，所以这里拿 mode 当 board。
  var exportable = useWorkbenchStore(function (s) {
    var page = pageEntry(s.pageManifest, s.activePageId);
    return !!(page && page.site && offlineExportSupported(page.id, { kind: page.kind, board: page.mode }));
  });
  return (
    <Fragment>
      <span className="wb-strip-div" id="wbcanvas-tools-div" aria-hidden="true"></span>
      {/* 横条中段（2026-09-04 评审板 G1）：缩放 → 回中 → 导出。
          文档形态整段收起（index.html 的 [data-page-mode="html"] 规则）—— 阅读器
          没有画布可缩放，但横条本体（页名 / 模式 / 计数）留着。 */}
      <div id="wbcanvas-tools" className="wb-canvas-tools flex items-center gap-1.5">
        <div className="wb-hud-group flex items-center gap-px rounded-md bg-muted p-0.5" role="group" aria-label="画布缩放">
          <button type="button" className={cn('wb-hud-btn', HUD_ITEM)} id="wbzoom-out" title="缩小" aria-label="缩小"
            onClick={function () { nudgeZoom(1 / 1.1); }}>−</button>
          <button type="button" id="wbzoom-label" title="重置为 100%"
            className={cn('wb-hud-btn wb-hud-zoom', HUD_ITEM, 'min-w-[52px] px-1 text-[12px] tabular-nums tracking-[-0.01em] text-foreground')}
            onClick={function () { setCanvasZoom('1', { save: true }); }}>{formatZoomLabel(zoom)}</button>
          <button type="button" className={cn('wb-hud-btn', HUD_ITEM)} id="wbzoom-in" title="放大" aria-label="放大"
            onClick={function () { nudgeZoom(1.1); }}>+</button>
        </div>
        <Button type="button" variant="tool" id="wbrecenter" title="回到画布内容"
          className="wb-hud-btn wb-hud-recenter h-7 px-2.5 text-[12px] font-semibold"
          onClick={function () { recenterBoard(); }}>回中</Button>
        {/* 导出单入口（decisions 2026-08-15d）：开 picker 对话框，本体在 ExportPicker.jsx */}
        {exportable ? <Button type="button" variant="tool" id="wbexport-open" title="导出图片"
          className="wb-hud-btn wb-hud-export h-7 gap-[5px] px-2 text-[12px] font-semibold"
          onClick={function (e) {
            e.preventDefault();
            e.stopPropagation();
            wbSet({ exportPickerOpen: true });
          }}>
          <WbIcon name="export-image" size={14} className="size-3.5" />
          导出
        </Button> : null}
      </div>
    </Fragment>
  );
}
