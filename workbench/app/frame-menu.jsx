// Frame ⋯ 菜单（goal-20260810-workbench-react-rebuild P3）— Radix DropdownMenu
// 承载行为：trigger aria（haspopup/expanded/controls）、dismiss layer（Esc /
// 点外关闭 / 焦点移出关闭）、roving focus（方向键 / Home / End / typeahead）、
// 关后焦点回 trigger。「开 B 自动关 A」由每层自己的 dismiss 监听天然达成，
// 不要自己写单例关闭 —— 程序化 setOpen(false) 会走 A 的 close-autofocus 把焦点
// 拽回 A 的 trigger，触发 B 的 focus-outside dismiss 连锁关掉 B（实测踩过）。
// 皮肤与几何保持 index.html 的 .wb-frame-menu* CSS 不变：
// - 不用 Portal —— 菜单 DOM 必须留在对应 frame 的子树里（e2e 用 frame.locator 选）；
// - popper 包装层被 CSS 置惰（见 index.html 的 [data-radix-popper-content-wrapper]
//   规则）—— .wb-library 是 transform:scale 空间，JS 量测定位在缩放 ≠1 时必错位，
//   菜单位置继续由 .wb-frame-menu 的绝对定位拥有。
// 每个 frame 的 shell 一个 React root：shell 由命令式层（export-core）随板面重建
// 创建，本模块登记 roots；sweepFrameMenus() 卸载 shell 已游离（板面重建）的 root，
// 防止 DismissableLayer 的 document 监听泄漏。命令式层经 initExportCore(deps)
// 拿到这两个函数（app → 命令式 的 import 方向不变，本文件不 import export-core）。
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { wbGet } from './store.js';
import { WbIcon } from './WbIcon.jsx';

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
        <button type="button" className="wb-frame-menu-trigger" aria-label="Frame 菜单" title="Frame 菜单">⋯</button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content asChild>
        <span className="wb-frame-menu" role="menu" tabIndex={-1}>
          <DropdownMenu.Item asChild onSelect={function () { props.onExport(); }}>
            <button type="button" className="wb-frame-menu-item" role="menuitem" data-frame-export>
              <WbIcon name="export-image" size={15} /><span>导出图片…</span>
            </button>
          </DropdownMenu.Item>
          <DropdownMenu.Item asChild onSelect={function (event) { event.preventDefault(); copyFrameRef(); }}>
            <button type="button" className="wb-frame-menu-item" role="menuitem" data-frame-copy>
              <span aria-hidden="true" style={{ width: '15px', textAlign: 'center', color: 'var(--wb-muted)' }}>@</span>
              <span data-frame-menu-label>{copiedText ? '已复制 ' + copiedText : '复制 @frame'}</span>
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
