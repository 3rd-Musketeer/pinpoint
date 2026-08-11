// Vendored from shadcn/ui registry new-york-v4/input（V0）。适配：TSX→JSX；
// 无 preflight：补 border-0 之外的显式 border 色（border-input 经桥 --wb-line）+
// font-sans；focus ring 剥离（全局 accent color-mix catch-all 接管）；
// 密度收紧 h-9→h-7、text-base/md:text-sm→text-sm。
import { cn } from '../lib/utils.js';

export function Input({ className, type, ...props }) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'h-7 w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 py-1 font-sans text-sm shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  );
}
