// Vendored from shadcn/ui registry new-york-v4/badge（V0）。适配同 button.jsx：
// TSX→JSX；@radix-ui/react-slot；focus ring 剥离；色值经桥。
import { cva } from 'class-variance-authority';
import { Slot } from '@radix-ui/react-slot';

import { cn } from '../lib/utils.js';

const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 font-sans text-xs font-medium whitespace-nowrap transition-[color,box-shadow] outline-none [&>svg]:pointer-events-none [&>svg]:size-3',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground [a&]:hover:bg-primary/90',
        secondary: 'bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90',
        destructive: 'bg-destructive text-destructive-foreground [a&]:hover:bg-destructive/90',
        outline: 'border-border text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground',
        ghost: '[a&]:hover:bg-accent [a&]:hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 [a&]:hover:underline',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export function Badge({ className, variant = 'default', asChild = false, ...props }) {
  const Comp = asChild ? Slot : 'span';

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant, className }))}
      {...props}
    />
  );
}

export { badgeVariants };
