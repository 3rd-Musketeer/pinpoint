// Vendored from shadcn/ui registry new-york-v4/button（复制件自有可改，V0）。
// 适配记录：
//  - TSX→JSX；asChild/Slot 与未用的 variant/size 档已按仓内实际用量剪掉；
//  - 无 preflight：base 补 border-0 / cursor-pointer / font-sans（UA 按钮默认
//    边框/光标/字体在此兜底）；
//  - focus 剥离 shadcn ring（focus-visible:ring/border-ring）—— chrome 的 focus
//    约定是 index.html 全局 catch-all 的 accent color-mix outline，未分层、恒优先；
//  - 密度按 dev-tool 锚收紧：控件高 28px（h-7/size-7）档，圆角走 --wb-r-* 阶梯；
//  - 色值一律经桥类名（bg-primary/text-muted-foreground…），无第二处字面量源。
// tool variant：workbench 工具钮（footer gear / HUD 钮 / 标注快捷钮）—— 扁平
// 无描边（owner 2026-08-11 方向：去 hairline 卡片化），hover 浅面，on = accent 浅面。
import { cva } from 'class-variance-authority';

import { cn } from '../lib/utils.js';

const buttonVariants = cva(
  'inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-md border-0 font-sans text-sm font-medium whitespace-nowrap transition-all outline-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=\'size-\'])]:size-4',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        tool:
          'bg-transparent text-muted-foreground transition-[color,background-color] duration-(--wb-dur) ease-(--wb-ease) hover:bg-accent hover:text-accent-foreground data-[state=on]:bg-[color-mix(in_srgb,var(--wb-accent)_10%,transparent)] data-[state=on]:text-primary',
      },
      size: {
        default: 'h-7 px-3 py-1 has-[>svg]:px-2.5',
        sm: 'h-7 gap-1.5 rounded-md px-2.5 has-[>svg]:px-2',
        icon: 'size-7',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export function Button({ className, variant = 'default', size = 'default', ...props }) {
  return (
    <button
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}
