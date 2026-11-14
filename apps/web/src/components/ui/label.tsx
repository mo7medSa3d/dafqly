import * as React from "react";
import { cn } from "@/lib/utils";

export function Label({ className, ...props }: React.ComponentProps<"label">) {
  return <label data-slot="label" className={cn("flex flex-col gap-1.5 text-[14px] font-medium text-text", className)} {...props} />;
}
