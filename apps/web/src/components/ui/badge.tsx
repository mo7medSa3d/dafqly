import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

export const badgeVariants = cva(
  "inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-bold ring-1 ring-inset ring-current/15 [&_svg]:size-[13px]",
  {
    variants: {
      variant: {
        default: "bg-callout text-primary",
        paid: "bg-status-paid-bg text-status-paid-fg",
        due: "bg-status-due-bg text-status-due-fg",
        overdue: "bg-status-overdue-bg text-status-overdue-fg",
        disputed: "bg-status-disputed-bg text-status-disputed-fg",
        partial: "bg-status-partial-bg text-status-partial-fg",
        draft: "bg-status-draft-bg text-status-draft-fg",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export function Badge({ className, variant, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}
