// 侧栏行右键菜单（2026-08-17，owner 决定：locator 复制 / 导出 / 重命名等行级
// 动作全部收进右键菜单，不再在行尾放 hover 钮 —— 行宽全部还给标题，窄栏
// 也不再出现行尾元素被裁切的面）。Radix ContextMenu，与 frame-menu 的
// DropdownMenu 同族：指针处定位、Esc / 点外关闭、roving focus 全由库承担，
// 不要自研菜单（dismiss 层与焦点回拽的教训见 frame-menu.jsx 头注）。
// 与 frame-menu 的两处分工差异：
// - 用 Portal 到 body：侧栏不在 .wb-library 的 transform:scale 空间内
//   （frame-menu 不用 Portal 是因为画布缩放会让 JS 量测定位错位），栏内行
//   无此约束；portal 也避免菜单被栏的 overflow 裁切；
// - 本菜单依赖 popper 包装层的 JS 定位 —— index.html 的 popper 置惰规则
//   已收敛到 :has(> .wb-frame-menu) 只服务 frame 菜单；若哪天它回到全局，
//   本菜单会被压成 static、渲染在视口之外（DOM 在但不可见，2026-08-17
//   实测踩过，e2e 右键用例里有视口几何断言挡回归）；
// - 复制项 preventDefault 保持菜单开着、标签换「已复制 X」（frame-menu 先例）——
//   行上已无任何可见元素，菜单是复制反馈的唯一落点。
// 皮肤与 frame-menu 同族：浮层白面 + --wb-sh-3 + r-4；项 34px 行 + r-3 +
// hover/focus-visible --wb-hover 浅面。ROW_MENU_ITEM / ROW_MENU_PANEL 与
// frame-menu.jsx 共用（那边是画布缩放空间内的绝对定位变体）。
import { useEffect, useRef, useState } from 'react';
import * as ContextMenu from '@radix-ui/react-context-menu';
import { WbIcon } from './WbIcon.jsx';

// 菜单项皮肤：12px semibold 行，hover/focus 走 --wb-hover 浅面（图标 muted）
export var ROW_MENU_ITEM =
  'flex min-h-[34px] w-full cursor-pointer items-center gap-[9px] rounded-lg border-0 ' +
  'bg-transparent px-[9px] text-left font-sans text-[12px] font-semibold text-foreground ' +
  'transition-colors duration-150 hover:bg-accent focus-visible:bg-accent ' +
  '[&_svg]:text-muted-foreground';

// 浮层面板皮肤（定位类不含在内 —— frame-menu 自带绝对定位，这里由 Radix 定位）
export var ROW_MENU_PANEL =
  'z-(--wb-z-float) box-border w-[204px] rounded-xl bg-card p-[5px] shadow-[var(--wb-sh-3)]';

// 复制项：点击不关闭菜单（preventDefault），标签换「已复制 <全文>」1200ms
function CopyMenuItem(props) {
  var [copied, setCopied] = useState(false);
  var timer = useRef(0);
  useEffect(function () {
    return function () { clearTimeout(timer.current); };
  }, []);

  function copy() {
    if (!navigator.clipboard || !navigator.clipboard.writeText) return;
    navigator.clipboard.writeText(props.text).then(function () {
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(function () { setCopied(false); }, 1200);
    }).catch(function () {});
  }

  return (
    <ContextMenu.Item asChild onSelect={function (event) { event.preventDefault(); copy(); }}>
      <button type="button" className={ROW_MENU_ITEM} role="menuitem" {...props.attr}>
        <span aria-hidden="true" className="w-[15px] text-center text-muted-foreground">@</span>
        <span className="min-w-0 truncate">{copied ? '已复制 ' + props.text : props.label}</span>
      </button>
    </ContextMenu.Item>
  );
}

/* 行菜单。items 元素两种形态：
   - { kind: 'copy', label, text, attr } —— 复制 locator（text = 完整复制文本）；
   - { kind: 'action', label, icon, onSelect, attr } —— 普通动作（导出 / 重命名），
     点击后菜单自然关闭。
   children = 触发行（asChild，行自身的 class / data 契约不动）。 */
export function RowMenu(props) {
  return (
    <ContextMenu.Root modal={false}>
      <ContextMenu.Trigger asChild>{props.children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className={ROW_MENU_PANEL}>
          {props.items.map(function (item, i) {
            if (item.kind === 'copy') {
              return <CopyMenuItem key={i} label={item.label} text={item.text} attr={item.attr} />;
            }
            return (
              <ContextMenu.Item key={i} asChild onSelect={item.onSelect}>
                <button type="button" className={ROW_MENU_ITEM} role="menuitem" {...item.attr}>
                  <span aria-hidden="true" className="flex w-[15px] justify-center">
                    <WbIcon name={item.icon} size={13} className="size-[13px]" />
                  </span>
                  <span className="min-w-0 truncate">{item.label}</span>
                </button>
              </ContextMenu.Item>
            );
          })}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
