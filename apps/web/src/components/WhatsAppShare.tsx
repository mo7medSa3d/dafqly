"use client";
import { useState } from "react";
import { Check, Copy, WhatsappLogo } from "@phosphor-icons/react";
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
    const phoneDigits = phone ? phone.replace(/^\+/, "").replace(/\s+/g, "") : "";
    const url = phoneDigits
      ? `https://wa.me/${phoneDigits}?text=${encoded}`
      : `https://wa.me/?text=${encoded}`;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(message);
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
      >
        <WhatsappLogo size={size === "md" ? 20 : 16} weight="fill" className="text-emerald-500" aria-hidden />
        {buttonText && <span>{buttonText}</span>}
      </button>

      {showCopy && (
        <button
          type="button"
          onClick={handleCopy}
          className={`${btnSmall} px-2`}
          title={copied ? t("copied") : t("whatsapp")}
        >
          {copied ? (
            <Check size={14} weight="bold" className="text-emerald-500" />
          ) : (
            <Copy size={14} weight="fill" className="text-text-subtle" />
          )}
        </button>
      )}
    </div>
  );
}

/** Generate a polite Arabic/English reminder message for a specific invoice */
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
    return `من ${businessName}: تذكير ودّي بمستحقات بقيمة ${amount} ج.م. بتاريخ استحقاق ${dueDate}. شكرًا لتعاونكم. 🙏`;
  }
  return `From ${businessName}: Friendly reminder of ${amount} EGP due on ${dueDate}. Thank you for your cooperation. 🙏`;
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
    return `من ${businessName}: إجمالي المستحقات ${totalAmount} ج.م. نرجو التواصل لتسوية الحساب. شكرًا لكم. 🙏`;
  }
  return `From ${businessName}: Total outstanding is ${totalAmount} EGP. Please get in touch to settle the account. Thank you. 🙏`;
}
