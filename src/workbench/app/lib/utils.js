// shadcn 约定的 className 合并：clsx 条件合并 + tailwind-merge 冲突去重。
// 供 app/ui/ 复制件使用（cn(buttonVariants(...), className) —— 调用方类名后写胜出）。
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
