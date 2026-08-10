import { create } from 'zustand';

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
  sectionOpen: { pages: true, annotations: true },
  // board + pages
  boardMode: 'ios',
  activePageId: null,
  pageManifest: null,
  pageManifestError: null,   // manifest 拉取失败信息（侧栏错误行）
  pageNames: {},             // prefs.pageNames — 页面重命名（侧栏显示名）
  activeBoard: null,        // { pageId, board } — HTML 板的版本切换器要读它
  activeDocId: null,        // HTML 板当前文档版本 screenId（setActiveDoc 写）
  activeGroup: 'lock',      // 当前聚焦 section（scroll spy / minimap / section-nav 共用）
  // settings view
  settingsOpen: false,
  // annotation panel
  annFilter: 'all',
  annSnap: null,            // ann-bridge 写入的标注状态快照（AnnPanel 唯一状态源）
  // preview chrome
  theme: 'light',

  patch: (partial) => set(partial),
}));

// 命令式层的读写入口（React 组件请用 hook 订阅，不要用这两个）。
export const wbGet = useWorkbenchStore.getState;
export const wbSet = useWorkbenchStore.setState;
