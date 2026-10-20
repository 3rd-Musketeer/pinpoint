// Workbench 图标 — lucide iconNode 表 + hero gear path，chrome 全部经这里出壳
// （旧的命令式挂载器扫 data-wb-icon 占位再 replaceWith 成 svg，会把 React 管理的
// <i> 换成游离节点、vnode 指向落空，随 workbench-icons.js 一起删除，2026-10-20）。
import { Files, Archive, Check, Pencil, Trash2, Pin, Sun, Moon, SquareDashedMousePointer, PanelLeftClose, PanelLeftOpen, ChevronDown, ChevronLeft, ChevronRight, Ellipsis, ListTree, ImageDown, Smartphone, FileText, ArrowUpDown, BookOpen, Newspaper, Library, CircleAlert, ArrowLeft } from 'lucide';

var ICONS = {
  files: Files,
  pencil: Pencil,
  check: Check,
  trash: Trash2,
  pin: Pin,
  archive: Archive,
  sun: Sun,
  moon: Moon,
  'empty-ann': SquareDashedMousePointer,
  'panel-left-close': PanelLeftClose,
  'panel-left-open': PanelLeftOpen,
  'chevron-down': ChevronDown,
  // 横条中段的帧导航 ‹ ›（2026-09-04 评审板 G1）与弹出列表头的溢出「···」
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  ellipsis: Ellipsis,
  'section-nav': ListTree,
  'export-image': ImageDown,
  // 页面行类型图标（2026-09-05 owner 定的映射，lib/page-groups.js PAGE_KIND_ICONS）：
  // smartphone = 画布，file-text = 文档；横条类型标用同一套。
  smartphone: Smartphone,
  'file-text': FileText,
  // Pages 段头排序切换（2026-08-17g）：default → 最近更新 → 名称循环
  sort: ArrowUpDown,
  // 左栏「文章」组（pp3）：project 标题行、文章行、行尾“阅读正文”钮、布局错误标。
  library: Library,
  newspaper: Newspaper,
  'book-open': BookOpen,
  'circle-alert': CircleAlert,
  // 直接打开的文章画布左上角“← 文章标题”（app/ArticleBack.jsx）。
  'arrow-left': ArrowLeft
};

// Heroicons v2 solid cog-6-tooth — filled gears stay crisp at toolbar sizes.
var HERO_GEAR_SOLID = 'M11.078 2.25c-.917 0-1.699.663-1.85 1.567L9.05 4.889c-.02.12-.115.26-.297.348a7.493 7.493 0 0 0-.986.57c-.166.115-.334.126-.45.083L6.3 5.508a1.875 1.875 0 0 0-2.282.819l-.922 1.597a1.875 1.875 0 0 0 .432 2.385l.84.692c.095.078.17.229.154.43a7.598 7.598 0 0 0 0 1.139c.015.2-.059.352-.153.43l-.841.692a1.875 1.875 0 0 0-.432 2.385l.922 1.597a1.875 1.875 0 0 0 2.282.818l1.019-.382c.115-.043.283-.031.45.082.312.214.641.405.985.57.182.088.277.228.297.35l.178 1.071c.151.904.933 1.567 1.85 1.567h1.844c.916 0 1.699-.663 1.85-1.567l.178-1.072c.02-.12.114-.26.297-.349.344-.165.673-.356.985-.57.167-.114.335-.125.45-.082l1.02.382a1.875 1.875 0 0 0 2.28-.819l.923-1.597a1.875 1.875 0 0 0-.432-2.385l-.84-.692c-.095-.078-.17-.229-.154-.43a7.614 7.614 0 0 0 0-1.139c-.016-.2.059-.352.153-.43l.84-.692c.708-.582.891-1.59.433-2.385l-.922-1.597a1.875 1.875 0 0 0-2.282-.818l-1.02.382c-.114.043-.282.031-.449-.083a7.49 7.49 0 0 0-.985-.57c-.183-.087-.277-.227-.297-.348l-.179-1.072a1.875 1.875 0 0 0-1.85-1.567h-1.843ZM12 15.75a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5Z';

export function WbIcon({ name, size, className, ...rest }) {
  size = size || 14;
  className = className || 'wb-ico';
  if (name === 'settings') {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size}
        viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className} {...rest}>
        <path fillRule="evenodd" clipRule="evenodd" d={HERO_GEAR_SOLID} />
      </svg>
    );
  }
  var icon = ICONS[name];
  if (!icon) return null;
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size}
      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className} {...rest}>
      {icon.map(function (node, i) {
        var Tag = node[0];
        return <Tag key={i} {...node[1]} />;
      })}
    </svg>
  );
}
