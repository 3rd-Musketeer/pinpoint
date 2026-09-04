// URL 深链写入侧（goal-20260810-workbench-react-rebuild P3）— store 的
// activePageId + activeEntryId 单向镜像到 ?page=&mode=&entry=（mode 是页的
// manifest 属性，留给缺省壳/深链提示两个用途，Page 行壳标 pill 已随阶段 7 撤除；
// entry = 选中条目，2026-08-16f 阶段 6）：replaceState 只替换不堆历史（所以无需
// popstate 处理），每次切换后地址栏即可直接复制当深链用。entry 是默认条目（画布
// 条目 / 单条目板）时省略 —— 深链打开即默认选中，保持 URL 干净。
// 读取侧（boot 时 URL 优先于 prefs）在 stage.js resolveBootPageId + initBoard。
// 启动时机是契约：必须由 initBoard 在 boot 页/条目解析完成后调用 —— 订阅活着期间
// 任何 wbSet（annSnap 等）都会触发写入，boot 前启动会把深链参数在解析前覆盖掉。
import { useWorkbenchStore } from './app/store.js';
import { boardEntries, defaultEntryId } from './lib/board-entries.js';
import { deepLinkQuery, modeForPage } from './lib/page-url.js';

export function startDeepLinkSync() {
  var last = null;
  function sync(state) {
    var entryParam = null;
    if (state.activeBoard && state.activeBoard.pageId === state.activePageId) {
      var entries = boardEntries(state.activeBoard.board);
      if (state.activeEntryId && state.activeEntryId !== defaultEntryId(entries)) {
        entryParam = state.activeEntryId;
      }
    }
    var query = deepLinkQuery(state.activePageId, modeForPage(state.pageManifest, state.activePageId), entryParam);
    if (!query || query === last) return;
    last = query;
    history.replaceState(null, '', location.pathname + '?' + query + location.hash);
  }
  sync(useWorkbenchStore.getState()); // boot 解析结果先规范化落 URL
  useWorkbenchStore.subscribe(sync);
}
