// URL 深链写入侧（goal-20260810-workbench-react-rebuild P3）— store 的
// activePageId/boardMode 单向镜像到 ?page=&mode=：replaceState 只替换不堆历史
// （所以无需 popstate 处理），每次切换后地址栏即可直接复制当深链用。
// 读取侧（boot 时 URL 优先于 prefs）在 workbench.js resolveBootPageId。
// 启动时机是契约：必须由 initBoard 在 boot 页解析完成后调用 —— 订阅活着期间
// 任何 wbSet（annSnap 等）都会触发写入，boot 前启动会把深链参数在解析前覆盖掉。
import { useWorkbenchStore } from './app/store.js';
import { deepLinkQuery } from './lib/page-url.js';

export function startDeepLinkSync() {
  var last = null;
  function sync(state) {
    var query = deepLinkQuery(state.activePageId, state.boardMode);
    if (!query || query === last) return;
    last = query;
    history.replaceState(null, '', location.pathname + '?' + query + location.hash);
  }
  sync(useWorkbenchStore.getState()); // boot 解析结果先规范化落 URL
  useWorkbenchStore.subscribe(sync);
}
