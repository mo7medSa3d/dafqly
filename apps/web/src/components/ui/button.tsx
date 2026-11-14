import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/** shadcn/ui Button, themed with the monochrome Swiss-editorial oklch tokens. */
export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg text-[14px] font-semibold transition-[background-color,border-color,color,transform,box-shadow] outline-none focus-visible:ring-2 focus-visible:ring-ring/40 active:translate-y-px disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-[18px]",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-xs hover:bg-primary-hover",
        destructive: "bg-destructive text-destructive-foreground hover:opacity-90 focus-visible:ring-destructive/30",
        outline:
          "border border-border bg-card text-foreground hover:border-foreground/40 hover:bg-accent",
        secondary: "bg-secondary text-secondary-foreground hover:bg-accent",
        ghost: "text-foreground hover:bg-accent",
        soft: "bg-muted text-foreground hover:bg-primary hover:text-primary-foreground",
        success: "bg-status-paid-bg text-status-paid-fg ring-1 ring-inset ring-status-paid-fg/20 hover:opacity-90",
        dangerSoft: "border border-destructive/40 bg-danger-bg text-destructive hover:bg-destructive/10",
        link: "h-auto min-h-0 p-0 text-foreground underline-offset-4 hover:underline",
      },
      size: {
        default: "min-h-[40px] px-4 py-2",
        sm: "min-h-[32px] gap-1.5 rounded-md px-3 py-1 text-xs [&_svg:not([class*='size-'])]:size-4",
        xs: "min-h-[26px] gap-1 rounded-md px-2.5 py-0.5 text-[11px] [&_svg:not([class*='size-'])]:size-3.5",
        lg: "min-h-[44px] px-6 text-[15px]",
        icon: "size-10 p-0",
        iconSm: "size-7 min-h-0 rounded-lg p-0 [&_svg:not([class*='size-'])]:size-4",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ComponentProps<"button">,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({ className, variant, size, asChild = false, type, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      data-slot="button"
      {...(asChild ? {} : type ? { type } : {})}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
