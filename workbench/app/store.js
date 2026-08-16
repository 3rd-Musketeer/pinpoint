import { create } from 'zustand';

import { boardEntries, entryForm, resolveEntry } from '../lib/board-entries.js';
import { modeForPage } from '../lib/page-url.js';

/**
 * Workbench 共享状态的唯一住处（goal-20260810-workbench-react-rebuild）。
 *
 * P1 拆分期的过渡形态：chrome UI 态与舞台态都先平铺在这里，命令式模块经
 * wbGet()/wbSet() 读写；React 组件经 hook 订阅。纪律：模块只碰自己消费的
 * 字段；字段随簇提取真实消费拉入，不预先铺全量。
 */
export const useWorkbenchStore = create((set) => ({
  // sidebar shell
  sideCollapsed: false,
  sideWidth: 250,
  annPanelCollapsed: false,  // 右栏（标注工作台）整栏折叠，decisions 2026-08-14
  annPanelWidth: 308,        // 右栏宽度（2026-08-16 V2：260–440 拖拽，boot-prefs applyAnnWidth 写）
  // board + pages
  activePageId: null,
  pageManifest: null,
  pageManifestError: null,   // manifest 拉取失败信息（侧栏错误行）
  pageNames: {},             // prefs.pageNames — 页面重命名（侧栏显示名）
  activeBoard: null,        // { pageId, board } — 条目列表、左栏大纲、导出树都读它
  activeEntryId: null,      // 当前选中条目 id（2026-08-16f 阶段 6；画布 = lib/board-entries.js
                            // CANVAS_ENTRY_ID，文档 = doc 屏 screenId；setActiveEntry 写）
  activeGroup: 'lock',      // 当前聚焦 section（scroll spy / minimap / section-nav 共用）
  // 大纲行 / 标注卡的选中焦点（decisions 2026-08-15c 双向同步）：
  // focusFrameKey = sectionId + '\0' + screenId；focusAnnN = 最近点开的标注序号
  focusFrameKey: null,
  focusAnnN: null,
  // settings view
  settingsOpen: false,
  // annotation panel
  annSnap: null,            // ann-bridge 写入的标注状态快照（AnnPanel 唯一状态源）
  // preview chrome
  theme: 'light',
  // 设置视图（boot-prefs 的 setter/apply* 写；SettingsView 组件读）
  frame: 'screen',
  textSize: 'default',
  lockFont: 'helvetica',
  clockMode: 'system',
  clockFixed: '9:41',
  // canvas HUD（board-nav 写；CanvasHud 组件读；初始值 = 首访默认缩放 0.5）
  canvasZoom: '0.5',
  // 导出 picker 对话框开关（decisions 2026-08-15d 单入口；CanvasHud 写，ExportPicker 读）
  exportPickerOpen: false,
  // 画布背景三态（grid 双线网格 / dots 圆点纸 / plain 空白；boot-prefs setStageBg 写）
  stageBg: 'grid',
  minimapOpen: false,
  minimapAvailable: false,
  sectionNavOpen: false,
  sectionNavVisible: false,
  sectionNavPosition: '1 / 1',
  sectionNavCurrent: '',

  patch: (partial) => set(partial),
}));

// 命令式层的读写入口（React 组件请用 hook 订阅，不要用这两个）。
export const wbGet = useWorkbenchStore.getState;
export const wbSet = useWorkbenchStore.setState;

/* stage 形态（ios 画布 / html 文档阅读器）不是独立状态 —— 2026-08-16f 阶段 6 起它是
   选中条目的派生只读视图（lib/board-entries.js；条目 = 画布条目 + 每个 doc 屏一个
   文档条目）。命令式消费点一律走下面两个函数；React 组件订阅 activeBoard +
   activeEntryId 后用同一组纯函数自行派生。
   板未装载 / 换页途中（activeBoard 还停在上一页）退回页级 modeForPage —— 与
   2026-08-16 阶段 2 的页级派生同义，只作过渡兜底。 */
export function activeEntry() {
  var s = useWorkbenchStore.getState();
  var active = s.activeBoard;
  if (!active || active.pageId !== s.activePageId) return null;
  return resolveEntry(boardEntries(active.board), s.activeEntryId);
}

export function activeBoardMode() {
  var entry = activeEntry();
  if (entry) return entryForm(entry);
  var s = useWorkbenchStore.getState();
  return modeForPage(s.pageManifest, s.activePageId);
}
