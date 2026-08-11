// Vendored from shadcn/ui registry new-york-v4/toggle（V0）。适配同 button.jsx：
// TSX→JSX；@radix-ui/react-toggle per-package；focus ring 剥离（走全局 catch-all）；
// 密度收紧 h-9→h-7 档；色值经桥类名。
import { cva } from 'class-variance-authority';
import * as TogglePrimitive from '@radix-ui/react-toggle';

import { cn } from '../lib/utils.js';

const toggleVariants = cva(
  'inline-flex cursor-pointer items-center justify-center gap-2 rounded-md border-0 font-sans text-sm font-medium whitespace-nowrap transition-[color,box-shadow] outline-none hover:bg-muted hover:text-muted-foreground disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*=\'size-\'])]:size-4',
  {
    variants: {
      variant: {
        default: 'bg-transparent',
        outline: 'border border-input bg-transparent shadow-xs hover:bg-accent hover:text-accent-foreground',
      },
      size: {
        default: 'h-7 min-w-7 px-2',
        sm: 'h-6 min-w-6 px-1.5',
        lg: 'h-8 min-w-8 px-2.5',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export function Toggle({ className, variant, size, ...props }) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { toggleVariants };
