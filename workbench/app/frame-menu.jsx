// Frame ⋯ 菜单（goal-20260810-workbench-react-rebuild P3）— Radix DropdownMenu
// 承载行为：trigger aria（haspopup/expanded/controls）、dismiss layer（Esc /
// 点外关闭 / 焦点移出关闭）、roving focus（方向键 / Home / End / typeahead）、
// 关后焦点回 trigger。「开 B 自动关 A」由每层自己的 dismiss 监听天然达成，
// 不要自己写单例关闭 —— 程序化 setOpen(false) 会走 A 的 close-autofocus 把焦点
// 拽回 A 的 trigger，触发 B 的 focus-outside dismiss 连锁关掉 B（实测踩过）。
// 皮肤与几何的分工：
// - 不用 Portal —— 菜单 DOM 必须留在对应 frame 的子树里（e2e 用 frame.locator 选）；
// - popper 包装层被 CSS 置惰（见 index.html 的 [data-radix-popper-content-wrapper]
//   规则）—— .wb-library 是 transform:scale 空间，JS 量测定位在缩放 ≠1 时必错位，
//   菜单位置继续由 .wb-frame-menu 的绝对定位拥有（几何类随皮肤进 Tailwind，值不变）。
// V3 换皮（goal-20260811-workbench-visual-rebuild）：皮肤收编 Tailwind 类 + token，
// index.html 的 .wb-frame-menu*/trigger 旧规则删除（class 名保留作 e2e 契约钩子）。
// trigger = Button tool variant 族（白面发丝浮钮，data-state=open 给 hover 同档
// 活跃态）；面板 = 浮层白面 + 发丝边 + --wb-sh-3 + r-4；项 = 34px 行 + r-3 +
// hover/focus-visible --wb-hover 浅面，图标 muted。
// 每个 frame 的 shell 一个 React root：shell 由命令式层（export-core）随板面重建
// 创建，本模块登记 roots；sweepFrameMenus() 卸载 shell 已游离（板面重建）的 root，
// 防止 DismissableLayer 的 document 监听泄漏。命令式层经 initExportCore(deps)
// 拿到这两个函数（app → 命令式 的 import 方向不变，本文件不 import export-core）。
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { wbGet } from './store.js';
import { Button } from './ui/button.jsx';
import { WbIcon } from './WbIcon.jsx';

// 菜单项皮肤（两项同款）：12px semibold 行，hover/focus 走 --wb-hover 浅面
var MENU_ITEM =
  'flex min-h-[34px] w-full cursor-pointer items-center gap-[9px] rounded-lg border-0 ' +
  'bg-transparent px-[9px] text-left font-sans text-[12px] font-semibold text-foreground ' +
  'transition-colors duration-150 hover:bg-accent focus-visible:bg-accent ' +
  '[&_svg]:text-muted-foreground';

var mounted = []; // { shell, root }

function FrameMenu(props) {
  var [copiedText, setCopiedText] = useState('');
  var copyTimer = useRef(0);

  useEffect(function () {
    return function () { clearTimeout(copyTimer.current); };
  }, []);

  function copyFrameRef() {
    var text = '@frame:' + wbGet().activePageId + '/' + props.screenId;
    if (!navigator.clipboard || !navigator.clipboard.writeText) return;
    navigator.clipboard.writeText(text).then(function () {
      setCopiedText(text);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(function () { setCopiedText(''); }, 1200);
    }).catch(function () {});
  }

  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <Button type="button" variant="tool" aria-label="Frame 菜单" title="Frame 菜单"
          className="wb-frame-menu-trigger size-[30px] rounded-lg p-0 text-[18px] font-bold leading-none data-[state=open]:bg-accent data-[state=open]:text-foreground">⋯</Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content asChild>
        <span role="menu" tabIndex={-1}
          className="wb-frame-menu absolute right-0 top-[35px] z-50 box-border w-[204px] rounded-xl bg-card p-[5px] shadow-[var(--wb-sh-3)]">
          <DropdownMenu.Item asChild onSelect={function () {
            // 让菜单先走完关闭再开导出对话框：showModal 记住打开前的焦点元素，
            // Esc 关对话框后的原生还原才落得到 trigger 上。Radix FocusScope 的
            // 关后焦点还原本身排在 setTimeout(0)（react-focus-scope 卸载清理），
            // 所以这里嵌套一层 —— 内层必排在它之后，顺序是硬保证不是碰运气；
            // 即便 Radix 改了时序，最坏也只是退回到焦点落 body 的旧行为。
            setTimeout(function () { setTimeout(function () { props.onExport(); }, 0); }, 0);
          }}>
            <button type="button" className={'wb-frame-menu-item ' + MENU_ITEM} role="menuitem" data-frame-export>
              <WbIcon name="export-image" size={15} className="size-[15px]" /><span>导出图片…</span>
            </button>
          </DropdownMenu.Item>
          <DropdownMenu.Item asChild onSelect={function (event) { event.preventDefault(); copyFrameRef(); }}>
            <button type="button" className={'wb-frame-menu-item ' + MENU_ITEM} role="menuitem" data-frame-copy>
              <span aria-hidden="true" className="w-[15px] text-center text-muted-foreground">@</span>
              <span data-frame-menu-label className="min-w-0 truncate">{copiedText ? '已复制 ' + copiedText : '复制 @frame'}</span>
            </button>
          </DropdownMenu.Item>
        </span>
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}

export function mountFrameMenu(shell, options) {
  var root = createRoot(shell);
  root.render(<FrameMenu screenId={options.screenId} onExport={options.onExport} />);
  mounted.push({ shell: shell, root: root });
}

/** 板面重建后调用：卸载 shell 已不在文档里的 root（连通着的保持不动）。 */
export function sweepFrameMenus() {
  mounted = mounted.filter(function (entry) {
    if (entry.shell.isConnected) return true;
    entry.root.unmount();
    return false;
  });
}
