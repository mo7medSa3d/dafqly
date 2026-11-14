import * as React from "react";
import { cn } from "@/lib/utils";

export const inputVariants =
  "w-full min-h-[40px] rounded-lg border border-border-strong/50 bg-surface px-3.5 text-[14px] text-text placeholder:text-text-subtle outline-none transition-[border-color,box-shadow] hover:border-border-strong focus:border-primary focus:ring-4 focus:ring-primary/15 aria-invalid:border-danger aria-invalid:ring-danger/15 disabled:cursor-not-allowed disabled:opacity-60 file:border-0 file:bg-transparent file:text-sm file:font-medium";

export function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return <input data-slot="input" type={type} className={cn(inputVariants, className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea data-slot="textarea" className={cn(inputVariants, "min-h-[88px] py-2.5", className)} {...props} />;
}
