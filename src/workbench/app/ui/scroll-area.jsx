// Vendored from shadcn/ui registry new-york-v4/scroll-area（V0）。适配：
// TSX→JSX；@radix-ui/react-scroll-area per-package；focus ring 剥离（全局
// catch-all 接管）；滑条色 bg-border 经桥到 --wb-line。
//
// 已知内部契约（2026-08-17，vendored 组件契约清单见根 AGENTS.md）：Radix
// Viewport 会给 children 包一层内联 display:table;min-width:100% 的 div（上游
// 为横向滚动场景设计），内容按自然宽排版、不随容器收缩。本仓栏内语义是
// truncate 不横滚，index.html 用 `#wbside [data-slot="scroll-area-viewport"] >
// div { display:block !important; }` 强制回 block——撤掉那条规则前先看
// e2e「sidebar rows stay within their panel」的几何断言。
import * as ScrollAreaPrimitive from '@radix-ui/react-scroll-area';

import { cn } from '../lib/utils.js';

export function ScrollArea({ className, children, ...props }) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn('relative', className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        className="size-full rounded-[inherit] transition-[color,box-shadow] outline-none"
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}

export function ScrollBar({ className, orientation = 'vertical', ...props }) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        'flex touch-none p-px transition-colors select-none',
        orientation === 'vertical' &&
          'h-full w-2.5 border-l border-l-transparent',
        orientation === 'horizontal' &&
          'h-2.5 flex-col border-t border-t-transparent',
        className
      )}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb
        data-slot="scroll-area-thumb"
        className="relative flex-1 rounded-full bg-border"
      />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  );
}
