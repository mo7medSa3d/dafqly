"use client";
import { useState } from "react";
import { Check, Copy } from "@/components/ui/solid-icons";
import { WhatsappLogo } from "@/components/ui/icons";
import { useTranslations } from "next-intl";
import { btnSmall, btnGhost } from "./ui";

interface WhatsAppShareProps {
  phone?: string; // E.164 format, optional
  message: string;
  className?: string;
  size?: "sm" | "md";
  label?: string;
  showCopy?: boolean;
}

export function WhatsAppShareButton({
  phone,
  message,
  className = "",
  size = "sm",
  label,
  showCopy = false,
}: WhatsAppShareProps) {
  const t = useTranslations("share");
  const [copied, setCopied] = useState(false);

  const handleClick = () => {
    const encoded = encodeURIComponent(message);
    const phoneDigits = phone ? phone.replace(/[^\d]/g, "") : "";
    const url = phoneDigits
      ? `https://wa.me/${phoneDigits}?text=${encoded}`
      : `https://wa.me/?text=${encoded}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(message);
        ok = true;
      }
    } catch { /* fallback below */ }
    if (!ok) {
      try {
        const ta = document.createElement("textarea");
        ta.value = message;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand("copy");
        document.body.removeChild(ta);
      } catch { /* ignore */ }
    }
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const buttonText = label ?? (size === "md" ? t("whatsapp") : undefined);

  return (
    <div className="inline-flex items-center gap-1">
      <button
        type="button"
        onClick={handleClick}
        className={`${size === "md" ? btnGhost : btnSmall} ${className}`}
        title={t("whatsapp")}
        aria-label={buttonText ?? t("whatsapp")}
      >
        <WhatsappLogo size={size === "md" ? 20 : 16} className="text-status-paid-fg" aria-hidden />
        {buttonText && <span>{buttonText}</span>}
      </button>

      {showCopy && (
        <button
          type="button"
          onClick={(e) => void handleCopy(e)}
          className={`${btnSmall} px-2`}
          title={copied ? t("copied") : "Copy"}
          aria-label={copied ? t("copied") : "Copy"}
        >
          {copied ? (
            <Check size={14} strokeWidth={2.5} className="text-status-paid-fg" />
          ) : (
            <Copy size={14} className="text-text-subtle" />
          )}
        </button>
      )}
    </div>
  );
}

/**
 * Generate a polite Arabic/English reminder message for a specific invoice.
 * `amount` must already carry its currency (callers pass the tenant
 * currency symbol); the message appends NO currency itself — it used to
 * hardcode ج.م./EGP here, which double-labelled amounts that already had
 * a symbol and mis-labelled every non-EGP tenant.
 */
export function invoiceShareMessage({
  businessName,
  amount,
  dueDate,
  locale,
}: {
  businessName: string;
  amount: string;
  dueDate: string;
  locale: string;
}): string {
  if (locale === "ar") {
    return `من ${businessName}: تذكير ودّي بمستحقات بقيمة ${amount} بتاريخ استحقاق ${dueDate}. شكرًا لتعاونكم. 🙏`;
  }
  return `From ${businessName}: Friendly reminder of ${amount} due on ${dueDate}. Thank you for your cooperation. 🙏`;
}

/** Generate a polite Arabic/English message for total outstanding */
export function totalShareMessage({
  businessName,
  totalAmount,
  locale,
}: {
  businessName: string;
  totalAmount: string;
  locale: string;
}): string {
  if (locale === "ar") {
    return `من ${businessName}: إجمالي المستحقات ${totalAmount} نرجو التواصل لتسوية الحساب. شكرًا لكم. 🙏`;
  }
  return `From ${businessName}: Total outstanding is ${totalAmount}. Please get in touch to settle the account. Thank you. 🙏`;
}
