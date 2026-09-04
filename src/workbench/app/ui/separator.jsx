// Vendored from shadcn/ui registry new-york-v4/separator（V0）。适配：
// TSX→JSX；@radix-ui/react-separator per-package；bg-border 经桥到 --wb-line。
import * as SeparatorPrimitive from '@radix-ui/react-separator';

import { cn } from '../lib/utils.js';

export function Separator({ className, orientation = 'horizontal', decorative = true, ...props }) {
  return (
    <SeparatorPrimitive.Root
      data-slot="separator"
      decorative={decorative}
      orientation={orientation}
      className={cn(
        'shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px',
        className
      )}
      {...props}
    />
  );
}
