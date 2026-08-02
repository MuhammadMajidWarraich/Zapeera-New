import { config } from "@/lib/config";

export const SUPPORT_PHONE_DISPLAY = "+92 307 5445509";

function digits(phone: string): string {
  return String(phone || "").replace(/[^0-9]/g, "");
}

/** Open WhatsApp chat with support (https://wa.me/923075445509). */
export function whatsappUrl(message?: string): string {
  const base = config.support.whatsappUrl || `https://wa.me/${digits(config.support.phoneNumber)}`;
  if (!message) return base;
  return `${base}?text=${encodeURIComponent(message)}`;
}

/** Phone call link (tel:+923075445509). */
export function callUrl(): string {
  return `tel:${digits(config.support.phoneNumber)}`;
}

/** Email support link. */
export function emailUrl(subject?: string, body?: string): string {
  const params = new URLSearchParams();
  if (subject) params.set("subject", subject);
  if (body) params.set("body", body);
  const qs = params.toString();
  return `mailto:${config.support.email}${qs ? `?${qs}` : ""}`;
}
