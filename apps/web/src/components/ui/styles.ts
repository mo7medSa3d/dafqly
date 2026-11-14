// Server-safe class strings (no "use client"): importable from both server
// and client components. Backed by the shadcn/ui cva variants.
import { buttonVariants } from "./button";
import { inputVariants } from "./input";

export const inputCls = inputVariants;
export const labelCls = "flex flex-col gap-1.5 text-[14px] font-medium";
export const btnPrimary = buttonVariants({ variant: "default" });
export const btnGhost = buttonVariants({ variant: "outline" });
export const btnDanger = buttonVariants({ variant: "destructive" });
export const btnSmall = buttonVariants({ variant: "outline", size: "sm" });
export const linkAction = buttonVariants({ variant: "link" });
