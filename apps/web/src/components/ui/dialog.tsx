"use client";
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "@/components/ui/solid-icons";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

export function DialogContent({ className, children, ...props }: React.ComponentProps<typeof DialogPrimitive.Content>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-foreground/45 backdrop-blur-sm" />
      <DialogPrimitive.Content
        className={cn("fixed start-1/2 top-1/2 z-50 w-[min(92vw,32rem)] -translate-y-1/2 rounded-xl border border-border bg-surface p-5 text-text shadow-2xl ltr:-translate-x-1/2 rtl:translate-x-1/2", className)}
        {...props}
      >
        {children}
        <DialogPrimitive.Close className="absolute end-3 top-3 flex size-8 items-center justify-center rounded-md text-text-muted hover:bg-surface-muted focus-visible:ring-4 focus-visible:ring-primary/25 outline-none" aria-label="Close">
          <X size={16} strokeWidth={2.5} aria-hidden />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
export function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("mb-4 flex flex-col gap-1", className)} {...props} />;
}
export function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn("text-[18px] font-bold", className)} {...props} />;
}
export function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn("text-sm text-text-muted", className)} {...props} />;
}
