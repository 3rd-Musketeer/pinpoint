// Vendored from shadcn/ui registry new-york-v4/input（V0）。适配：TSX→JSX；
// 扁平化（2026-08-11 owner 方向）：去 border-input 描边 + shadow-xs，改 bg-secondary
// 填充面（Linear 风输入框）；focus 由全局 accent color-mix catch-all 接管；
// 密度收紧 h-9→h-7、text-base/md:text-sm→text-sm。
import { cn } from '../lib/utils.js';

export function Input({ className, type, ...props }) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'h-7 w-full min-w-0 rounded-md border-0 bg-secondary px-2.5 py-1 font-sans text-sm shadow-none transition-[color,background-color] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  );
}
