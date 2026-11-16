import { config } from "@/lib/config";

export const SUPPORT_PHONE_DISPLAY = "+92 307 5445509";

/** Direct download link for the Windows desktop installer (served from zapeera.seikho.online/downloads).
 * INTERIM 2026-11-16: the 1.0.23 EXE is built + verified but NOT uploaded — the laptop proof gate is
 * blocked (tunnel down). The desktop link stays on the live 1.0.22 installer until the renamed EXE
 * passes the laptop proof; then flip this back to Tickimo-Setup-1.0.23.exe (the regexes below already match both). */
export const DESKTOP_DOWNLOAD_URL =
  "https://zapeera.seikho.online/downloads/Zapeera-Setup-1.0.22.exe";

/** Direct download link for the Android app APK (served from zapeera.seikho.online/downloads). */
export const ANDROID_DOWNLOAD_URL =
  "https://zapeera.seikho.online/downloads/Tickimo-Android-1.0.23.apk";

/** Version labels derived from the download URLs above — single source of truth, cannot go stale. */
export const DESKTOP_VERSION =
  DESKTOP_DOWNLOAD_URL.match(/(?:Tickimo|Zapeera)-Setup-([\d.]+)\.exe/)?.[1] ?? "";
export const ANDROID_VERSION =
  ANDROID_DOWNLOAD_URL.match(/Tickimo-Android-([\d.]+)\.apk/)?.[1] ?? "";

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
