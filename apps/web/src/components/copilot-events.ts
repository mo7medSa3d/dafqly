import type { NotificationTone } from "@tahseel/core";

/**
 * AI Copilot open-event contract — kept in its own tiny module on purpose.
 * `openAiCopilot` is called from pages that must NOT pull the 1600-line
 * AiCopilotDrawer into their first-load bundle: it only dispatches a window
 * event, and AppShell (which always mounts) listens for it and lazy-loads
 * the drawer on demand.
 */
export type CopilotTab = "briefing" | "composer" | "assistant";
export type ComposerMode = "reminder" | "installment";

export interface OpenCopilotDetail {
  tab?: CopilotTab;
  debtorId?: string;
  tone?: NotificationTone;
  mode?: ComposerMode;
  prompt?: string;
}

export function openAiCopilot(detail: OpenCopilotDetail = {}) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<OpenCopilotDetail>("dafqly:open-ai-copilot", { detail }));
}
