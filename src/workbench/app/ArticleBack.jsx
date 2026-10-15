// 直接打开的文章画布（/workbench/?page=<project>_<article>，从首页“工作台”或左栏进）左上角的
// “← 文章标题”：同一标签页回正文，落到画布当前所在的节（lib/article-groups.js articleCanvasReadUrl）。
// docs/design.md「外壳布局」里“顶部不放任何东西”的唯一例外（owner 2026-10-15）。
// 只给文章画布页（清单 manifest.articles 里的行）；存量页、模板页不出。文章页画布浮层里的
// 嵌入版（?embed=overlay）也不出：浮层有自己的关闭，回的是同一篇正文的原位置。
// 位置跟着左栏：展开时停在面板右边，收起时贴左缘（index.html .wb-back）。
import { useWorkbenchStore } from './store.js';
import { articleCanvasReadUrl } from '../lib/article-groups.js';
import { pageDisplayTitle } from '../lib/page-groups.js';
import { pageEntry } from '../lib/page-url.js';
import { EMBEDDED } from '../embed.js';
import { WbIcon } from './WbIcon.jsx';

export function ArticleBack() {
  var activePageId = useWorkbenchStore(function (s) { return s.activePageId; });
  var manifest = useWorkbenchStore(function (s) { return s.pageManifest; });
  var pageNames = useWorkbenchStore(function (s) { return s.pageNames; });
  var activeBoard = useWorkbenchStore(function (s) { return s.activeBoard; });
  var activeGroup = useWorkbenchStore(function (s) { return s.activeGroup; });
  if (EMBEDDED) return null;
  var row = ((manifest && manifest.articles) || []).find(function (r) { return r.id === activePageId; });
  var board = activeBoard && activeBoard.pageId === activePageId ? (activeBoard.fullBoard || activeBoard.board) : null;
  var href = articleCanvasReadUrl(row, board, activeGroup);
  if (!href) return null;
  var title = pageDisplayTitle(pageEntry(manifest, activePageId), pageNames) || activePageId;
  var section = href.indexOf('#') >= 0
    ? ((board && board.sections) || []).find(function (s) { return s && s.id === activeGroup; })
    : null;
  return (
    <a id="wbback" className="wb-back wb-glass" href={href}
      data-read-section={section ? section.id : undefined}
      title={section ? '回到正文“' + (section.title || section.id) + '”' : '回到正文'}>
      <WbIcon name="arrow-left" size={14} className="wb-back-ico" />
      <span className="wb-back-t">{title}</span>
    </a>
  );
}
